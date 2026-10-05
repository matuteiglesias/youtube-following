# ACCEPTANCE — YouTube Following v1

Acceptance is executable evidence, not a design aspiration.

A production release is not sellable until all release-critical journeys pass with real integrations where specified.

## A. Product journeys

### A1 — New account / empty feed

Given an authenticated user with zero follows:

- Feed renders the no-follows empty state;
- Following shows 0 / plan limit;
- no provider call or inference occurs merely by opening Feed.

### A2 — Resolve and follow a real channel

Given a valid real public YouTube `@handle`:

1. resolve returns canonical preview;
2. no Follow exists before confirmation;
3. Follow creates one relationship;
4. latest <=10 videos are available in Feed;
5. metadata is real, not fixtures;
6. no bulk summary generation occurs.

### A3 — Duplicate/global channel reuse

Given user A already caused Channel X and its frontier to exist:

When user B follows Channel X:

- no duplicate Channel is created;
- one additional Follow is created;
- fresh existing Video read models are reused;
- global monitoring remains one channel, not one per user.

### A4 — Feed ordering

With videos from >=2 followed channels:

- feed order is `published_at DESC, video_uid DESC`;
- channel filter returns only requested followed channel;
- no engagement statistic changes ordering.

### A5 — Unfollow + Undo

Unfollow:

- removes relationship immediately;
- removes channel's items from user Feed;
- leaves global Channel/Video/Summary rows;
- returns no destructive provider call.

Undo by refollow restores relationship.

### A6 — Follow limit

Given a paid entitlement at 30 follows:

- follow #31 is rejected server-side;
- direct API calls cannot bypass it;
- no provider monitoring/backfill is started for rejected follow.

## B. Summary economics

### B1 — Feed does not block on summary

An eligible unsummarized video renders complete metadata before summary completion.

### B2 — First uncached generation

Given sufficient entitlement:

- one user requests summary;
- server wins global claim;
- provider is called once;
- valid summary becomes available;
- one usage row is written;
- charged minutes are derived server-side from video duration.

### B3 — Shared summary

Given user A generated Video V summary:

When user B encounters V:

- same global summary is returned;
- provider is not called again;
- user B generation usage does not increase.

This is release-critical.

### B4 — Concurrent deduplication

Two authenticated users request the same uncached summary concurrently:

- exactly one effective global generation claim wins;
- at most one provider generation occurs;
- at most one user is charged;
- loser observes `generating` then `available`.

### B5 — Failure is free

Force provider summary failure:

- no fake summary;
- no SummaryUsage row;
- user feed stays usable;
- bounded `failed` state is returned.

### B6 — Quota exhaustion

Given no remaining generation minutes:

- uncached generation does not call provider;
- state is `quota_blocked`;
- cached summaries still display;
- video metadata and YouTube link still work.

### B7 — Short / long / live eligibility

- <90s → `short_video`, no automatic provider generation;
- >120m → `long_video`, no automatic static generation;
- live/upcoming → `live_or_upcoming`.

## C. Background freshness

### C1 — Real new-upload discovery

For a followed active channel, with a video not in product DB:

- internal sync reads the real channel feed;
- unseen video is discovered;
- VideoArtifactProvider canonicalizes it;
- product Video row is upserted;
- user's next Feed read contains it;
- no summary is required for discovery.

### C2 — Global dedup

With N users following the same channel, one sync check is sufficient for all N.

### C3 — Bounded failure

One channel feed timeout/error:

- appears in run evidence;
- does not abort unrelated channels;
- channel receives a bounded future retry time.

### C4 — Internal route authentication

Requests to internal sync without the approved Scheduler identity fail.

## D. Authentication and isolation

### D1 — RLS

Automated integration tests with users A/B prove:

- A cannot read or mutate B's Follow rows;
- A cannot mutate global media projections directly;
- A cannot mutate Entitlement or SummaryUsage;
- server privileged path can perform required global mutations.

### D2 — Anonymous boundaries

Anonymous/public demo visitor:

- may read only intended demo surface;
- cannot create Follow;
- cannot call summary generation;
- cannot read another user's data.

### D3 — Secret boundary

Browser bundle/network responses contain no:

- YouTube API key;
- Supabase server/service key;
- Polar secret;
- GCP credential.

## E. Billing

### E1 — Checkout

Authenticated user can start checkout for the one paid plan.

### E2 — Verified webhook

A real or provider-supported sandbox webhook:

- verifies signature;
- maps stable user reference;
- idempotently creates/updates Entitlement.

Replaying same event produces no duplicate side effects.

### E3 — Cancellation

Cancellation:

- does not delete account/follows;
- honors paid-through period according to billing event;
- ultimately disables paid generation/follow entitlement after end.

### E4 — Browser cannot self-upgrade

Changing request JSON/local storage/client code cannot increase entitlement.

## F. UX

### F1 — Responsive

Feed and Following usable at:

- ~375px mobile width;
- normal desktop width.

### F2 — Summary states

Visual regression/component tests cover all states:

- available;
- generating;
- short_video;
- long_video;
- live_or_upcoming;
- quota_blocked;
- failed.

### F3 — Error copy

Raw upstream/provider exception strings never render to user.

## G. Cost and production gates

### G1 — Cost guardrail

Using a representative real-video sample:

- record summary input duration and actual/current model pricing;
- project variable AI cost at 600 included minutes;
- AI variable cost <=25% of net subscription receipts;
- total expected variable cost <=35% of net subscription receipts.

If FAIL: do not launch paid plan unchanged.

### G2 — No anonymous spend

Automated tests prove no public route can trigger summary generation or unrestricted YouTube Data API work.

### G3 — Production infrastructure

- dedicated GCP project;
- Cloud Run runtime identity;
- Secret Manager;
- Supabase production project with RLS;
- billing webhook secret;
- cross-project invocation of Media Monitor sidecar with bounded IAM.

### G4 — Operational evidence

A 24-hour prelaunch soak with test account demonstrates:

- scheduled channel sync runs;
- no persistent due-channel backlog;
- new video discovery;
- summary generation + cache reuse;
- no unexplained provider-spend spike;
- no recurring unhandled errors.

## H. Sellable v1 release gate

Release is **READY TO SELL** only when all release-critical gates A–G pass and:

- custom production URL works;
- login/logout/recovery path works;
- checkout works;
- one real paid/test billing entitlement works end to end;
- normal use requires no developer intervention;
- support contact/legal/privacy links exist;
- plan limits are visible before purchase;
- database backups/provider defaults are enabled;
- rollback path for the deployed app is known.

A polished mock or local demo is not READY TO SELL.
