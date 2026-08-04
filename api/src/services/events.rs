//! `EventService`: the live-sync spine every client watches. Replays
//! `change_log` since the caller's `since_seq`, then streams live updates
//! from the shared [`Hub`](crate::events::Hub), deduping the overlap
//! between replay and live delivery by `seq`.

use connectrpc::{
    Encodable, RequestContext, Response, ServiceRequest, ServiceResult, ServiceStream,
};
use futures::StreamExt;
use sqlx::SqlitePool;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;

use crate::events::{self, Hub};
use crate::proto::events::{
    ChangeEvent, EventService, GetEventsStateRequest, GetEventsStateResponse, WatchRequest,
};

pub struct EventServiceImpl {
    pool: SqlitePool,
    hub: Hub,
}

impl EventServiceImpl {
    pub fn new(pool: SqlitePool, hub: Hub) -> Self {
        Self { pool, hub }
    }
}

impl EventService for EventServiceImpl {
    async fn get_events_state(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, GetEventsStateRequest>,
    ) -> ServiceResult<GetEventsStateResponse> {
        let max_seq = events::max_committed_seq(&self.pool).await?;
        Response::ok(GetEventsStateResponse {
            max_seq,
            ..Default::default()
        })
    }

    async fn watch(
        &self,
        _ctx: RequestContext,
        request: ServiceRequest<'_, WatchRequest>,
    ) -> ServiceResult<ServiceStream<impl Encodable<ChangeEvent> + Send + use<>>> {
        // `since_seq == 0` means "no replay, start live" (not "replay all of
        // history") per the RPC contract in events.proto.
        let since_seq = request.since_seq;

        // Subscribe FIRST, then read replay rows: any event committed in the
        // gap between this call and the replay query below still lands in
        // `live`, and the seq-based dedupe further down drops it if replay
        // already covered it. Doing this in the other order could lose
        // events committed in that gap entirely.
        let live = self.hub.subscribe();

        let replay = if since_seq > 0 {
            match events::oldest_retained_seq(&self.pool).await? {
                // No gap between what the client already has (`since_seq`)
                // and the oldest row still retained: safe to replay.
                Some(oldest) if since_seq + 1 >= oldest => {
                    events::replay_since(&self.pool, since_seq).await?
                }
                // Either the log is empty while the client claims to have
                // seen `since_seq` events, or the rows between `since_seq`
                // and the retention floor were pruned away — either way,
                // silently starting mid-history would drop data the client
                // thinks it still needs. Tell it to reload instead.
                _ => return Err(events::reload_required_error()),
            }
        } else {
            Vec::new()
        };

        // The highest seq already delivered via replay (or `since_seq`
        // itself if there was no replay), so the live leg below can drop
        // anything at or below it instead of re-emitting a duplicate.
        let last_seq = replay.last().map_or(since_seq, |event| event.seq);

        let live = BroadcastStream::new(live);
        let stream =
            futures::stream::iter(replay.into_iter().map(Ok)).chain(futures::stream::unfold(
                (live, last_seq, false),
                |(mut live, last_seq, done)| async move {
                    if done {
                        return None;
                    }
                    loop {
                        match live.next().await {
                            // The hub was dropped — process shutdown. End the
                            // stream cleanly rather than erroring.
                            None => return None,
                            Some(Ok(event)) => {
                                if event.seq <= last_seq {
                                    // Already delivered via replay (or a prior
                                    // live event) — dedupe silently.
                                    continue;
                                }
                                let next_last_seq = event.seq;
                                return Some((Ok(event), (live, next_last_seq, false)));
                            }
                            Some(Err(BroadcastStreamRecvError::Lagged(_))) => {
                                // We fell behind the live channel and missed
                                // events irrecoverably (from this stream's
                                // perspective) — surface the same
                                // reload-required signal as a pruned replay
                                // rather than silently skipping ahead.
                                return Some((
                                    Err(events::reload_required_error()),
                                    (live, last_seq, true),
                                ));
                            }
                        }
                    }
                },
            ));

        Response::stream_ok(stream)
    }
}
