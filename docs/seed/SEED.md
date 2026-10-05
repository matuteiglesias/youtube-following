# YouTube Following v1

## 1. Product promise

YouTube Following is a deliberately simple alternative to the algorithmic YouTube home page.

The user chooses the channels.

The product shows what those channels published, newest first, with just enough summary to decide what deserves attention.

Core promise:

> Follow the YouTube creators you care about. See what they publish. Understand each new video without opening YouTube first.

The feed is the product.

AI summaries support the feed; they are not a separate AI workbench.

The product should feel closer to GitHub Following than to a YouTube clone.

---

# 2. Product shape

There are only two primary screens:

1. Feed
2. Following

There is a minimal account/plan surface, but it is not a primary workflow.

No dashboard maze.

No library hierarchy.

No chat interface.

No recommendation page.

---

# 3. Navigation

Desktop:

    [YouTube Following]     Feed     Following                 Account

Mobile:

    YouTube Following

    Feed     Following

The default route after login is Feed.

---

# 4. Feed screen

## 4.1 Normal state

The feed is one reverse-chronological stream containing videos published by channels the user follows.

Desktop content width should be approximately 760–900 px.

No multi-column Pinterest layout.

No recommendation sidebar.

No unrelated trending content.

Header:

    Following

    [All channels ▾]

Optional channel filtering is allowed through one simple selector.

No advanced filtering in v1.

---

## 4.2 Feed card

Desktop conceptual layout:

    Futurock · 2h ago · 31 min

    ┌──────────────────┐   GANÓ BOLSONARO PERO HABRÁ
    │                  │   SEGUNDA VUELTA
    │    thumbnail     │
    │                  │   Brazil's election moves to...
    └──────────────────┘
                           • First useful point
                           • Second useful point
                           • Third useful point

                           Watch on YouTube ↗

Mobile stacks the thumbnail above the text.

Required card fields:

- channel name
- published time
- video duration
- thumbnail
- video title
- summary state
- Watch on YouTube action

Optional but acceptable:

- current view count
- exact publication timestamp on hover/details

Do not show:

- comments
- likes
- recommendation scores
- engagement-ranking badges

The product must not become another attention-ranking algorithm.

---

# 5. Summary presentation

An available summary contains:

1. one compact explanatory paragraph;
2. up to three key points.

Target paragraph:

- approximately 40–80 words;
- enough to communicate the central subject or argument;
- no generic filler.

Each key point:

- one sentence;
- preferably under approximately 20 words;
- materially distinct from the other points.

The card should remain scannable.

The summary is not intended to replace the entire video.

Its purpose is:

> Do I care enough to watch this?

---

# 6. Summary states

Every feed card must remain useful even without AI.

## AVAILABLE

Display:

    Short summary paragraph.

    • key point
    • key point
    • key point

    Watch on YouTube ↗

---

## QUEUED / GENERATING

The complete metadata card renders immediately.

Display a compact placeholder:

    Summarizing…

A subtle skeleton is acceptable.

Do not block rendering of the video card.

Do not block the feed.

---

## SHORT_VIDEO

Videos shorter than the automatic-summary threshold remain normal feed items.

Display:

    Short clip

    Watch on YouTube ↗

No automatic AI expenditure.

Launch threshold:

    duration < 90 seconds

---

## LONG_VIDEO

Automatic static processing is bounded.

Launch threshold:

    duration > 120 minutes

Display:

    Long video
    Automatic summary not available yet.

    Watch on YouTube ↗

Long-video agentic processing is future work.

---

## LIVE_OR_UPCOMING

Display:

    Live / upcoming

No summary is generated until a stable completed video is available.

---

## QUOTA_BLOCKED

The feed itself continues working.

Display:

    Summary allowance reached for this month.

    Watch on YouTube ↗

Previously generated global summaries remain visible even when the user's generation allowance is exhausted.

---

## FAILED

Display:

    Summary temporarily unavailable.

    Watch on YouTube ↗

A transient failure may be retried automatically on a later visit.

Do not expose raw provider errors.

Do not create fake or partial summaries.

---

# 7. Lazy summary policy

This is a central product and business rule.

New video detection does NOT automatically mean AI generation.

Instead:

    new video
       ↓
    metadata becomes available
       ↓
    feed can display it immediately
       ↓
    user actually encounters the card
       ↓
    cached summary exists?
        ├─ yes → display it
        └─ no  → request generation if entitled

