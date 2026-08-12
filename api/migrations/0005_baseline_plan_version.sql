-- Production baseline: guarantee at least one plan version exists.
--
-- Background
-- ----------
-- The web app treats "no plan version" as an unrecoverable state: App.tsx
-- shows the load-error screen when no version is active, and the API
-- protects the last remaining version from deletion. The deployment
-- baseline (see 0003 and the re-worked seed) deliberately ships without
-- demo calendar data, so a database that only ever saw the production
-- baseline would have ZERO plan versions and the app could not start a
-- plan. The first version is therefore part of the deployed baseline
-- itself: created by this migration before the app ever serves a request
-- (fresh installs: after 0001-0004, before the first seed run; existing
-- databases: on the next startup). No GUI step is required — operators
-- build their first real plan in the app as before, and version history
-- and vacation planning are unchanged.
--
-- The version deliberately carries no assignments/absences/forecast data.
-- Idempotent: `ON CONFLICT DO NOTHING` leaves databases that already have
-- this version (or only user-created versions) untouched, and the row is
-- protected against deletion by the service's last-version guard.
INSERT INTO plan_version (id, name, description, created_at, updated_at)
VALUES (
    'v1',
    '2026',
    'Initial plan version — deployment baseline.',
    strftime('%s', 'now') * 1000,
    strftime('%s', 'now') * 1000
)
ON CONFLICT(id) DO NOTHING;
