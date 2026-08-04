use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use qfc_api::{auth, config, db, events, seed, services, time};
use tracing_subscriber::EnvFilter;

/// Process-wide shared state: every business service is built against this,
/// not against the pool or hub directly, so a new service only needs to
/// hold an `AppState` (or the specific fields it uses) rather than growing
/// `main`'s wiring.
#[derive(Clone)]
struct AppState {
    pool: sqlx::SqlitePool,
    hub: events::Hub,
    config: config::Config,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let config = config::Config::from_env().expect("invalid configuration");

    let pool = db::connect(&config.db_path)
        .await
        .expect("failed to connect to database");

    // First-run only: populates an empty database with today's demo data —
    // see `seed::seed_if_empty`. Must run before the server starts accepting
    // connections, so no request can observe a partially-seeded database.
    seed::seed_if_empty(&pool)
        .await
        .expect("failed to seed database");

    // Grants every `QFC_ADMIN_EMAILS` address the admin role up front, so
    // an operator can administer accounts before that person's first login
    // — see `auth::ensure_admins`. Must run before the server starts
    // accepting connections, for the same reason seeding does.
    auth::ensure_admins(&pool, &config.admin_emails)
        .await
        .expect("failed to ensure configured admin users");

    // Prunes `change_log` immediately, then on an interval, for the life of
    // the process — see `events::spawn_pruning_task`.
    events::spawn_pruning_task(pool.clone());

    // Captured once here (not in the service constructor) so the uptime
    // `GetSystemStatus` reports measures from process start, including
    // seed/migration time, not from router assembly.
    let started_at_millis = time::now_millis();

    let state = AppState {
        pool,
        hub: events::Hub::new(),
        config,
    };

    let connect_router = connectrpc::Router::new()
        .add_service(Arc::new(services::session::SessionServiceImpl))
        .add_service(Arc::new(services::admin::AdminServiceImpl::new(
            state.pool.clone(),
            services::admin::AdminServiceConfig {
                hub: state.hub.clone(),
                started_at_millis,
                db_path: state.config.db_path.clone(),
                dev_user_mode: state.config.dev_user.is_some(),
                env_default_role: state.config.default_role,
                env_admin_emails: state.config.admin_emails.clone(),
            },
        )))
        .add_service(Arc::new(services::events::EventServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::team::TeamServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::crm::CustomerServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::portfolio::ProjectServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::strategy::StrategyServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::growth::GrowthServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .add_service(Arc::new(services::planning::PlanningServiceImpl::new(
            state.pool.clone(),
            state.hub.clone(),
        )))
        .into_axum_router();

    let auth_state = auth::AuthState {
        pool: state.pool.clone(),
        dev_user: state.config.dev_user.clone(),
        default_role: state.config.default_role,
        admin_emails: state.config.admin_emails.clone(),
    };

    let app = Router::new()
        .route("/healthz", get(|| async { "ok\n" }))
        .nest("/api", connect_router)
        .layer(axum::middleware::from_fn_with_state(
            auth_state,
            auth::middleware,
        ))
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let startup = format!(
        "starting qfc-api: bind={} db_path={} dev_user_mode={}",
        state.config.bind,
        state.config.db_path,
        state.config.dev_user.is_some()
    );
    if state.config.dev_user.is_some() {
        tracing::warn!("{}", startup);
    } else {
        tracing::info!("{}", startup);
    }
    tracing::info!(
        default_role = ?state.config.default_role,
        admin_email_count = state.config.admin_emails.len(),
        "resolved QFC_DEFAULT_ROLE for first-seen users"
    );

    let listener = tokio::net::TcpListener::bind(state.config.bind)
        .await
        .unwrap_or_else(|err| panic!("failed to bind {}: {err}", state.config.bind));

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server error");
}

/// Resolves on Ctrl-C or SIGTERM (the signal the container sends), so
/// `axum::serve`'s graceful shutdown can drain in-flight requests —
/// including an in-flight SQLite write — instead of cutting them off.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install ctrl_c handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutdown signal received; draining in-flight requests");
}