Therefore:

- unused accounts generate essentially no summary cost;
- historical backlogs are not blindly summarized;
- shared summaries become cheaper as the service grows;
- the user still experiences summaries as an intrinsic part of the feed.

The first visible feed items may be proactively queued when the feed opens.

Additional summaries may be requested as cards enter the visible browsing frontier.

Exact prefetch count is implementation-level and may be tuned without changing product semantics.

---

# 8. Global summary reuse

Summaries are global derivatives of videos, not user-owned objects.

Conceptually:

    Video
      ↓
    Summary(video_uid, summary_spec, language)

If 500 users follow the same channel and encounter the same video:

    one canonical video
    one canonical summary
    500 consumers

Concurrent first requests for the same summary must collapse into one effective provider generation.

A cached summary never consumes another user's generation allowance.

---

# 9. Summary language

v1 summaries use the primary spoken language of the video.

This maximizes global reuse and keeps one canonical summary derivative per normal case.

Translation is explicitly future work and would create a separate language-specific derivative.

---

# 10. Feed semantics

Ordering:

    published_at DESC
    item_uid as stable tie-breaker

No engagement ranking.

No personalized scoring.

No algorithmic recommendations.

Initial page:

    approximately 20 feed items

Pagination/infinite continuation is acceptable.

Feed retention may be bounded operationally, but users should normally be able to browse at least their recent activity window.

---

# 11. Following screen

Normal state:

    Following                                      12 / 30

    [ Paste a YouTube channel URL or @handle      ] [Add]

    -------------------------------------------------------

    [channel image]  Futurock
                     @futurock
                     youtube.com/@...
                                            Unfollow

    [channel image]  El Destape
                     @eldestape
                     youtube.com/@...
                                            Unfollow

The screen deliberately resembles configuration, not discovery.

There is no catalog of recommended creators in v1.

---

# 12. Adding a channel

Accepted input:

- canonical channel URL;
- YouTube `@handle`;
- supported equivalent public channel URL.

Flow:

    paste reference
        ↓
    Resolving…
        ↓
    canonical channel found
        ↓
    preview:
        channel name
        handle if available
        channel image
        [Follow]
        ↓
    Follow
        ↓
    channel appears in Following
        ↓
    recent videos appear in Feed

The confirmation step prevents silently following the wrong resolved channel.

---

# 13. Initial channel backfill

Following a new channel should make the product immediately useful.

On first follow, ingest a bounded recent frontier:

    latest 10 videos

This is metadata backfill.

It does NOT trigger bulk summary generation.

Only summaries actually encountered through normal feed browsing become candidates for generation.

---

# 14. Add-channel error states

## Invalid reference

    That doesn't look like a YouTube channel.

## Not found

    We couldn't find that channel.

## Already followed

    You're already following this channel.

## Plan limit

    You've reached your 30-channel limit.
    Unfollow a channel to add another.

## Provider unavailable

    YouTube is temporarily unavailable.
    Try again shortly.

Raw upstream error messages are never shown.

---

# 15. Unfollowing

Unfollow is immediate.

No confirmation modal.

After action:

    Unfollowed Futurock.        Undo

The feed immediately excludes videos contributed only by that follow.

Undo restores the follow.

Unfollowing does NOT delete:

- global Channel;
- global Video;
- global Summary;
- canonical provider artifacts.

It only removes the user → channel relationship.

---

# 16. Empty states

## No follows

Primary empty state:

    Your feed starts with the people you choose.

    Follow a YouTube channel and its latest videos
    will appear here.

    [ Paste channel URL or @handle               ] [Add]

No recommendations are required.

---

## Follows exist, no current content

    Nothing new from your channels yet.

    Their next uploads will appear here automatically.

---

# 17. Commercial model — launch defaults

Launch paid plan:

    $3.99 / month

Entitlement:

    30 followed channels
    600 minutes/month of newly generated video summaries

Important distinction:

The summary-minute allowance is charged only when this account causes a previously uncached summary to be generated.

If the global summary already exists:

    cost to user allowance = 0

Failed generations do not consume allowance.

Duration accounting should be deterministic and server-side.

Launch allowance values are configuration, not hard-coded product constants.

---

# 18. Trial/demo policy

