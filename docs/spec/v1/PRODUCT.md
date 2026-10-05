# PRODUCT — YouTube Following v1

## 1. Product promise

YouTube Following is a simple alternative to the algorithmic YouTube home page.

> Follow the creators you care about. See what they publish. Understand each new video well enough to decide whether it deserves your time.

The user chooses the sources. The service provides a chronological activity feed plus compact summaries.

The feed is the product. AI is a supporting capability.

## 2. Target user

The v1 user:

- follows a bounded number of YouTube creators intentionally;
- dislikes depending on YouTube's recommendation surface to discover new uploads;
- wants to scan activity quickly;
- values a short explanation more than a transcript or AI chat interface;
- is willing to pay a small commodity-style subscription for a quieter, controlled feed.

v1 is not optimized for power-user media research workflows. Media Monitor already serves that separate domain.

## 3. Primary screens

There are exactly two primary screens.

### Feed

Default authenticated route.

One reverse-chronological stream of public videos from followed channels.

Desktop target width: roughly 760–900 px.

No recommendation sidebar. No trending module. No multi-column masonry layout.

Header:

```text
Following                         [All channels ▾]
```

Channel filtering is optional and simple. No advanced filters.

### Following

A configuration surface, not a discovery marketplace.

```text
Following                                             12 / 30

[ Paste YouTube channel URL or @handle              ] [Add]

[channel image]  Futurock
                 @futurock
                 youtube.com/@...
                                                    Unfollow
```

## 4. Feed card

Desktop:

```text
Futurock · 2h ago · 31 min

┌──────────────────┐   GANÓ BOLSONARO PERO HABRÁ
│                  │   SEGUNDA VUELTA
│    thumbnail     │
│                  │   Brazil's election moves to...
└──────────────────┘
                       • useful point
                       • useful point
                       • useful point

                       Watch on YouTube ↗
```

Mobile stacks thumbnail above text.

Required fields:

- channel title;
- published time;
- duration when known;
- thumbnail;
- video title;
- summary state;
- YouTube link.

Do not show likes, comments, engagement scores, recommendation scores, or ranking badges.

## 5. Feed semantics

Ordering:

```text
published_at DESC,
video_uid DESC
```

The second key is only a stable tie-breaker.

Initial page: 20 items.

Cursor pagination is required. Infinite scroll or a Load more control are both acceptable.

There is no personalized ranking in v1.

## 6. Adding a channel

Accepted references:

- `https://youtube.com/channel/<id>`;
- `https://youtube.com/@handle`;
- `@handle`;
- equivalent public `www.youtube.com` forms that resolve unambiguously.

Flow:

```text
paste reference
  ↓
Resolving…
  ↓
canonical preview
  channel image
  title
  handle
  [Follow]
  ↓
Follow
  ↓
recent videos appear in Feed
```

The preview/confirmation step is mandatory.

On first global follow of a channel, ingest a bounded frontier of the latest 10 videos. This is metadata work only.

No historical bulk summarization.

### Add errors

User-visible error codes/messages:

- invalid reference → “That doesn't look like a YouTube channel.”
- not found → “We couldn't find that channel.”
- already followed → “You're already following this channel.”
- plan limit → “You've reached your channel limit.”
- upstream unavailable → “YouTube is temporarily unavailable. Try again shortly.”

Never surface raw provider errors.

## 7. Unfollowing

Unfollow is immediate and does not require a modal.

Show:

```text
Unfollowed Futurock.    Undo
```

Undo simply recreates the Follow.

Unfollowing removes the user's relationship only. It does not delete global Channel, Video, Summary, or provider artifacts.

If no users and no demo configuration follow a channel, the product may stop actively synchronizing it after a short grace period.

## 8. Empty states

### No follows

```text
Your feed starts with the people you choose.

Follow a YouTube channel and its latest videos will appear here.

[ Paste channel URL or @handle ] [Add]
```

No recommendations are required.

