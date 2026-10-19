# First-user AI summaries — October 19, 2026

## Proven before intervention

- The logged-in product requested a summary at 11:34:15 UTC and Cloud Run
  returned HTTP 200. The UI reported `quota_blocked`, which is a valid
  application-level status and does not imply successful generation.
- The D7 `claim_summary_generation` SQL function checks shared cache first,
  then requires a paid or `internal_test` entitlement. A normal account has
  `none`, with zero generation minutes. Therefore **the attempt did not
  reach Media Monitor**.
- Cached `public.summaries` rows are *global by video/spec/language*, not
  per-user. The D4/D5 feed projection left-joins the latest available summary;
  the UI already displays it and now includes key points in card previews.
- D5 already exposes `live_status` in `read_feed_page`. Earlier investigation
  incorrectly examined superseded D4 SQL. Preserve the latest D5 projection.
- Several canonical video records arrived with `duration_seconds = 0` or no
  thumbnail, which was incorrectly presented as a real zero-second short clip.
- Media Monitor /videos/ensure calls succeeded for some followed videos.
  **No actual provider `/videos/summary` end-to-end result was observed**.

## Implemented

- One bounded request to YouTube Data API for *selected videos with incomplete
  metadata*, before claiming inference minutes. Persist only nonmissing duration,
  confirmed live state, known availability and optional thumbnail. Treat a
  zero-length duration as *unknown*, not a real clip.
- DB migration `202610190002_feed_live_metadata.sql` changes older zero-second
  placeholders to null; retains D5's canonical read projection unchanged.
- DB migration `202610190003_summary_metadata_gate.sql` returns
  `metadata_pending` for live-state unknown/incomplete durations **after**
  globally cached summary lookup but **before** quota reserve/provider work.
  It separately reports `generation_not_enabled` from exhausted allowance.
- Cards display cached summary text plus up to two key points; cards with missing
  thumbnails use YouTube's canonical thumbnail URL as fallback.
- First-user trial activation is an explicit server action shown in Account only
  when the signed-in email matches the operator-set `PILOT_TRIAL_EMAIL`.
  Activation revalidates via Supabase Auth `getUser` and requires email
  confirmation. It is unavailable to every other user or anon; paid plans are
  never overwritten. The action uses the existing service-role helper to grant
  a one-time pool of **240 generation minutes** (99 follows remain free).
  Calling again while active cannot reset the budget.
- No automatic channel-wide/scroll-triggered inference, no custom LLM key in
  the browser, no new summary cache, and no anonymous summary generation.

## Testing and completion gates

1. Keep SQL migrations in order, run PGlite tests for metadata eligibility,
   charging, two-user cache reuse, and the newest feed projection.
2. Apply SQL migrations to the linked Supabase project (once each). Deploy
   the app to no-traffic Cloud Run revision, health/auth smoke it, then promote.
3. Configure `PILOT_TRIAL_EMAIL` in Cloud Run runtime for the confirmed
   pilot account; **do not put the email or keys in repository source**.
4. First user opens /account, selects Activate trial, and verifies Account
   shows an internal trial with 240 allowed generation minutes.
5. On Feed, select a *completed public video*, approximately 3–20 minutes.
   Confirm the request returns `available`, not `metadata_pending`,
   `generation_not_enabled`, or `failed`. Verify actual nonempty summary
   text/key points, no fabricated content, proper language, and that one usage
   receipt was created.
6. Refresh the feed and reopen the video: it should display the cached summary
   without any second provider call or another usage charge. Verify another
   account following that video sees the same shared summary.
7. Check live/upcoming and unknown-duration videos do not use allowance.
   Provider quality, transcript availability and model output require a real
   video proof; isolated tests alone do not establish it.

## What is not solved by this repair

A video over 120 minutes remains excluded by v1. Radio broadcasts and some
long-format political shows may need a separate chunking pipeline and budget
decision. Provider-side caption availability, language and nonempty factual
quality must be validated from genuine user-selected results, not mocked tests.
