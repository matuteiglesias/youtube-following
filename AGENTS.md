# Agent development rules

This repository is intentionally small. Preserve that property.

## Before coding

Read, in order:

1. `docs/spec/v1/PRODUCT.md`
2. `docs/spec/v1/ARCHITECTURE.md`
3. `docs/spec/v1/CONTRACTS.md`
4. `docs/spec/v1/ACCEPTANCE.md`
5. `docs/spec/v1/DEVELOPMENT_DAG.md`
6. `docs/spec/v1/DECISIONS.md`

`docs/seed/SEED.md` is historical context only. If it conflicts with the v1 specs, the v1 specs win.

## Work discipline

- Implement **one DAG node per branch/PR** unless the node explicitly says otherwise.
- Do not pull future-node work into the current node.
- Prefer boring, direct code over generic frameworks.
- Do not introduce a queue, event bus, worker platform, second database, or microservice without a new explicit decision.
- Do not extract YouTube infrastructure from Media Monitor during v1.
- Do not introduce recommendations, transcripts, chat, collections, notifications, YouTube OAuth import, or native mobile features.
- Keep vendor-specific integrations behind narrow adapters.
- All entitlement and cost controls are enforced server-side.
- Never expose provider credentials to the browser.
- Never allow anonymous inference generation.

## Definition of done for a node

A DAG node is complete only when:

- its code is scoped to that node;
- automated tests cover its specified behavior;
- relevant acceptance evidence is captured;
- no secrets are committed;
- migrations are reversible or forward-safe;
- the worktree is clean;
- the PR states what was deliberately not implemented.

If live infrastructure is part of the node, include sanitized live evidence.

## Product invariants

Never violate these:

1. The user chooses every followed channel.
2. Feed order is chronological, not engagement-ranked.
3. Metadata renders without waiting for AI.
4. One global video/summary may serve many users.
5. A cached summary costs another user zero generation allowance.
6. Failed generation consumes no allowance.
7. Follow limits and summary-generation limits are independent.
8. Unfollowing removes only the relationship; it never deletes global media artifacts.
9. Public/demo users cannot cause unbounded provider spend.
10. Media Monitor internals never leak into the browser-facing product contract.
