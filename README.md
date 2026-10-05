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

## D0 local development

D0 is deliberately feature-empty. It contains the production-shaped Next.js foundation, two placeholder routes, a health endpoint, CI, environment validation, and a Cloud Run-compatible container. It does **not** contain auth, database schema, provider integration, billing, or follow behavior.

Use Node.js 24 LTS plus npm to match CI and the container image.

```bash
npm ci
npm run dev
```

Local routes:

- `http://localhost:3000/` — Feed placeholder.
- `http://localhost:3000/following` — Following placeholder.
- `http://localhost:3000/api/health` — health endpoint.

D0 has no required secrets. Runtime validation checks `NODE_ENV` and `PORT` when present.

Run the full local checks with:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs the same checks and builds the container.

For the Cloud Run-shaped local smoke:

```bash
docker build -t youtube-following:d0 .
docker run --rm -p 8080:8080 youtube-following:d0
curl http://localhost:8080/api/health
```

See [docs/deployment/GCP_NAMING.md](docs/deployment/GCP_NAMING.md) for the initial GCP project/resource naming plan.

## D1 authentication and data

Copy `.env.example` to `.env.local` and set the Supabase project URL, public anon/publishable key, server-only service-role key, and `APP_URL`. Configure Supabase Auth's site URL and redirect allow-list to include the exact callback URL `${APP_URL}/auth/callback`. In hosted environments `APP_URL` must use HTTPS. Never prefix the service-role key with `NEXT_PUBLIC_` or expose it to browser code.

The `supabase/` directory includes local CLI configuration. Start a local Supabase stack with `supabase start`, or link a hosted project with `supabase link --project-ref <project-ref>`, then apply migrations with `supabase db push`. New Auth users receive a profile and a zero-limit `none` entitlement through a database trigger. The migration restricts browser database access with RLS and column grants; product mutations use the server-only Supabase adapter.

For local QA only, set `ENABLE_INTERNAL_TEST_ENTITLEMENTS=1` and run `node scripts/grant-internal-test-entitlement.mjs <auth-user-uuid>` with the local Supabase URL and service-role key in the environment. The script refuses production mode, and the corresponding database function is executable only by the service role. Do not use this mechanism for customer entitlements.

`npm test` runs two-user and anonymous RLS integration tests by applying the actual migration to PGlite, an embedded PostgreSQL runtime. These tests execute PostgreSQL policies and grants without needing hosted credentials or a Docker daemon. Live Supabase email delivery and callback completion still require a configured project and mailbox; see [D1 acceptance evidence](docs/acceptance/D1.md).

## Development

Agents must follow [AGENTS.md](AGENTS.md) and implement the DAG one node at a time.
