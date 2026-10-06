# D6 channel synchronization deployment

D6 keeps followed-channel video frontiers fresh without introducing a worker service,
queue, or second database.

This document describes the deployment contract only. Resource creation remains part
of the repository's normal development/production infrastructure workflow.

## Runtime path

```text
Cloud Scheduler (every 10 minutes)
        |
        | Google-signed OIDC token
        v
POST /api/internal/sync-channels
        |
        +--> claim <=25 due globally-followed channels
        +--> <=5 concurrent public Atom frontier reads
        +--> ensure only unseen videos through private Media Monitor
        +--> upsert product Video rows
        +--> release lease and schedule next check/retry
```

The upload frontier is keyless for already-known canonical channels. D6 does not call
the channel-resolution Data API and never generates summaries.

## Product runtime configuration

Required in production:

- `CHANNEL_SYNC_SCHEDULER_AUDIENCE`
- `CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL`
- existing Media Monitor caller variables:
  - `MEDIA_MONITOR_SIDECAR_URL`
  - `MEDIA_MONITOR_SIDECAR_AUDIENCE` when required
  - `MEDIA_MONITOR_ENSURE_PATH=/v1/youtube/videos/ensure`
  - `MEDIA_MONITOR_INSPECT_PATH=/v1/youtube/videos/inspect`
  - `MEDIA_MONITOR_SUMMARY_PATH=/v1/youtube/videos/summary`

`YOUTUBE_API_KEY` is not required for D6 frontier reads.

The Scheduler audience must exactly equal the `aud` configured on the job. Prefer
the full HTTPS internal route URL unless deployment policy deliberately uses a
different custom audience.

## Scheduler identity

Create a dedicated user-managed service account in the YouTube Following project,
for example:

```text
youtube-following-scheduler@PROJECT_ID.iam.gserviceaccount.com
```

Do not use the Cloud Scheduler service agent as the caller identity.

The application verifies the Google-signed OIDC token itself because the same Cloud
Run service also serves public product traffic. Verification checks:

- Google signature through Google's rotating JWKS;
- issuer;
- expiration/issued-at bounds;
- exact audience;
- exact scheduler service-account email;
- `email_verified`;
- non-empty subject.

No static shared Scheduler secret is introduced.

Google documents OIDC as the normal authentication mechanism for Scheduler HTTP
targets and recommends a dedicated service account.

## Example Scheduler command

Use deployment-specific values; do not commit them:

```bash
gcloud scheduler jobs create http youtube-following-channel-sync \
  --location="$REGION" \
  --schedule="*/10 * * * *" \
  --uri="$APP_RUN_URL/api/internal/sync-channels" \
  --http-method=POST \
  --oidc-service-account-email="$SCHEDULER_SERVICE_ACCOUNT_EMAIL" \
  --oidc-token-audience="$APP_RUN_URL/api/internal/sync-channels"
```

The service must also have the normal permissions required to read/write Supabase
through its server credential and invoke the private Media Monitor sidecar.

## Media Monitor prerequisite

Media Monitor exposes the governed sidecar contract at:

- `POST /v1/youtube/videos/ensure`
- `POST /v1/youtube/videos/inspect`
- `POST /v1/youtube/videos/summary`

D6 uses only `ensure`.

The YouTube Following runtime identity must have `roles/run.invoker` on the private
Media Monitor Cloud Run service. The sidecar itself currently requires its documented
single-writer deployment shape.

## Database claim semantics

Migration `202610060001_d6_channel_sync.sql` adds a short-lived
`sync_claim_until` lease and the service-role-only functions:

- `claim_due_channels(limit, lease_seconds)`
- `count_due_channels()`

A channel is due only when:

1. at least one current Follow references it;
2. `next_feed_check_at` is null or due;
3. no unexpired sync lease exists.

The claim uses `FOR UPDATE SKIP LOCKED`, so overlapping Scheduler requests do not
process the same channel concurrently. A crashed invocation does not strand a channel;
the lease expires and can be reclaimed.

## Run bounds

Frozen D6 defaults:

- <=25 claimed channels/run;
- <=5 concurrent Atom reads;
- 15 upload hints/channel;
- 5-minute claim lease;
- successful next check about one hour later with small jitter;
- failed retry about five minutes later with small jitter.

One failing channel does not abort unrelated channels.

Structured run output contains counts and bounded failure codes only. It must not
contain provider payloads, credentials, ID tokens, or secret-bearing exception text.

## Acceptance sequence

Before creating the recurring Scheduler job, prove manually:

1. missing/wrong Scheduler identity is rejected;
2. one approved signed identity reaches the route;
3. two users following the same channel produce one channel claim;
4. a known upload causes no Media Monitor ensure call;
5. a new upload is ensured exactly once and appears in the product Video table;
6. a channel failure receives a bounded retry while another channel completes;
7. no summary generation occurs.

After the manual proof, create/enable the every-10-minute job and observe at least
one bounded development run before production promotion.
