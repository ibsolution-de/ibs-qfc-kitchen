//! Integration tests for the write-path/live-event spine: `qfc_api::events`,
//! `qfc_api::store`, and `qfc_api::services::events::EventServiceImpl`.
//!
//! Each test gets its own temp SQLite file (migrated fresh by
//! `qfc_api::db::connect`) and cleans it up (including WAL sidecar files) on
//! the way out.

use std::path::PathBuf;
use std::time::Duration;

use buffa::view::HasMessageView;
use buffa::Message;
use bytes::Bytes;
use connectrpc::{ConnectError, ErrorCode, RequestContext, ServiceRequest};
use futures::StreamExt;
use qfc_api::proto::events::{ChangeEvent, ChangeOp, EntityKind, EventService, WatchRequest};
use qfc_api::proto::team::Employee;
use qfc_api::services::events::EventServiceImpl;
use qfc_api::{db, events, store};
use sqlx::SqlitePool;

/// Calls `EventServiceImpl::watch` the way the dispatcher would: encode a
/// `WatchRequest`, decode it back into its zero-copy view, wrap it in a
/// `ServiceRequest`, and await the handler. Expands inline at each call site
/// (rather than being a helper fn) so nothing needs to name the handler's
/// opaque stream-item type.
macro_rules! watch {
    ($svc:expr, $since_seq:expr) => {{
        let body = Bytes::from(
            WatchRequest {
                since_seq: $since_seq,
                ..Default::default()
            }
            .encode_to_vec(),
        );
        let view = WatchRequest::decode_view(&body).expect("decode WatchRequest view");
        let req = ServiceRequest::<WatchRequest>::from_parts(&view, &body);
        $svc.watch(RequestContext::new(http::HeaderMap::new()), req).await
    }};
}

/// `Watch`'s stream item type is the handler's opaque `impl
/// Encodable<ChangeEvent>` — the trait only exposes `.encode(...)`, not
/// `ChangeEvent`'s fields, even though the handler happens to yield
/// `ChangeEvent` values directly. Round-trip through the wire encoding to
/// get a concrete, inspectable `ChangeEvent` back, exactly as a real client
/// would after decoding the response frame.
fn decode_event(item: &impl connectrpc::Encodable<ChangeEvent>) -> ChangeEvent {
    let bytes = item
        .encode(connectrpc::CodecFormat::Proto)
        .expect("encode stream item");
    ChangeEvent::decode_from_slice(&bytes).expect("decode ChangeEvent")
}

async fn temp_pool() -> (SqlitePool, PathBuf) {
    let path = std::env::temp_dir().join(format!("qfc-events-test-{}.db", uuid::Uuid::new_v4()));
    let pool = db::connect(path.to_str().expect("temp path is utf8"))
        .await
        .expect("connect to temp db");
    (pool, path)
}

async fn cleanup(pool: SqlitePool, path: PathBuf) {
    pool.close().await;
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(format!("{}-wal", path.display()));
    let _ = std::fs::remove_file(format!("{}-shm", path.display()));
}

/// Writes one `Employee` upsert the way a business service would: inside a
/// transaction, `store::upsert_blob` for the row and `events::record` for
/// the change-log entry, committed together, broadcast only after the
/// commit succeeds. Returns the assigned `seq`.
async fn write_employee(pool: &SqlitePool, hub: &events::Hub, actor_email: &str, id: &str) -> i64 {
    let employee = Employee {
        id: id.to_string(),
        name: format!("Employee {id}"),
        ..Default::default()
    };

    let mut tx = pool.begin().await.expect("begin tx");
    store::upsert_blob(&mut tx, store::Table::Employee, id, &employee)
        .await
        .expect("upsert_blob");
    let mut pending = events::PendingEvents::new();
    let event = events::record(
        &mut tx,
        actor_email,
        EntityKind::Employee,
        ChangeOp::Upsert,
        id,
        None,
        Some(employee.encode_to_vec()),
    )
    .await
    .expect("record");
    let seq = event.seq;
    pending.push(event);
    tx.commit().await.expect("commit tx");
    hub.publish_all(pending);
    seq
}

#[tokio::test]
async fn watch_receives_event_from_concurrent_write() {
    let (pool, db_path) = temp_pool().await;
    let hub = events::Hub::new();
    let svc = EventServiceImpl::new(pool.clone(), hub.clone());

    // since_seq = 0: no replay, live only.
    let resp = watch!(svc, 0).expect("watch ok");
    let mut stream = resp.body;

    let writer_pool = pool.clone();
    let writer_hub = hub.clone();
    tokio::spawn(async move {
        write_employee(&writer_pool, &writer_hub, "actor@example.com", "emp-concurrent").await;
    });

    let item = stream
        .next()
        .await
        .expect("stream ended before an event arrived")
        .expect("event delivered without error");
    let event = decode_event(&item);
    assert_eq!(event.entity_id, "emp-concurrent");
    assert_eq!(event.op.as_known(), Some(ChangeOp::Upsert));
    assert!(event.seq > 0);

    cleanup(pool, db_path).await;
}

