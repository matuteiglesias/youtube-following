# DEVELOPMENT DAG — YouTube Following v1

## 1. Goal

Implement a sellable $3.99/month v1 through small, reviewable nodes.

Each node should normally map to one PR.

Do not implement future nodes early merely because adjacent code is convenient.

## 2. Graph

```text
D0 Foundation
 ├──────────────┐
 ↓              ↓
D1 Auth/Data    D2 Provider seam
 └──────┬───────┘
        ↓
      D3 Follow lifecycle
       ├───────────────┐
       ↓               ↓
     D4 Feed         D6 Channel sync
       │
       ↓
     D5 Shared summaries
       │
       ├──────────────┐
       ↓              ↓
     D7 Billing     D8 Demo/UX polish
       └──────┬───────┘
              ↓
         D9 Production hardening
              ↓
         D10 Sellable acceptance
```

D6 can proceed in parallel once D3 is stable.

D7 may scaffold earlier, but entitlement enforcement must integrate the D3/D5 server paths before completion.

## D0 — Foundation and deploy skeleton

### Purpose

Create the smallest production-shaped application skeleton.

### Deliver

- current stable Next.js + TypeScript app;
- lint/typecheck/test commands;
- minimal Feed/Following routes with placeholder components;
- Dockerfile suitable for Cloud Run;
- environment validation;
- CI;
- documented local dev;
- initial dedicated GCP project/resource naming plan;
- no product behavior yet.

### Acceptance

- local app boots;
- tests/typecheck green;
- container builds;
- one non-secret development deployment can answer health route.

### Do not include

Supabase schema, Media Monitor calls, billing, follow UI behavior.

## D1 — Auth + product database + RLS

Depends on D0.

### Deliver

- Supabase project wiring;
- email magic-link auth;
- migrations for:
  - profiles;
  - channels;
  - follows;
  - videos;
  - summaries;
  - summary_generation_claims;
  - summary_usage;
  - entitlements;
- RLS policies;
- server DB adapter;
- default `none` entitlement and internal-test entitlement mechanism for development.

### Acceptance

- two-user RLS tests;
- anonymous isolation;
- browser cannot mutate protected/global accounting tables;
- login/logout flow works.

### Do not include

Real YouTube calls or billing.

## D2 — Real provider seam

Depends on D0. May run parallel to D1.

### Deliver

- `ChannelDiscoveryProvider`;
- YouTube channel resolution for ID URL / @handle;
- channel thumbnail/title/handle normalization;
- public Atom/RSS recent-upload parser;
- `VideoArtifactProvider` interface;
- Media Monitor adapter using authenticated service-to-service call;
- translation from provider sidecar to product Video/Summary shape;
- fake providers for tests.

### Acceptance

With real credentials in non-CI environment:

- resolve one real channel;
- list its recent upload hints;
- ensure one real arbitrary video through Media Monitor;
- inspect same video;
- no Media Monitor-specific object leaks through adapter tests.

### Do not include

Follow persistence, feed UI, summary charging.

## D3 — Follow lifecycle + bounded initial backfill

Depends on D1 + D2.

### Deliver

- resolve-channel route/UI preview;
- Following screen;
- create/delete Follow server paths;
- server-side follow limit;
- global Channel reuse;
- initial <=10-video metadata backfill for newly/stale channel;
- Undo after unfollow;
- empty state.

### Acceptance

Journeys A2, A3, A5, A6.

### Do not include

Automatic summary generation or background synchronization.

## D4 — Real chronological feed

Depends on D3.

### Deliver

- product Video read model query;
- Feed route/UI;
- stable cursor pagination;
- optional simple channel filter;
- responsive feed card;
- all non-AI metadata states;
- YouTube external link.

### Acceptance

A1, A4, F1.

Opening feed must not call summary provider.

## D5 — Shared lazy summary engine

Depends on D1 + D2 + D4.

### Deliver

- Summary state rendering;
- summary eligibility policy;
- generation endpoint;
- global `summary_key`;
- atomic generation claim;
- cache reuse;
- usage charging only for successful winning uncached generation;
- quota enforcement;
- <=2 browser-session concurrent requests;
- bounded retry state.

### Acceptance

B1–B7 plus F2.

### Cost checkpoint

Use a representative real sample and compute G1.

Do not build a provider/model benchmarking platform.

If the current Media Monitor model fails the cost guardrail, make the smallest provider configuration change necessary or adjust commercial allowance before proceeding.

## D6 — Global background channel sync

Depends on D3 + D2.

### Deliver

- due-channel claim query;
- authenticated internal sync endpoint;
- Cloud Scheduler identity;
- every-10-minute schedule;
- <=25 channels/run;
- <=5 concurrent Atom/RSS reads;
- unseen-video canonicalization through VideoArtifactProvider;
- per-channel next check/retry state;
- structured run log.

### Acceptance

C1–C4.

### Scale boundary

Do not add WebSub here.

If measured v1 load crosses the explicit WebSub trigger in ARCHITECTURE.md, create a post-v1 decision/task.

## D7 — One-plan billing + entitlements

Depends on D1. Completes only after D3/D5 enforcement integration.

### Deliver

- Polar adapter;
- one $3.99 paid product/price configuration;
- checkout route;
- verified idempotent webhook;
- entitlement state transitions;
- paid-through cancellation semantics;
- plan-limit copy;
- no timed trial.

### Acceptance

E1–E4.

### Do not include

Annual plan, coupons UI, metered overage, seat/team billing.

## D8 — Public demo + UX polish

Depends on D4 + D5.

### Deliver

- read-only demo feed from server-defined channels;
- cached summaries only;
- no anonymous generation;
- final Feed/Following loading/error/empty states;
- mobile polish;
- basic account/plan surface;
- pricing copy linking to checkout.

### Acceptance

D2, F1–F3, G2.

### Do not include

Curated collections as a user feature.

## D9 — Production hardening

Depends on D5 + D6 + D7 + D8.

### Deliver

- dedicated production GCP project/resources;
- Cloud Run production service + runtime SA;
- Secret Manager bindings;
- cross-project sidecar invoker IAM;
- Supabase production project/migrations/RLS;
- production Polar webhook;
- custom URL/domain;
- structured logs;
- bounded rate limits for expensive mutation endpoints;
- legal/privacy/support links;
- rollback/deploy runbook.

### Acceptance

D1–D3, G3.

Security review specifically verifies all costly operations are authenticated and entitlement-controlled.

## D10 — Sellable acceptance and launch candidate

Depends on D9.

### Deliver

No new product feature.

Run and capture:

- full ACCEPTANCE.md;
- real channel/follow/feed;
- real shared-summary two-user proof;
- billing sandbox/real test proof;
- new-upload sync proof;
- cost model;
- 24-hour soak;
- final production smoke;
- sanitized acceptance receipt.

### Result

Exactly one of:

- `READY_TO_SELL`
- `BLOCKED` with bounded blocker list.

Do not respond to failed acceptance by adding unrelated features.

## 3. Deferred DAG

Not part of v1:

```text
P1 WebSub extraction
P2 Media Monitor generic-YouTube extraction
P3 YouTube OAuth subscription import
P4 Curated/shareable channel packs
P5 Notifications/digests
P6 Read-later/read-state
P7 Translation
P8 Long-video processing
```

These nodes require new evidence/decision rather than being treated as unfinished launch work.
