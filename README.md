# YouTube Following

A deliberately simple paid web app for following YouTube channels without living inside the recommendation algorithm.

**Product promise:** choose the channels; see what they publish, newest first; get enough summary to decide what deserves your time.

## Specification status

The v1 specification is normative under `docs/spec/v1/`.

Read in this order:

1. [PRODUCT.md](docs/spec/v1/PRODUCT.md) — user-visible behavior and business rules.
2. [ARCHITECTURE.md](docs/spec/v1/ARCHITECTURE.md) — technical boundaries and frozen stack decisions.
3. [CONTRACTS.md](docs/spec/v1/CONTRACTS.md) — domain and API contracts.
4. [ACCEPTANCE.md](docs/spec/v1/ACCEPTANCE.md) — executable user journeys and release gates.
5. [DEVELOPMENT_DAG.md](docs/spec/v1/DEVELOPMENT_DAG.md) — implementation graph and task nodes.
6. [DECISIONS.md](docs/spec/v1/DECISIONS.md) — frozen decisions, pruning, and scale triggers.

The original product exploration is archived at [docs/seed/SEED.md](docs/seed/SEED.md). It is historical context, not implementation authority.

## v1 shape

Two primary screens:

- **Feed** — reverse-chronological videos from followed channels.
- **Following** — add/remove YouTube channels.

The feed is the product. AI summaries support the feed; this is not a transcript workbench, chatbot, recommendation engine, or YouTube clone.

## Commercial default

One paid launch plan:

- **$3.99/month**
- **30 followed channels**
- **600 minutes/month of newly generated, previously uncached summaries**

Cached shared summaries do not consume a user's allowance.

A public read-only demo may exist, but anonymous users cannot trigger inference.

## Current architecture

```text
Browser
  ↓
Next.js web/API on Cloud Run
  ├─ Supabase Auth + Postgres + RLS
  ├─ Polar billing
  ├─ YouTube channel resolution / RSS discovery
  └─ private Media Monitor YouTube sidecar
       ├─ canonical video artifacts
       └─ governed summaries
```

The Media Monitor dependency is transitional. Do not extract it before the product vertical is proven.

## Development

Agents must follow [AGENTS.md](AGENTS.md) and implement the DAG one node at a time.