Do NOT launch with an unlimited anonymous summarization endpoint.

Recommended launch funnel:

## Public demo

A read-only feed of curated channels using already-generated summaries.

No anonymous inference generation.

## Trial account

Suggested:

    5 channels
    60 minutes of newly generated summaries

Trial duration may be approximately seven days.

## Paid

    30 channels
    600 generation minutes/month

The billing provider is not part of product semantics.

Billing ultimately produces an entitlement record.

---

# 19. When allowance is exhausted

The service must not become useless.

Continue providing:

- all followed-channel metadata;
- chronological feed;
- all cached global summaries;
- links to YouTube.

Only new uncached summary generations are blocked.

This keeps the paid limit understandable and prevents an inference-cost failure from becoming an application failure.

---

# 20. Why limits exist

There are two independent bounded resources:

## Follow limit

Controls:

- monitored unique-channel surface;
- reconciliation/API workload;
- product complexity/noise.

## Summary-generation allowance

Controls:

- model inference cost.

Do not attempt to control both through one arbitrary "number of summaries" concept.

---

# 21. Core domain model

## User

Product identity.

Fields conceptually include:

    user_id
    created_at
    entitlement

---

## Channel

Global canonical object.

    channel_uid
    platform = youtube
    native_channel_id
    handle
    title
    canonical_url
    thumbnail_url
    status

Canonical identity:

    youtube-channel:<native_channel_id>

A channel exists once globally regardless of follower count.

---

## Follow

User-specific relation.

    user_id
    channel_uid
    followed_at

Unique:

    (user_id, channel_uid)

No duplicate follows.

---

## Video

Global canonical object.

    video_uid
    channel_uid
    native_video_id
    title
    description
    canonical_url
    thumbnail_url
    published_at
    duration_seconds
    availability
    metadata_snapshot_id

Canonical identity:

    youtube:<video_id>

---

## Summary

Global derivative.

    summary_id
    video_uid
    summary_spec_version
    language
    state
    summary
    key_points
    provider
    model
    generated_at
    provenance

Unique derivation identity must make repeated generation idempotent.

---

## SummaryUsage

User-specific commercial accounting.

Conceptually:

    user_id
    billing_period
    generated_video_uid
    charged_minutes
    created_at

A cached summary read does not create chargeable usage.

Provider failure does not create chargeable usage.

---

## FeedItem

FeedItem is a projection, not primary persisted truth.

It joins:

    Video
    Channel
    optional Summary
    summary eligibility/state

---

# 22. Provider boundary

The product must not know Media Monitor internals.

Conceptual interface:

    resolve_channel(reference)
        -> Channel

    ensure_channel_frontier(channel_uid, limit)
        -> Video[]

    list_videos(channel_uids, cursor)
        -> Video[]

    inspect_video(video_uid)
        -> Video + derivatives

    ensure_summary(video_uid, summary_spec)
        -> Summary

The web application consumes this interface.

---

# 23. Current transitional architecture

Initially:

    YouTube Following UI/API
            ↓
    YouTubeContentProvider
            ↓
    Media Monitor YouTube runtime
            ↓
    YouTube / Gemini / GCS

This permits product development immediately without rebuilding acquisition infrastructure.

The adapter must prevent Media Monitor-specific concepts from leaking into the product domain.

---

# 24. Event architecture

Channels are GLOBAL.

Do not create one WebSub subscription per user.

Correct:

    Channel Futurock
          ↓
    one channel monitoring relationship
          ↓
    N user Follow rows

Likewise, reconciliation operates over unique active channels.

---

# 25. Update strategy

Normal path:

    YouTube WebSub
        ↓
    channel/video event
        ↓
    canonical metadata refresh

Safety path:

    slow bounded reconciliation
        ↓
    unique active channels
        ↓
    catch missed events / state changes

The existing 30-minute Media Monitor policy must NOT automatically become the commercial application's per-channel polling policy.

At product scale, reconciliation cadence should be substantially slower and globally deduplicated.

---

# 26. Persistence choices

User/product state is relational:

    users
    follows
    entitlements
    usage ledger

Use a relational database such as Postgres.

Canonical media/summary artifacts remain globally reusable provider content.

During transition they remain in the existing Media Monitor/GCS substrate.

After extraction they may remain GCS-backed under the new owning service.

