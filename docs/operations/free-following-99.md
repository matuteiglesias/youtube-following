# Free Following baseline — 2026-10-19

## Product rule

- Every authenticated user can follow **99 YouTube channels by default**.
- Following/reading metadata is **not** conditional on paid billing, an internal
  test grant, or a valid paid period. The same applies to existing accounts.
- A user with an older legacy entitlement limit above 99 retains the larger
  limit. In the UI and read APIs, the effective limit is
  `max(99, legacy_follow_limit)`.
- The value stored in `entitlements.follow_limit` is a legacy billing field
  (typically 0 for an unsubscribed user). Do **not** interpret that raw value
  as the current allowed number of channel follows. The source of truth for
  enforcement is the versioned `create_follow_with_limit` RPC.
- New summary generation remains **separately gated** by paid or internal-test
  status and generation-minute budgets. Cached summary retrieval does not
  trigger inference.
- The default limit is deliberate, but it increases the possible volume of
  monitored channels. Upload discovery must remain globally deduplicated,
  scheduler-bounded, and inference must never run merely because a video was
  discovered or a channel followed.

## Implementation

- `supabase/migrations/202610190001_free_following_99.sql` changes only the
  authoritative `create_follow_with_limit` RPC. The function serializes
  follow mutations on the user entitlement row and blocks the 100th channel
  when no legacy allowance above 99 exists.
- API and UI show effective free follow capacity; billing/checkout still gates
  inference, not Following. No Auth users, subscriptions, credentials or existing
  follow rows need rewriting.
- Integration tests verify first/second follow without payment, 99th accepted,
  100th rejected, authorized-role restrictions, and billing expiry not revoking
  following.

## Release order and acceptance

1. Run all tests against the complete migration chain.
2. Apply exactly the new SQL migration to the **linked YouTube Following**
   Supabase database. Do not apply previous migrations a second time, alter
   passwords or grant generation credits.
3. Deploy and smoke test Next.js (following count and account view). Keep
   old revision available for rollback; note that rolling back the web UI while
   retaining the new DB RPC would temporarily reintroduce the old UI denial.
4. Refresh `/following` on an existing free account. Expect `0 / 99` and a
   successful `POST /api/follows` (201) on a valid resolved channel.
5. Confirm initial backfill returns `complete` or `partial` without undoing
   the new follow; validate video availability independently. If a 503 remains,
   inspect safe Cloud Run `follow_mutation_failed` diagnostics.

## Compatibility

This supersedes the previous instruction in
`docs/operations/follow-503-triage.md` to grant an internal test entitlement
merely to follow channels. A bounded internal grant is still needed only if
the user should generate **new** summaries during the first-user pilot.
