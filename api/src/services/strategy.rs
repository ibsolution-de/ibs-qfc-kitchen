//! `StrategyService`: two independent entities behind one service —
//! strategic goals (`store::Table::StrategicGoal`) and north-star metrics
//! (`store::Table::NorthStar`) — each a plain encoded-proto blob table. See
//! `services::crud` for the shared list/upsert/delete machinery every plain
//! blob-backed entity service uses.

use connectrpc::{RequestContext, Response, ServiceRequest, ServiceResult};
use sqlx::SqlitePool;

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::events::Hub;
use crate::proto::events::EntityKind;
use crate::proto::strategy::{
    DeleteGoalRequest, DeleteGoalResponse, DeleteNorthStarMetricRequest,
    DeleteNorthStarMetricResponse, ListGoalsRequest, ListGoalsResponse,
    ListNorthStarMetricsRequest, ListNorthStarMetricsResponse, NorthStarMetric, StrategicGoal,
    StrategyService, UpsertGoalRequest, UpsertGoalResponse, UpsertNorthStarMetricRequest,
    UpsertNorthStarMetricResponse,
};
use crate::services::crud;
use crate::store::Table;

pub struct StrategyServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl StrategyServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl StrategyService for StrategyServiceImpl {
    async fn list_goals(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListGoalsRequest>,
    ) -> ServiceResult<ListGoalsResponse> {
        let goals = crud::list(&self.pool, Table::StrategicGoal).await?;
        Response::ok(ListGoalsResponse {
            goals,
            ..Default::default()
        })
    }

    async fn upsert_goal(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertGoalRequest>,
    ) -> ServiceResult<UpsertGoalResponse> {
        let current = auth::require(&ctx)?;
        let entity = request.to_owned_message().goal.into_option().unwrap_or_default();
        let spec = crud::EntitySpec {
            table: Table::StrategicGoal,
            kind: EntityKind::StrategicGoal,
            name: "strategic_goal",
        };
        let goal = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |g: &mut StrategicGoal| &mut g.id,
            validate_goal,
        )
        .await?;
        Response::ok(UpsertGoalResponse {
            goal: goal.into(),
            ..Default::default()
        })
    }

    async fn delete_goal(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteGoalRequest>,
    ) -> ServiceResult<DeleteGoalResponse> {
        let current = auth::require(&ctx)?;
        let spec = crud::EntitySpec {
            table: Table::StrategicGoal,
            kind: EntityKind::StrategicGoal,
            name: "strategic_goal",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteGoalResponse::default())
    }

    async fn list_north_star_metrics(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListNorthStarMetricsRequest>,
    ) -> ServiceResult<ListNorthStarMetricsResponse> {
        let metrics = crud::list(&self.pool, Table::NorthStar).await?;
        Response::ok(ListNorthStarMetricsResponse {
            metrics,
            ..Default::default()
        })
    }

    async fn upsert_north_star_metric(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpsertNorthStarMetricRequest>,
    ) -> ServiceResult<UpsertNorthStarMetricResponse> {
        let current = auth::require(&ctx)?;
        let entity = request.to_owned_message().metric.into_option().unwrap_or_default();
        let spec = crud::EntitySpec {
            table: Table::NorthStar,
            kind: EntityKind::NorthStarMetric,
            name: "north_star_metric",
        };
        let metric = crud::upsert(
            &self.pool,
            &self.hub,
            &spec,
            &current.email,
            entity,
            |m: &mut NorthStarMetric| &mut m.id,
            validate_north_star_metric,
        )
        .await?;
        Response::ok(UpsertNorthStarMetricResponse {
            metric: metric.into(),
            ..Default::default()
        })
    }

    async fn delete_north_star_metric(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteNorthStarMetricRequest>,
    ) -> ServiceResult<DeleteNorthStarMetricResponse> {
        let current = auth::require(&ctx)?;
        let spec = crud::EntitySpec {
            table: Table::NorthStar,
            kind: EntityKind::NorthStarMetric,
            name: "north_star_metric",
        };
        crud::delete(&self.pool, &self.hub, &spec, &current.email, request.id).await?;
        Response::ok(DeleteNorthStarMetricResponse::default())
    }
}

/// `StrategicGoal` has no `name` field — `title` is its analogous required
/// display string, so that's what's validated non-empty here.
fn validate_goal(goal: &StrategicGoal) -> AppResult<()> {
    if goal.title.trim().is_empty() {
        return Err(AppError::InvalidArgument("goal.title must not be empty".to_string()));
    }
    Ok(())
}

fn validate_north_star_metric(metric: &NorthStarMetric) -> AppResult<()> {
    if metric.name.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "north_star_metric.name must not be empty".to_string(),
        ));
    }
    Ok(())
}