### Follows but no content

```text
Nothing new from your channels yet.

Their next uploads will appear here automatically.
```

## 9. Summary content

An available summary contains:

- one compact explanatory paragraph, target 40–80 words;
- zero to three materially distinct key points.

Key points should normally fit in one sentence each.

The question the summary answers is:

> Do I care enough to watch this?

It is not intended to replace the complete video.

## 10. Summary states

Every card remains useful without a summary.

### `available`

Show paragraph + key points.

### `generating`

Render metadata immediately and show:

```text
Summarizing…
```

The feed never waits on AI.

### `short_video`

For duration < 90 seconds:

```text
Short clip
```

Do not automatically generate a summary.

### `long_video`

For duration > 120 minutes:

```text
Long video
Automatic summary not available yet.
```

No long-video agentic fallback in v1.

### `live_or_upcoming`

Do not summarize until a stable completed video exists.

### `quota_blocked`

```text
Summary allowance reached for this month.
```

The card and YouTube link still work. Cached summaries still display.

### `failed`

```text
Summary temporarily unavailable.
```

No fake or partial summary. Failure is not chargeable usage.

## 11. Lazy summary policy

New upload detection does **not** imply inference.

```text
new video metadata
  ↓
feed card can render
  ↓
user encounters eligible card
  ↓
cached summary?
  ├─ yes → display
  └─ no  → request generation if entitled
```

The UI may automatically request summaries for cards as they enter the user's active browsing frontier.

Implementation must bound concurrent generation requests; v1 target is at most 2 active generation requests per browser session.

The server remains authoritative for entitlement, deduplication, and usage charging.

## 12. Global summary reuse

Summary identity is global to a video + summary specification + language.

If many users encounter the same video, one successful generation serves all of them.

Only the user who wins the first successful uncached generation claim may be charged generation minutes.

Concurrent losers are not charged.

A cached read never consumes generation allowance.

## 13. Summary language

v1 uses the video's primary spoken language.

No automatic translation in v1.

## 14. Commercial model

Launch with one paid plan.

### Paid

- price: **USD 3.99/month**;
- follow limit: **30 channels**;
- generation allowance: **600 video-minutes/month** of newly generated, previously uncached summaries.

Limits are configuration, not hard-coded business logic.

Duration accounting is deterministic and server-side. Round charged usage up to the next whole video-minute.

Failed generations consume zero minutes.

### Public demo

A read-only curated/demo feed may be public.

It can show cached summaries.

Anonymous users cannot:

- follow channels;
- trigger summary generation;
- consume paid provider capabilities.

### No timed free trial in v1

Timed trials are deliberately pruned from v1 because they add entitlement lifecycle and abuse-control complexity.

Internal/admin-granted test entitlements are allowed for QA.

Promotions/coupons may be added later through the billing provider without changing product semantics.

## 15. Cost guardrail

The $3.99 plan is not allowed to hide an uneconomic inference policy.

Before paid launch:

- estimate variable AI cost from a representative sample of real videos;
- project the cost at the full 600-minute allowance;
- expected AI variable cost at full included usage should be <= 25% of net subscription receipts;
- expected total variable cost should be <= 35% of net subscription receipts.

If the guardrail fails, change the configured model, included allowance, or price before launch.

Do not add complicated per-request pricing to rescue a bad default plan.

## 16. Explicit v1 non-goals

Do not implement:

- YouTube account/OAuth subscription import;
- recommendation algorithms;
- trending/discovery pages;
- transcript browser;
- chat/Q&A;
- notes or bookmarks;
- read/unread state;
- email or push notifications;
- native mobile apps;
- social comments/likes;
- user-created collections;
- curated-pack product flows;
- translated summaries;
- transcript storage as a product;
- historical bulk summarization;
- long-video agentic processing;
- multiple summary formats;
- custom AI prompts;
- creator analytics;
- admin dashboard.

These are future possibilities, not unfinished v1 work.
