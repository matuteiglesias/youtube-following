# ARCHITECTURE — YouTube Following v1

## 1. Architectural goal

Build a sellable product without prematurely extracting or rebuilding the YouTube machinery already proven in Media Monitor.

The v1 architecture optimizes for:

- one product codebase;
- bounded provider spend;
- strong user isolation;
- secure reuse of the existing private sidecar;
- globally deduplicated channel/video/summary work;
- easy later extraction of generic YouTube ownership.

## 2. Frozen v1 stack

### Application

- Next.js + TypeScript.
- One public web/API service.
- Containerized and deployed to Google Cloud Run.

Cloud Run is deliberate: the application can use a dedicated Google service identity to invoke the existing private Media Monitor sidecar without long-lived service-account keys or a separate federation layer.

Do not split frontend/backend into separate services in v1.

### Product state

Supabase:

- Supabase Auth;
- Postgres;
- Row Level Security.

Use email magic-link authentication for v1.

Do not add social OAuth providers before launch unless required by an explicit product decision.

### Billing

Polar is the v1 billing/Merchant-of-Record provider.

Keep billing behind a narrow adapter.

The application trusts its own `entitlements` table, which is updated from verified billing webhooks. It does not call Polar on every product request.

### Google Cloud

Use a dedicated production GCP project for YouTube Following.

The existing Media Monitor YouTube runtime remains in `media-monitor-tool` during the transition.

The YouTube Following Cloud Run runtime service account receives only the cross-project `run.invoker` permission required on the private Media Monitor sidecar.

Product-specific secrets live in the YouTube Following project Secret Manager.

## 3. High-level runtime

```text
Browser
   ↓ HTTPS
YouTube Following — Next.js / Cloud Run
   ├── Supabase Auth
   ├── Supabase Postgres / RLS
   ├── Polar adapter
   ├── YouTubeDiscoveryProvider
   │     ├── YouTube Data API for channel resolution
   │     └── public YouTube Atom/RSS feeds for new-upload hints
   └── VideoArtifactProvider
         ↓ authenticated Cloud Run invocation
      Media Monitor private YouTube sidecar
         ├── official metadata ensure/refresh
         ├── governed summary generation
         └── GCS canonical artifacts
```

## 4. Why there are two transitional provider adapters

The current Media Monitor runtime is strong at:

- arbitrary video ensure;
- video inspect;
- metadata refresh;
- governed summary generation;
- durable canonical artifacts.

It does not yet provide the product-level channel resolution/listing surface.

v1 therefore uses two narrow server-side adapters:

### `ChannelDiscoveryProvider`

Responsibilities:

- resolve `@handle` / channel URL to canonical channel ID;
- fetch canonical channel title/handle/thumbnail;
- fetch the public Atom/RSS upload feed;
- return recent video IDs/publication hints.

The YouTube Data API key is product-owned and server-side.

Atom/RSS is treated only as a discovery hint. Canonical video metadata still comes from the VideoArtifactProvider.

### `VideoArtifactProvider`

Responsibilities:

- ensure an arbitrary public video exists canonically;
- inspect a canonical video;
- request the governed shared summary.

Initial implementation delegates to the existing private Media Monitor Cloud Run service.

No Media Monitor-specific schema may cross the browser-facing product API. The adapter translates it.

## 5. Product database

The Postgres database contains product state and read models.

### Authoritative product state

- `profiles`
- `follows`
- `entitlements`
- `summary_usage`
- `summary_generation_claims`

### Global product read models

- `channels`
- `videos`
- `summaries`

These global rows are not a second scientific/canonical media authority. They are queryable product projections of provider-owned media artifacts.

Provider IDs are retained so rows can be refreshed/rebuilt.

### Why a video read model exists

The feed must be a cheap relational query.

Do not call the Media Monitor sidecar once per card during normal feed rendering.

The product copies the fields required to render the feed:

- stable IDs;
- channel relation;
- title;
- thumbnail;
- published time;
- duration;
- availability;
- current provider snapshot/summary IDs.

## 6. Core relational shape

Conceptual tables:

```text
profiles
  user_id PK → auth.users
  created_at

channels
  channel_uid PK
  native_channel_id UNIQUE
  handle
  title
  canonical_url
  thumbnail_url
  last_feed_checked_at
  next_feed_check_at
  monitoring_status

follows
  user_id FK
  channel_uid FK
  followed_at
  PRIMARY KEY (user_id, channel_uid)

videos
  video_uid PK
  channel_uid FK
  native_video_id UNIQUE
  title
  thumbnail_url
  published_at
  duration_seconds
  availability
  provider_snapshot_id
  updated_at

summaries
  summary_key PK
  video_uid FK
  spec_version
  language
  state
  summary_id
  summary_text
  key_points jsonb
  provider
  model
  generated_at
  retry_after
  UNIQUE(video_uid, spec_version, language)

summary_generation_claims
  summary_key PK/FK
  claimant_user_id
  state
  claimed_at
  finished_at

summary_usage
  usage_id PK
  user_id
  summary_key UNIQUE
  billing_period
  charged_minutes
  created_at

entitlements
  user_id PK
  plan_code
  status
  follow_limit
  generation_minutes_limit
  period_start
  period_end
  billing_customer_id
  billing_subscription_id
  updated_at
```

