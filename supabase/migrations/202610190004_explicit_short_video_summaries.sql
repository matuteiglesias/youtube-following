-- Enable explicitly selected, verified completed video clips from 30 seconds.
-- A 63-second clip can use the shared summary pipeline; cached summaries
-- remain readable even for shorter clips, without charging any user.
-- Keep live/upcoming, unknown metadata, privacy, and monthly budget gates.
create or replace function public.claim_summary_generation(
  target_user_id uuid, target_video_uid text, target_summary_key text,
  target_spec_version text, target_language text, target_charged_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  video_row public.videos%rowtype;
  entitlement_row public.entitlements%rowtype;
  summary_row public.summaries%rowtype;
  claim_row public.summary_generation_claims%rowtype;
  period_day date;
  used_minutes integer;
  reserved_minutes integer;
  summary_found boolean := false;
begin
  if target_user_id is null or target_video_uid !~ '^youtube:[A-Za-z0-9_-]{11}$'
     or target_summary_key !~ '^sha256:[a-f0-9]{64}$'
     or target_spec_version <> 'v1' or target_language <> 'primary'
     or target_charged_minutes < 1 then raise exception 'invalid_summary_request'; end if;
  select * into video_row from public.videos where video_uid = target_video_uid;
  if not found or not exists (select 1 from public.follows where user_id = target_user_id and channel_uid = video_row.channel_uid) then
    return jsonb_build_object('state', 'not_found');
  end if;
  if video_row.live_status in ('live', 'upcoming') then return jsonb_build_object('state', 'live_or_upcoming'); end if;
  if video_row.duration_seconds is not null and video_row.duration_seconds > 7200 then return jsonb_build_object('state', 'long_video'); end if;
  if video_row.availability <> 'public' then return jsonb_build_object('state', 'failed'); end if;

  perform pg_advisory_xact_lock(hashtextextended(target_summary_key, 0));
  select * into summary_row from public.summaries where summary_key = target_summary_key for update;
  summary_found := found;
  if summary_found and summary_row.state = 'available' then
    return jsonb_build_object('state', 'available', 'summary', to_jsonb(summary_row));
  end if;
  -- A user-requested 30–89 second completed clip can be summarized.
  -- For very brief clips, serve any existing globally cached summary for free,
  -- but do not initiate expensive inference (<30 seconds).
  if video_row.duration_seconds is not null and video_row.duration_seconds < 30 then
    return jsonb_build_object('state', 'short_video');
  end if;
  -- Do not spend AI capacity on videos whose metadata has not established that
  -- the broadcast is completed and has a real positive duration. Available
  -- cached summaries above remain readable by any follower without payment.
  if video_row.live_status <> 'completed' or video_row.duration_seconds is null
     or video_row.duration_seconds <= 0 then
    return jsonb_build_object('state', 'metadata_pending');
  end if;
  select * into entitlement_row from public.entitlements where user_id = target_user_id for update;
  if not found or not public.has_paid_entitlement_access(entitlement_row.status, entitlement_row.period_end) then
    return jsonb_build_object('state', 'generation_not_enabled');
  end if;
  period_day := coalesce(entitlement_row.period_start::date, date_trunc('month', now())::date);
  select coalesce(sum(charged_minutes), 0)::integer into used_minutes from public.summary_usage
    where user_id = target_user_id and billing_period = period_day;
  select coalesce(sum(charged_minutes), 0)::integer into reserved_minutes from public.summary_generation_claims
    where claimant_user_id = target_user_id and billing_period = period_day
      and state = 'claimed' and lease_expires_at > now();
  if used_minutes + reserved_minutes + target_charged_minutes > entitlement_row.generation_minutes_limit then
    return jsonb_build_object('state', 'quota_blocked');
  end if;
  if not summary_found then
    insert into public.summaries (summary_key, video_uid, spec_version, language, state)
      values (target_summary_key, target_video_uid, target_spec_version, target_language, 'generating');
  else
    if summary_row.state = 'generating' then
      select * into claim_row from public.summary_generation_claims where summary_key = target_summary_key for update;
      if found and claim_row.state = 'claimed' and claim_row.lease_expires_at > now() then return jsonb_build_object('state', 'generating'); end if;
    end if;
    if summary_row.state = 'failed' and summary_row.retry_after > now() then return jsonb_build_object('state', 'failed', 'retryable', true); end if;
    select * into claim_row from public.summary_generation_claims where summary_key = target_summary_key for update;
    if found and claim_row.attempts >= 3 then return jsonb_build_object('state', 'failed', 'retryable', false); end if;
    update public.summaries set state = 'generating', summary_id = null, summary_text = null,
      key_points = '[]'::jsonb, generated_at = null, retry_after = null, updated_at = now()
      where summary_key = target_summary_key;
  end if;
  insert into public.summary_generation_claims
    (summary_key, claimant_user_id, state, claimed_at, finished_at, charged_minutes, billing_period, lease_expires_at, attempts)
  values (target_summary_key, target_user_id, 'claimed', now(), null, target_charged_minutes,
          period_day, now() + interval '3 minutes', 1)
  on conflict (summary_key) do update set claimant_user_id = excluded.claimant_user_id, state = 'claimed',
    claimed_at = now(), finished_at = null, charged_minutes = excluded.charged_minutes,
    billing_period = excluded.billing_period, lease_expires_at = excluded.lease_expires_at,
    attempts = public.summary_generation_claims.attempts + 1;
  return jsonb_build_object('state', 'claimed');
end;
$$;
revoke execute on function public.claim_summary_generation(uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_summary_generation(uuid, text, text, text, text, integer) to service_role;

create or replace function public.read_feed_page(
  target_user_id uuid, after_published_at timestamptz, after_video_uid text,
  requested_channel_uid text, requested_limit integer
)
returns table(feed_item jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null then raise exception 'feed_user_required'; end if;
  if (after_published_at is null) <> (after_video_uid is null) then raise exception 'invalid_feed_cursor'; end if;
  if after_video_uid is not null and after_video_uid !~ '^youtube:[A-Za-z0-9_-]{11}$' then raise exception 'invalid_feed_cursor'; end if;
  if requested_channel_uid is not null and requested_channel_uid !~ '^youtube-channel:UC[A-Za-z0-9_-]+$' then raise exception 'invalid_channel_filter'; end if;
  return query
  with page as materialized (
    select v.*, c.title as channel_title, c.handle as channel_handle,
      c.canonical_url as channel_url, c.thumbnail_url as channel_thumbnail_url
    from public.follows f join public.videos v on v.channel_uid = f.channel_uid
    join public.channels c on c.channel_uid = f.channel_uid
    where f.user_id = target_user_id
      and (requested_channel_uid is null or f.channel_uid = requested_channel_uid)
      and (after_published_at is null or (v.published_at, v.video_uid) < (after_published_at, after_video_uid))
    order by v.published_at desc, v.video_uid desc limit least(greatest(coalesce(requested_limit,20),1),50)+1
  )
  select jsonb_build_object(
    'video', jsonb_build_object('video_uid',p.video_uid,'channel_uid',p.channel_uid,'native_video_id',p.native_video_id,
      'title',p.title,'canonical_url',p.canonical_url,'thumbnail_url',p.thumbnail_url,'published_at',p.published_at,
      'duration_seconds',p.duration_seconds,'availability',p.availability,'provider_snapshot_id',p.provider_snapshot_id,
      'live_status',p.live_status),
    'channel', jsonb_build_object('channel_uid',p.channel_uid,'title',p.channel_title,'handle',p.channel_handle,
      'canonical_url',p.channel_url,'thumbnail_url',p.channel_thumbnail_url),
    'summary', jsonb_build_object('state',coalesce(s.state,case
      when p.live_status in ('live','upcoming') then 'live_or_upcoming'
      when p.duration_seconds < 30 then 'short_video'
      when p.duration_seconds > 7200 then 'long_video'
      else 'not_requested' end),'summary_id',s.summary_id,
      'summary',s.summary_text,'key_points',coalesce(s.key_points,'[]'::jsonb),'language',s.language,
      'generated_at',s.generated_at,'retryable',case when s.summary_key is null then null else false end)
  ) as feed_item
  from page p left join lateral (
    select summary_key,state,summary_id,summary_text,key_points,language,generated_at from public.summaries
    where video_uid=p.video_uid and state='available' order by generated_at desc nulls last,summary_key desc limit 1
  ) s on true order by p.published_at desc,p.video_uid desc;
end;
$$;
revoke execute on function public.read_feed_page(uuid, timestamptz, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.read_feed_page(uuid, timestamptz, text, text, integer) to service_role;

-- Keep digest state labels aligned with the feed eligibility window.
create or replace function public.read_daily_digest(
  target_user_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  requested_limit integer default 100
)
returns table(feed_item jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null then
    raise exception 'digest_user_required';
  end if;
  if window_start is null or window_end is null then
    raise exception 'digest_window_required';
  end if;
  if window_start >= window_end then
    raise exception 'invalid_digest_window';
  end if;
  if window_end - window_start > interval '7 days' then
    raise exception 'digest_window_too_large';
  end if;
  if requested_limit is null or requested_limit < 1 or requested_limit > 100 then
    raise exception 'invalid_digest_limit';
  end if;

  return query
  with page as materialized (
    select
      v.*,
      c.title as channel_title,
      c.handle as channel_handle,
      c.canonical_url as channel_url,
      c.thumbnail_url as channel_thumbnail_url
    from public.follows f
    join public.videos v on v.channel_uid = f.channel_uid
    join public.channels c on c.channel_uid = f.channel_uid
    where f.user_id = target_user_id
      and v.published_at >= window_start
      and v.published_at < window_end
    order by v.published_at desc, v.video_uid desc
    limit requested_limit + 1
  )
  select jsonb_build_object(
    'video', jsonb_build_object(
      'video_uid', p.video_uid,
      'channel_uid', p.channel_uid,
      'native_video_id', p.native_video_id,
      'title', p.title,
      'canonical_url', p.canonical_url,
      'thumbnail_url', p.thumbnail_url,
      'published_at', p.published_at,
      'duration_seconds', p.duration_seconds,
      'availability', p.availability,
      'provider_snapshot_id', p.provider_snapshot_id,
      'live_status', p.live_status
    ),
    'channel', jsonb_build_object(
      'channel_uid', p.channel_uid,
      'title', p.channel_title,
      'handle', p.channel_handle,
      'canonical_url', p.channel_url,
      'thumbnail_url', p.channel_thumbnail_url
    ),
    'summary', jsonb_build_object(
      'state', coalesce(s.state, case
        when p.live_status in ('live', 'upcoming') then 'live_or_upcoming'
        when p.duration_seconds < 30 then 'short_video'
        when p.duration_seconds > 7200 then 'long_video'
        else 'not_requested'
      end),
      'summary_id', s.summary_id,
      'summary', s.summary_text,
      'key_points', coalesce(s.key_points, '[]'::jsonb),
      'language', s.language,
      'generated_at', s.generated_at,
      'retryable', case when s.summary_key is null then null else false end
    )
  ) as feed_item
  from page p
  left join lateral (
    select
      summary_key,
      state,
      summary_id,
      summary_text,
      key_points,
      language,
      generated_at
    from public.summaries
    where video_uid = p.video_uid
      and state = 'available'
    order by generated_at desc nulls last, summary_key desc
    limit 1
  ) s on true
  order by p.published_at desc, p.video_uid desc;
end;
$$;

revoke execute on function public.read_daily_digest(uuid, timestamptz, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.read_daily_digest(uuid, timestamptz, timestamptz, integer) to service_role;
