# CONTRACTS — YouTube Following v1

This document defines stable product-facing semantics. Exact framework routing may vary only when behavior and payload meaning remain equivalent.

All browser-facing JSON uses UTF-8, ISO-8601 timestamps, and stable string IDs.

## 1. Stable IDs

### Channel

```text
youtube-channel:<native_channel_id>
```

### Video

```text
youtube:<video_id>
```

### Summary key

Deterministically derived from:

```text
video_uid
summary_spec_version
language
```

The provider may have its own summary ID; preserve it separately.

## 2. Channel

```ts
type Channel = {
  channel_uid: string
  platform: "youtube"
  native_channel_id: string
  handle: string | null
  title: string
  canonical_url: string
  thumbnail_url: string | null
  monitoring_status: "active" | "idle" | "error"
}
```

## 3. Follow

```ts
type Follow = {
  channel_uid: string
  followed_at: string
}
```

A user's follow set cannot contain duplicate `channel_uid`.

## 4. Video

```ts
type Video = {
  video_uid: string
  channel_uid: string
  native_video_id: string
  title: string
  canonical_url: string
  thumbnail_url: string | null
  published_at: string
  duration_seconds: number | null
  availability: "public" | "private" | "unavailable" | "unknown"
  provider_snapshot_id: string | null
}
```

## 5. Summary

```ts
type SummaryState =
  | "available"
  | "generating"
  | "not_requested"
  | "short_video"
  | "long_video"
  | "live_or_upcoming"
  | "quota_blocked"
  | "failed"

type SummaryView = {
  state: SummaryState
  summary_id: string | null
  summary: string | null
  key_points: string[]
  language: string | null
  generated_at: string | null
  retryable: boolean | null
}
```

Browser responses do not need to expose provider/model provenance. Preserve provenance server-side/global read model for auditability.

## 6. FeedItem

```ts
type FeedItem = {
  video: Video
  channel: Pick<
    Channel,
    "channel_uid" | "title" | "handle" | "canonical_url" | "thumbnail_url"
  >
  summary: SummaryView
}
```

FeedItem is a projection and has no independent persistent identity.

## 7. Entitlement view

```ts
type EntitlementView = {
  plan_code: "paid" | "internal_test" | "none"
  status: "active" | "past_due" | "canceled" | "none"
  follow_limit: number
  follow_count: number
  generation_minutes_limit: number
  generation_minutes_used: number
  period_start: string | null
  period_end: string | null
}
```

The browser may display this object but cannot authoritatively mutate it.

## 8. Public API

### `POST /api/channels/resolve`

Authenticated.

Request:

```json
{"reference":"@futurock"}
```

Response 200:

```json
{
  "channel": {
    "channel_uid":"youtube-channel:UC...",
    "platform":"youtube",
    "native_channel_id":"UC...",
    "handle":"@futurock",
    "title":"Futurock",
    "canonical_url":"https://www.youtube.com/@futurock",
    "thumbnail_url":"https://..."
  },
  "already_followed": false
}
```

This route does not create a Follow.

Errors:

- `400 INVALID_CHANNEL_REFERENCE`
- `404 CHANNEL_NOT_FOUND`
- `503 YOUTUBE_UNAVAILABLE`

### `GET /api/follows`

Authenticated.

Returns:

```json
{"items":[{"channel":{...},"followed_at":"..."}],"limit":30}
```

### `POST /api/follows`

Authenticated.

Request:

```json
{"channel_uid":"youtube-channel:UC..."}
```

Server:

- checks entitlement;
- creates Follow idempotently;
- ensures bounded recent frontier if necessary.

Response 201/200:

```json
{"follow":{"channel_uid":"youtube-channel:UC...","followed_at":"..."}}
```

Errors:

- `404 CHANNEL_NOT_RESOLVED`
- `409 ALREADY_FOLLOWED` is optional; idempotent 200 is preferred
- `403 FOLLOW_LIMIT_REACHED`
- `503 PROVIDER_UNAVAILABLE`

### `DELETE /api/follows/{channel_uid}`

Authenticated.

Idempotent.

Returns 204.

Undo uses `POST /api/follows` again.

### `GET /api/feed`

Authenticated.

Query:

- `cursor` optional;
- `channel_uid` optional;
- `limit` optional, max 50, default 20.

Response:

```ts
type FeedPage = {
  items: FeedItem[]
  next_cursor: string | null
}
```

Cursor must encode the stable ordering boundary and must not expose SQL.

The route never triggers inference.

### `POST /api/videos/{video_uid}/summary`

Authenticated and entitlement-controlled.

Semantics:

- cached available summary → 200 and no usage;
- caller wins new global generation claim → perform provider generation;
- another caller already owns claim → 202 `generating`;
- ineligible video → 200 bounded state;
- insufficient allowance → 200 `quota_blocked`;
- provider failure → bounded `failed`, no charge.

Response 200/202:

```json
{"summary":{"state":"available","summary_id":"...","summary":"...","key_points":[]}}
```

The browser cannot specify provider, model, prompt, or arbitrary prompt text.

### `GET /api/me/entitlement`

Authenticated.

Returns `EntitlementView`.

### `POST /api/billing/checkout`

Authenticated.

Creates checkout for the single paid plan.

Response:

```json
{"checkout_url":"https://..."}
```

The server attaches a stable internal user reference to the checkout.

### `POST /api/webhooks/polar`

Public network endpoint, cryptographically authenticated by verified webhook signature.

Must be idempotent by billing event ID.

Updates Entitlement only after successful verification.

Never trusts browser-supplied billing state.

## 9. Internal sync endpoint

### `POST /api/internal/sync-channels`

Not browser-authenticated.

Requires a verified Google OIDC token from the dedicated Cloud Scheduler identity.

Behavior:

- atomically claim <=25 due active unique channels;
- read Atom/RSS feed with bounded concurrency;
- identify unseen video IDs;
- use VideoArtifactProvider to canonicalize new videos;
- upsert global Video read model;
- schedule next check;
- return sanitized run counts.

Response:

```json
{
  "checked": 25,
  "new_videos": 3,
  "failures": 1,
  "remaining_due": 0
}
```

One channel failure does not abort unrelated channels.

## 10. Provider interfaces

Application code depends on interfaces, not vendor-specific calls.

```ts
interface ChannelDiscoveryProvider {
  resolve(reference: string): Promise<ResolvedChannel>
  listRecentUploads(
    channel: ResolvedChannel,
    limit: number
  ): Promise<UploadHint[]>
}

interface VideoArtifactProvider {
  ensureVideo(videoReference: string): Promise<ProviderVideo>
  inspectVideo(videoUid: string): Promise<ProviderVideo | null>
  ensureSummary(videoUid: string): Promise<ProviderSummaryResult>
}
```

`MediaMonitorVideoArtifactProvider` is the initial implementation.

## 11. Error envelope

API errors use:

```json
{
  "error": {
    "code": "FOLLOW_LIMIT_REACHED",
    "message": "You've reached your channel limit."
  }
}
```

Do not include:

- stack traces;
- upstream request bodies;
- credentials;
- raw provider errors.

## 12. Summary usage invariant

A `summary_usage` row can exist only after:

- a previously uncached global summary was successfully generated;
- the user owned the winning generation claim.

Unique `summary_key` in usage guarantees a shared summary is not charged twice to multiple users.

Retry/failure cannot create usage.

## 13. Browser trust boundary

The browser may request operations.

The browser may never authoritatively specify:

- follow/generation limits;
- usage consumed;
- entitlement state;
- billing state;
- provider/model choice;
- summary duration charged;
- whether a summary was cached.
