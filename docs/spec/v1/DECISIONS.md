# DECISIONS — YouTube Following v1

Frozen decisions for development agents.

Change only through an explicit spec/ADR update.

## D-001 — Product is config + feed

**Decision:** v1 has Feed and Following as the only primary surfaces.

**Reason:** this is the differentiated product loop. Additional information-management features dilute the commodity-simple proposition.

## D-002 — One paid plan

**Decision:** launch default is USD 3.99/month, 30 channels, 600 minutes/month of newly generated uncached summaries.

**Reason:** keep positioning and entitlement logic understandable.

**Adjustment:** values are configuration and may change before launch if cost evidence requires it.

## D-003 — No timed free trial

**Decision:** public read-only demo + paid plan. Internal test entitlements for QA.

**Reason:** trial lifecycle, abuse and billing edge cases are low-return before product demand is established.

## D-004 — Lazy summaries

**Decision:** detecting an upload never automatically spends inference. Generation happens when an entitled user actually encounters eligible content.

**Reason:** dramatically reduces unused inference while preserving the perceived product experience.

## D-005 — Global summary reuse

**Decision:** one summary derivative may serve all users. Only the winner of the first successful uncached generation claim may consume generation allowance.

**Reason:** this is the core SaaS cost advantage.

## D-006 — Cloud Run, not Vercel, for v1

**Decision:** run the Next.js app on Cloud Run.

**Reason:** secure service-to-service invocation of the existing private Media Monitor sidecar through Google IAM, without long-lived GCP keys or federation plumbing.

Revisit hosting only if measured frontend/product needs justify it.

## D-007 — Supabase for Auth/Postgres/RLS

**Decision:** Supabase Auth + Postgres + RLS.

**Reason:** one relational product-state system with strong per-user isolation and minimal custom auth infrastructure.

Use email magic link in v1.

## D-008 — Polar for billing

**Decision:** Polar is the launch billing/Merchant-of-Record adapter.

**Reason:** keep tax/payment operational surface small for a low-price global subscription.

Product authorization uses local Entitlement rows derived from verified webhooks.

## D-009 — Do not extract Media Monitor yet

**Decision:** v1 invokes the proven Media Monitor sidecar through `VideoArtifactProvider`.

**Reason:** extraction before product proof is expensive architecture work with no user-visible return.

Extraction becomes a later node after product demand or ownership pressure is demonstrated.

## D-010 — Channel discovery is product-owned during transition

**Decision:** the product directly resolves channels and reads public Atom/RSS upload feeds; canonical video metadata/summary remains delegated to Media Monitor.

**Reason:** the current sidecar does not expose the needed channel-level product API. This is smaller than first refactoring the upstream system.

## D-011 — No product WebSub in v1

**Decision:** globally deduplicated bounded Atom/RSS sweeps are the v1 freshness mechanism.

**Reason:** WebSub lifecycle extraction is infrastructure complexity with little return at initial scale.

Trigger a new decision when:
- >150 active unique channels need <=1h freshness;
- due-channel backlog is recurrent;
- runtime limits become material;
- near-real-time upload latency becomes commercially important.

## D-012 — No queue in v1

**Decision:** summary generation is invoked from a bounded authenticated server request after winning a DB claim.

**Reason:** global claim state already handles deduplication; feed rendering is independent of generation; adding a queue is premature.

If provider latency/reliability exceeds request-runtime constraints in production, add a queue as a measured response.

## D-013 — Product DB has media read models, not a second authority

**Decision:** Channels/Videos/Summaries are projected into Postgres for efficient product queries.

**Reason:** the Feed must not make one upstream call per card.

Provider IDs/provenance are retained. During transition Media Monitor remains canonical artifact authority.

## D-014 — One global channel monitor

**Decision:** channel sync work is unique by Channel, not Follow.

**Reason:** N users following one channel should produce one discovery workload.

## D-015 — RSS is a hint

**Decision:** Atom/RSS discovers candidate video IDs. Media Monitor/official Data API path remains canonical for persisted video metadata.

**Reason:** preserves existing provenance while avoiding quota-heavy polling.

## D-016 — No YouTube account import

**Decision:** users paste channel URL or handle.

**Reason:** YouTube OAuth scope, consent, token storage and subscription import are not necessary to prove product value.

## D-017 — No recommendation algorithm

**Decision:** chronological ordering only.

**Reason:** source control is the product promise.

## D-018 — No transcript/chat product surface

**Decision:** v1 summaries are compact feed aids only.

**Reason:** avoids becoming a generic AI-video workbench.

## D-019 — Cost guardrail before paid launch

**Decision:** AI variable cost at full included usage <=25% of net receipts; total expected variable cost <=35%.

**Reason:** a $3.99 commodity product cannot rely on users under-consuming an uneconomic allowance.

## D-020 — Scale by evidence

Do not introduce Redis, Pub/Sub, workers, search infrastructure, analytics warehouse, extra microservices, or advanced admin tooling until a measured bottleneck demands them.

The default response to “we may need this later” is “defer it.”
