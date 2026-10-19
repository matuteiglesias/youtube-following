-- D5 already includes live_status in the feed response and state classification.
-- Repair older zero-second placeholders: duration=0 from upstream metadata
-- means unknown, not a verified sub-90-second clip.
update public.videos set duration_seconds = null where duration_seconds = 0;