Exact SQL belongs to the implementation node, but these semantics are frozen.

## 7. RLS and server authority

RLS rules must guarantee:

- users can read/update only their own `follows`, `profile`, entitlement view, and usage view;
- global `channels`, `videos`, and available `summaries` are readable by authenticated product users;
- browser clients cannot directly create/update entitlements, usage, summary claims, or global media projections;
- privileged mutations occur through server routes using the server database credential.

Do not rely on hidden UI controls for authorization.

## 8. Follow flow

```text
reference
  ↓ resolve server-side
canonical Channel
  ↓ user confirms
server checks entitlement follow_limit
  ↓
insert Follow
  ↓
if channel is new/stale:
   fetch latest Atom/RSS frontier
   ensure up to 10 recent videos through VideoArtifactProvider
   upsert Video read model
  ↓
Feed immediately becomes useful
```

If the Channel already has a fresh global frontier, another user's follow does not repeat the same discovery/backfill work.

## 9. Background channel synchronization

v1 deliberately does **not** extract WebSub.

Instead:

- one Cloud Scheduler invocation every 10 minutes;
- internal authenticated sync endpoint;
- claim at most 25 due unique active channels per run;
- bounded concurrency, target <= 5 simultaneous feed reads;
- fetch public Atom/RSS feeds;
- compare discovered video IDs with product read model;
- call VideoArtifactProvider only for unseen/new videos;
- set each successfully checked channel `next_feed_check_at` roughly 60 minutes later.

Channels are synchronized globally, never per user.

The scheduled endpoint must be authenticated using a dedicated Scheduler identity / verified Google OIDC token. Do not protect it only with an obscure URL.

### Scale trigger

The RSS sweep is a deliberate v1 bridge.

Revisit WebSub extraction when any of these become true:

- > 150 actively monitored unique channels with desired <= 1 hour freshness;
- scheduler batches regularly leave due-channel backlog;
- sync execution approaches runtime limits;
- product demand makes near-real-time upload latency commercially important.

Do not implement WebSub before one of these triggers.

## 10. Lazy summary generation

Normal feed reads never synchronously generate summaries.

The browser may request generation for eligible cards in its active browsing frontier.

Server algorithm:

1. authenticate user;
2. load entitlement;
3. load global summary row;
4. if available → return cached result, charge 0;
5. if ineligible by duration/state → return bounded state;
6. verify remaining generation allowance;
7. atomically claim the unique global `summary_key`;
8. only claim winner invokes VideoArtifactProvider;
9. on provider success:
   - upsert global Summary;
   - write SummaryUsage for claim winner;
   - mark claim complete;
10. on failure:
   - store bounded failed/retry state;
   - charge no usage.

Concurrent non-winners return `generating` and poll/revalidate later.

No external queue is required for v1.

## 11. Billing and entitlement flow

```text
user chooses paid plan
  ↓
server creates Polar checkout
  ↓
Polar completes payment
  ↓ verified webhook
server maps billing event
  ↓
upsert Entitlement
  ↓
product server authorizes follows / generation
```

The billing webhook is idempotent.

Cancellation must not delete user data. Access follows the paid-through entitlement period and then becomes non-paid according to the billing event model.

v1 has one paid plan. Do not build a generic pricing engine.

## 12. Demo

The public demo is a server-defined list of demo channels.

It reads global product/media projections and only displays already-available summaries.

The public demo cannot call the summary-generation mutation.

Do not model demo visitors as fake paid users.

## 13. Deployment and secrets

One Cloud Run web service.

Secrets:

- Supabase server credential;
- YouTube Data API key;
- Polar API/webhook credentials;
- any required app signing/config values.

Use Secret Manager.

The browser receives only credentials explicitly safe for browser use, such as Supabase's public client key.

The Cloud Run runtime identity has:

- access only to required product secrets;
- permission to invoke the private Media Monitor sidecar;
- normal logging permissions.

No legacy Media Monitor identities are reused.

## 14. Observability

v1 needs operational evidence, not an observability platform.

Required:

- structured request/error logs;
- channel-sync run summary: checked/new/failures/duration;
- summary generation: cache hit/claim won/provider success/provider failure/charged minutes;
- billing webhook success/failure;
- basic Cloud Run error-rate/latency visibility.

Do not add BigQuery, tracing infrastructure, or a custom metrics warehouse in v1.

## 15. Eventual extraction boundary

After product fit is demonstrated, generic YouTube ownership may move from Media Monitor into this system.

Likely extraction candidates:

- canonical Channel/Video contracts;
- YouTube Data API acquisition;
- WebSub;
- reconciliation;
- GCS artifact store;
- summary generation.

Media Monitor retains research/editorial concepts such as appearances, segments, evidence, and sensing workflows.

Extraction is not a v1 prerequisite.

## 16. Architectural non-goals

Do not add:

- Vercel;
- Redis;
- Kafka/Pub/Sub/event buses;
- Celery/worker framework;
- Firestore;
- BigQuery;
- a separate API microservice;
- GraphQL;
- a search engine;
- transcript infrastructure;
- product WebSub before the scale trigger.
