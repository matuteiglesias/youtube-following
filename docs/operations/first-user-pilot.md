# First-user pilot — 19 October 2026

## Goal

One human can use the deployed product as a **daily chronological reader**, with
El Destape and Futurock FM as an initial two-channel test. This is a first-user
acceptance pilot, **not** a paid launch or proof of end-to-end summary quality.

## Existing infrastructure observed (read-only)

- Cloud Run web: `https://youtube-following-web-azt5ox4xuq-rj.a.run.app`;
  `GET /api/health` returned 200 on October 19.
- Media Monitor private YouTube sidecar: deployed and Ready in `media-monitor-tool`.
- Cloud Scheduler job `youtube-following-channel-sync`: enabled, every 10 minutes.
  Enabled does **not** prove successful updates or a completed new-video smoke.
- Web runtime lists Supabase, YouTube and Media Monitor configuration variables.
  Presence does **not** prove their values or end-to-end operation.
- `/demo` served 200 but reported no demo channels configured;
  `DEMO_CHANNEL_UIDS` is absent in the deployed service.
- Anonymous `POST /api/videos/youtube:abcdefghijk/summary` returned 401.
- No authenticated end-to-end user journey or actual cached summary has been
  verified in this intervention.

## First-user journey (no shell commands)

1. Open `https://youtube-following-web-azt5ox4xuq-rj.a.run.app/login`.
   Complete the magic-link flow using your test account. If delivery/callback
   fails, record it as an auth blocker, not a UI problem.
2. In **Following**, paste `https://www.youtube.com/@ElDestapeTV`;
   inspect the canonical preview, then confirm **Follow**.
3. Repeat with `https://www.youtube.com/@FuturockFM`. The canonical preview
   matters: a handle alone should never create a silent follow.
4. Open **Feed**. Confirm new-to-old order, both channels visible, reasonable
   thumbnails/titles/timestamps, and an available external YouTube link.
   **Read summary** opens the selected-video sidecar; on phones this is a
   full-screen reading pane, dismissible with Close or Escape.
5. Select a *completed, public video of 90 seconds to 120 minutes*. Confirm:
   - A cached summary, if available, appears without consuming generation
     allowance.
   - An uncached summary generates only when the video is selected and the
     test account is entitled.
   - Network failures show a bounded error and allow retry.
   - Moving through the feed without opening cards makes no inference request.
6. Reopen the same video. Confirm cache reuse and zero additional
   generation-minute charge. Confirm later channel uploads appear without
   manually invoking any backfill scripts.

## Known limitations / explicit gates

- The product's v1 eligibility policy excludes videos <90 seconds, >120 minutes,
  live/upcoming, and unavailable videos from automatic summarization. **Long
  livestreams and full radio shows will often be outside the permitted range.**
  For this first pilot use completed clips; do not silently change the cost
  policy or label metadata as AI-generated summaries.
- The public demo is a **read-only cache projection**, not a background content
  collector. Do not set demo-channel IDs unless those channels have real
  product database rows and suitable public/cached content.
- Live login, actual follow persistence/backfill, feed freshness, long-form
  summary eligibility and the first successful real-generation cost remain
  unverified. Browser acceptance at desktop/mobile widths remains required.
- A test account needs an appropriate entitlement for new summaries.
  Do not enable anonymous inference or bypass server-side limits.
- Cloud Run currently resides in the shared `media-monitor-tool` project;
  the dedicated production project from the frozen architecture is still a
  later sellable-release consideration. No Polar/billing proof in this pilot.

## Required success receipt

Capture only non-secret facts: timestamp, test account pseudonym, resolved
channel handles/IDs, feed counts and latest publication time per channel,
selected video IDs and duration/status, summary state and whether cached,
usage-before/after, observed new-upload latency, and any bounded errors.
Keep actual usernames, access tokens, provider payloads and billing secrets
out of repository logs.

## Decision

The pilot's main remaining risk is **end-to-end real content**, not feature
breadth. Once an authenticated user has completed the above journey, decide
whether the next gate is summary quality, long-form eligibility, or freshness.
Do not add subscriptions import, personalized ranking, chat, notifications,
a second backend or a new queue before this evidence exists.