FeedItems do not require their own canonical table unless later performance evidence justifies one.

---

# 27. Eventual extraction boundary

Once the product vertical is proven, generic YouTube capabilities migrate from Media Monitor into the new service/repository:

Generic:

- channel resolution;
- canonical channel identity;
- canonical video identity;
- YouTube Data API client;
- WebSub;
- reconciliation;
- video metadata artifacts;
- global summary generation;
- GCS artifact semantics.

Media Monitor retains:

- appearances;
- editorial/research-specific segmentation;
- sensing workflows;
- domain-specific evidence;
- other media-monitor producers.

After extraction:

    youtube-following / generic YouTube service
                    ↓
             stable contracts
             ↙             ↘
    consumer app        Media Monitor

Media Monitor becomes a consumer rather than the generic YouTube infrastructure owner.

---

# 28. Explicit v1 non-goals

Do not implement in v1:

- YouTube subscription import;
- OAuth access to the user's YouTube account;
- recommendation algorithm;
- trending page;
- creator discovery;
- transcript browser;
- chat with video;
- Q&A;
- notes;
- bookmarks;
- read/unread state;
- email digest;
- push notifications;
- native mobile application;
- comments;
- likes;
- embedded social features;
- user-created collections;
- public curated collections;
- translated summaries;
- transcript storage as a product;
- arbitrary historical bulk summarization;
- automatic summarization of the entire backlog;
- long-video agentic processing;
- multiple summary formats;
- custom AI prompts.

These are possible future products/features, not missing MVP work.

---

# 29. Executable acceptance journeys

## Journey A — first channel

Given a new user with zero follows,

when they paste a valid public YouTube channel,

then the product resolves it and shows a canonical preview.

When the user clicks Follow:

- Follow persists;
- Following count becomes 1;
- up to 10 recent videos appear in Feed;
- no bulk summary run occurs.

PASS only if this uses real YouTube data.

---

## Journey B — feed-first summary

Given an unsummarized eligible video in the user's feed,

when the user encounters that card:

- metadata renders immediately;
- summary enters Summarizing state;
- generation occurs asynchronously;
- the card eventually displays a valid summary and key points.

Reloading the page:

- displays the same summary;
- causes no second provider generation.

---

## Journey C — shared summary

Given users A and B follow the same channel,

and A causes a video's summary to be generated,

when B later sees the same video:

- B receives the existing summary;
- no new model call occurs;
- B's uncached-generation allowance is unchanged.

This is a release-critical economic invariant.

---

## Journey D — new upload

Given a user follows a channel,

when that channel publishes a new public video:

- the global channel monitor learns about it without user action;
- the video enters the user's feed;
- the feed ordering is correct;
- no summary generation is required before it appears.

---

## Journey E — unfollow

Given the user follows a channel,

when they click Unfollow:

- the relationship disappears;
- that channel's feed items disappear;
- an Undo action appears;
- global media objects remain intact.

Undo restores the relationship.

---

## Journey F — channel limit

Given a paid account already follows 30 channels,

when the user tries to follow channel 31:

- no Follow is created;
- no monitoring resources are provisioned because of that request;
- the UI explains the limit.

---

## Journey G — summary allowance

Given the account has exhausted its generation-minute allowance,

when it encounters an uncached video:

- the video card still renders;
- Watch on YouTube works;
- no model call occurs;
- the card shows the allowance state.

Cached summaries continue to display.

---

## Journey H — provider failure

Given YouTube metadata exists but summary inference fails:

- the feed remains usable;
- no fake summary is persisted;
- no usage is charged;
- the user sees a bounded failure state.

A later retry can converge to Available.

---

## Journey I — short video

Given an eligible channel publishes a video under 90 seconds:

- it appears normally in Feed;
- no automatic summary is generated;
- it is labeled as a short clip.

---

## Journey J — first sellable deployment

A release candidate is considered sellable only if:

- authentication works;
- entitlement enforcement works server-side;
- Follow data is isolated per user;
- public users cannot invoke unbounded inference;
- real channels can be followed;
- real new videos arrive automatically;
- shared summary deduplication is demonstrated;
- generation allowance cannot be bypassed through client calls;
- provider credentials never reach the browser;
- billing state can enable/disable the paid entitlement;
- cancellation does not destroy the user's account data immediately;
- normal application operation requires no developer intervention.