#[tokio::test]
async fn watch_replays_exact_tail_since_mid_history() {
    let (pool, db_path) = temp_pool().await;
    let hub = events::Hub::new();
    let svc = EventServiceImpl::new(pool.clone(), hub.clone());

    let mut seqs = Vec::new();
    for i in 0..5 {
        seqs.push(write_employee(&pool, &hub, "actor@example.com", &format!("emp-{i}")).await);
    }

    // Connect mid-way: since_seq = the 2nd event's seq. Only events 3, 4 and
    // 5 (indices 2..4) are the expected tail.
    let since_seq = seqs[1];
    let resp = watch!(svc, since_seq).expect("watch ok");
    let mut stream = resp.body;

    for expected_id in ["emp-2", "emp-3", "emp-4"] {
        let item = stream
            .next()
            .await
            .expect("stream ended before the expected replay tail was delivered")
            .expect("replayed event delivered without error");
        let event = decode_event(&item);
        assert_eq!(event.entity_id, expected_id);
        assert!(event.seq > since_seq);
    }

    cleanup(pool, db_path).await;
}

#[tokio::test]
async fn watch_since_seq_below_retention_floor_requires_reload() {
    let (pool, db_path) = temp_pool().await;
    let hub = events::Hub::new();
    let svc = EventServiceImpl::new(pool.clone(), hub.clone());

    let mut seqs = Vec::new();
    for i in 0..5 {
        seqs.push(write_employee(&pool, &hub, "actor@example.com", &format!("emp-{i}")).await);
    }

    // Simulate the background pruning task having already reclaimed the
    // oldest rows, moving the retention floor past `seqs[0]` — the same
    // effect `events::prune` has, just without needing 20,000 rows of
    // fixtures to trigger it for real.
    sqlx::query("DELETE FROM change_log WHERE seq <= ?1")
        .bind(seqs[1])
        .execute(&pool)
        .await
        .expect("simulate prune");

    // `Response<ServiceStream<impl Encodable<..>>>` doesn't implement
    // `Debug` (the boxed `dyn Stream` inside it can't), so `expect_err`
    // isn't usable here — match instead.
    let err: ConnectError = match watch!(svc, seqs[0]) {
        Ok(_) => panic!("expected a reload-required error, got a stream"),
        Err(err) => err,
    };
    assert_eq!(err.code, ErrorCode::DataLoss);

    cleanup(pool, db_path).await;
}

#[tokio::test]
async fn rolled_back_transaction_never_broadcasts() {
    let (pool, db_path) = temp_pool().await;
    let hub = events::Hub::new();
    let mut live = hub.subscribe();

    let employee = Employee {
        id: "emp-rollback".to_string(),
        ..Default::default()
    };
    let mut tx = pool.begin().await.expect("begin tx");
    store::upsert_blob(&mut tx, store::Table::Employee, "emp-rollback", &employee)
        .await
        .expect("upsert_blob");
    let event = events::record(
        &mut tx,
        "actor@example.com",
        EntityKind::Employee,
        ChangeOp::Upsert,
        "emp-rollback",
        None,
        Some(employee.encode_to_vec()),
    )
    .await
    .expect("record");
    let mut pending = events::PendingEvents::new();
    pending.push(event);

    // Simulate the transaction failing before it could commit: roll it
    // back instead. Nothing calls `hub.publish_all(pending)` on this path —
    // `pending` is simply dropped — which is exactly the point: there is no
    // way to reach the broadcast channel other than `publish_all`, and a
    // caller that never commits never has a reason to call it.
    tx.rollback().await.expect("rollback tx");
    drop(pending);

    // The row itself must not exist either — the entity write and its
    // change-log entry share one transaction.
    let mut conn = pool.acquire().await.expect("acquire conn");
    let rows: Vec<Employee> = store::list_blobs(&mut conn, store::Table::Employee)
        .await
        .expect("list_blobs");
    assert!(rows.is_empty(), "rolled-back row must not be visible");
    // Release the connection back to the pool explicitly — `cleanup`'s
    // `pool.close()` waits for every checked-out connection to be returned,
    // and `conn` would otherwise stay borrowed until this function's
    // lexical scope ends (after the `cleanup` call), deadlocking it.
    drop(conn);

    let recv_result = tokio::time::timeout(Duration::from_millis(200), live.recv()).await;
    assert!(
        recv_result.is_err(),
        "expected no broadcast after a rollback, but the subscriber received something"
    );

    cleanup(pool, db_path).await;
}
