# First user follow-up — short clips and silent summary requests (2026-10-19)

## Observed real pilot

- In the 12:10 UTC browser screenshot, the selected C5N video **“Nuestros hijos no son un gasto”** has duration 1:03. Its sidecar shows `SHORT CLIP · NO SUMMARY`, because the existing product frontend and SQL both excluded completed videos under 90 seconds.
- This is not proof of a rendering defect: the sidecar and cards already render cached `available` summary text and key points.
- A second issue is real: eligible `POST /api/videos/.../summary` requests take about 29–33 seconds, while the browser previously displayed no in-flight state during the pending request. Network cancellations when navigating can leave the user unaware of the result.
- Cloud Run requests for `youtube:87LPrP69iP8` and `youtube:ZdCEqGbOuD0` returned HTTP 200. Media Monitor sidecar logs independently reported `available` for both at ~12:07–12:08 UTC. HTTP 200 and sidecar `available` do *not* establish that Supabase successfully persisted the summary and that the end-user received it. That evidence is still outstanding.
- A manual production database read was not used. Avoid handling or displaying service role secrets just to bypass the product's authenticated path.

## Repair

- Forward-only migration `202610190004_explicit_short_video_summaries.sql` changes the minimum supported completed video duration from 90 to **30 seconds** in the authoritative DB claim and in feed/digest projections. Verified 63-second clips now pass the claim gate; <30 second clips remain excluded from *new generation*. A previously cached available summary is returned before this minimum duration check.
- Frontend `mayAutoRequestSummary` is aligned with the database policy. Selection is explicit; scrolling does not consume inference.
- The card and right-hand sidecar immediately show `Preparing summary…`, with a 30–60 second explanation during the long provider call, then display the actual response. Clips under 30 seconds show `Video details` and an explanation instead of suggesting that the button will generate content.
- Server lifecycle logs contain only `provider_started`, safe provider result flags, `persisted`, `cache_hit`, `persist_pending`, or a sanitized failure type. No summaries, credentials, or user IDs are logged.
- Tests cover boundary durations, two-user shared cache, paid-generation charge rules, 30–89 second video generation, under-30 exclusion, and production-oriented UI behavior.

## Acceptance still required

1. Confirm one real, completed 1–20 minute clip follows the sequence `provider_started` → `provider_result state=available has_summary_id=true has_text=true` → `persisted`.
2. Verify the first user sees actual summary prose and key points in the right sidecar. On hard refresh the item must render with the same cached summary directly in the feed card without any new Media Monitor call or a second usage receipt.
3. Verify selecting C5N's 1:03 completed clip shows `Preparing summary…`, then `available` or a *diagnostic* `failed`. The provider may lack a usable transcript for an individual clip.
4. If the provider returns `available` but no data reaches Supabase, diagnose the `provider_result` flags and `persist_pending` stage before altering summary generation or quota mechanisms.
5. Do not claim actual output quality or full first-user acceptance based on synthetic tests or sidecar-only logs.
