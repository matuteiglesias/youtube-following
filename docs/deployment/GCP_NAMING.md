# GCP naming plan

This is the D0 naming plan only. It does not provision production infrastructure.

## Projects

Use dedicated projects with globally unique suffixes:

- development: `youtube-following-dev-<unique-suffix>`
- production: `youtube-following-prod-<unique-suffix>`

The exact project IDs and region are intentionally not frozen in D0. Production
resource creation belongs to D9 and should account for the private Media Monitor
sidecar location and measured latency before choosing a region.

## D0 resource names

Within a selected project:

| Resource | Name |
| --- | --- |
| Cloud Run service | `youtube-following-web` |
| Artifact Registry repository | `youtube-following` |
| Container image | `web` |
| Runtime service account | `youtube-following-runtime` |

Later DAG nodes may add resources with the same `youtube-following-` prefix,
but D0 does not create Scheduler, Secret Manager bindings, Supabase resources,
billing resources, or cross-project IAM.

## Development deployment smoke

A non-secret development deployment should use the D0 container unchanged,
listen on Cloud Run's `PORT`, and prove:

```text
GET /api/health
200
{"status":"ok","service":"youtube-following"}
```

No provider credentials are required for this smoke deployment.
