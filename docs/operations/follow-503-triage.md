> **Historical incident record (superseded 2026-10-19).** The free Following baseline now allows 99 channels for every authenticated account, without a pilot entitlement. See [free-following-99.md](./free-following-99.md). The earlier grant instructions below apply only to generation-enabled pilot usage, not to following channels.

# Follow 503 triage — 2026-10-19

## Evidence collected

- Browser screenshot on /following: channel resolution works; "0 / 0" following quota.
- Cloud Run at 10:49–10:51 UTC: POST /api/channels/resolve HTTP 200;
  POST /api/follows HTTP 503 twice.
- Cloud Scheduler job at 10:50 UTC: 200. App log `channel_sync_run`
  shows `claimed:0`, `remaining_due:0`; not evidence of new-video
  processing.
- Hosted Next.js service uses Supabase product read model, external YouTube
  resolver, and a separate server-role RPC named
  `public.create_follow_with_limit` for follow persistence.
- Source SQL for this RPC (D7 migration) blocks accounts lacking active
  access or with `follow_limit <= 0` by raising
  `follow_limit_reached`. A new Auth account defaults to plan `none` with
  `follow_limit = 0` (D1 migration).
- Root cause of the **missing follow privilege** is established. The precise
  cause of the observed **503 rather than expected 403** is not established:
  previous code obscured unrelated database/RPC exceptions behind the same
  YouTube-facing provider error, with no sanitized backend diagnostics.

## Repair in this change

- Route-level preflight checks the server-read entitlement; a denied account
  returns 403 with ACCESS_NOT_ENABLED or FOLLOW_ACCESS_EXPIRED.
- SQL/RPC mutation errors now produce FOLLOW_SERVICE_UNAVAILABLE, with
  a safe log of recognized Postgres SQLSTATE/PostgREST error codes and no
  raw database errors or identifiers.
- Provider construction failure after the atomic Follow commit is treated
  as partial backfill rather than a failed follow.
- Following UI explicitly identifies 0-channel pilot access and disables
  the final Follow action while leaving Resolve available.
- Authorization remains in the existing Postgres RPC; the route check is
  explanatory, not a replacement for server-side enforcement.
- Tests cover 0-plan rejection, paid-through period, safe classification and
  committed-follow/failed-provider consistency.

## Remaining independent blocker: activate the first user's test entitlement

Use the **Supabase project dashboard** for the configured Youtube Following
project and pick the already-authenticated user's exact email under
Authentication > Users. A trusted operator can grant a bounded internal
entitlement using Supabase SQL Editor, with the following *template* after
replacing the placeholder with the correct email. **Never run against an
unverified account, and do not paste passwords or API keys into this query.**

```sql
DO $$
DECLARE
    pilot_user uuid;
BEGIN
    SELECT id INTO STRICT pilot_user
    FROM auth.users
    WHERE lower(email) = lower('REPLACE_WITH_CONFIRMED_LOGIN_EMAIL');
    PERFORM public.grant_internal_test_entitlement(pilot_user, 4, 240);
END;
$$;
```

The existing RPC is service-role-only from browser API roles and the
authenticated database's SQL Editor is an administrative context. This grant
is for the **confirmed human tester** only; it is not open signup, not a
shared anonymous demo identity, not Polar billing, and not an application
credential bypass.

After applying: reload /following. The counter should move from 0 / 0 to
0 / 4, and then POST /api/follows should return 201 (or 200 for an existing
follow). If it still returns 503, use the new safe Cloud Run
`follow_mutation_failed` error_code and verify RPC availability/migration
version, rather than changing YouTube API credentials.

The first successful Follow can show `backfill: "partial"` if the provider
sidecar is unavailable, while still persisting the Follow. Verify video
discovery and summaries separately.
