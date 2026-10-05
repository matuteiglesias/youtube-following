-- D5: reserve monthly generation allowance before calling the provider, then
-- atomically convert that reservation into usage only after valid success.
alter table public.videos add column live_status text not null default 'unknown'
  check (live_status in ('unknown', 'completed', 'live', 'upcoming'));

alter table public.summary_generation_claims
  add column charged_minutes integer not null default 1 check (charged_minutes > 0),
  add column billing_period date not null default current_date,
  add column lease_expires_at timestamptz,
  add column attempts integer not null default 1 check (attempts between 1 and 3);

create or replace function public.claim_summary_generation(
  target_user_id uuid,
  target_video_uid text,
  target_summary_key text,
  target_spec_version text,
  target_language text,
  target_charged_minutes integer
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
     or target_charged_minutes < 1 then
    raise exception 'invalid_summary_request';
  end if;

  select * into video_row from public.videos where video_uid = target_video_uid;
  if not found or not exists (
    select 1 from public.follows where user_id = target_user_id and channel_uid = video_row.channel_uid
  ) then
    return jsonb_build_object('state', 'not_found');
  end if;
  if video_row.live_status in ('live', 'upcoming') then
    return jsonb_build_object('state', 'live_or_upcoming');
  end if;
  if video_row.duration_seconds is not null and video_row.duration_seconds < 90 then
    return jsonb_build_object('state', 'short_video');
  end if;
  if video_row.duration_seconds is not null and video_row.duration_seconds > 7200 then
    return jsonb_build_object('state', 'long_video');
  end if;
  if video_row.availability <> 'public' then
    return jsonb_build_object('state', 'failed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_summary_key, 0));
  select * into summary_row from public.summaries
    where summary_key = target_summary_key for update;
  summary_found := found;
  if summary_found and summary_row.state = 'available' then
    return jsonb_build_object('state', 'available', 'summary', to_jsonb(summary_row));
  end if;

  -- Serialize allowance checks per user, including requests for different videos.
  select * into entitlement_row from public.entitlements
    where user_id = target_user_id for update;
  if not found or entitlement_row.status <> 'active'
     or (entitlement_row.period_end is not null and entitlement_row.period_end <= now()) then
    return jsonb_build_object('state', 'quota_blocked');
  end if;
  period_day := coalesce(entitlement_row.period_start::date, date_trunc('month', now())::date);

  select coalesce(sum(charged_minutes), 0)::integer into used_minutes
    from public.summary_usage where user_id = target_user_id and billing_period = period_day;
  select coalesce(sum(charged_minutes), 0)::integer into reserved_minutes
    from public.summary_generation_claims
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
      select * into claim_row from public.summary_generation_claims
        where summary_key = target_summary_key for update;
      if found and claim_row.state = 'claimed' and claim_row.lease_expires_at > now() then
        return jsonb_build_object('state', 'generating');
      end if;
    end if;
    if summary_row.state = 'failed' and summary_row.retry_after > now() then
      return jsonb_build_object('state', 'failed', 'retryable', true);
    end if;
    select * into claim_row from public.summary_generation_claims where summary_key = target_summary_key for update;
    if found and claim_row.attempts >= 3 then
      return jsonb_build_object('state', 'failed', 'retryable', false);
    end if;
    update public.summaries set state = 'generating', summary_id = null, summary_text = null,
      key_points = '[]'::jsonb, generated_at = null, retry_after = null, updated_at = now()
      where summary_key = target_summary_key;
  end if;

  insert into public.summary_generation_claims
    (summary_key, claimant_user_id, state, claimed_at, finished_at, charged_minutes,
     billing_period, lease_expires_at, attempts)
  values (target_summary_key, target_user_id, 'claimed', now(), null, target_charged_minutes,
          period_day, now() + interval '3 minutes', 1)
  on conflict (summary_key) do update set
    claimant_user_id = excluded.claimant_user_id, state = 'claimed', claimed_at = now(), finished_at = null,
    charged_minutes = excluded.charged_minutes, billing_period = excluded.billing_period,
    lease_expires_at = excluded.lease_expires_at,
    attempts = public.summary_generation_claims.attempts + 1;
  return jsonb_build_object('state', 'claimed');
end;
$$;

create or replace function public.complete_summary_generation(
  target_summary_key text,
  target_user_id uuid,
  target_summary_id text,
  target_summary_text text,
  target_key_points jsonb,
  target_language text,
  target_provider text,
  target_model text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claim_row public.summary_generation_claims%rowtype;
begin
  select * into claim_row from public.summary_generation_claims
    where summary_key = target_summary_key for update;
  if not found or claim_row.claimant_user_id <> target_user_id or claim_row.state <> 'claimed'
     or claim_row.lease_expires_at <= now() then return false; end if;
  if target_summary_id is null or length(trim(target_summary_id)) = 0
     or target_summary_text is null or length(trim(target_summary_text)) = 0
     or jsonb_typeof(target_key_points) <> 'array' then raise exception 'invalid_summary_result'; end if;

  update public.summaries set state = 'available', summary_id = target_summary_id,
    summary_text = target_summary_text, key_points = target_key_points, language = target_language,
    provider = target_provider, model = target_model, generated_at = now(), retry_after = null,
    updated_at = now() where summary_key = target_summary_key;
  update public.summary_generation_claims set state = 'succeeded', finished_at = now(), lease_expires_at = null
    where summary_key = target_summary_key;
  insert into public.summary_usage (user_id, summary_key, billing_period, charged_minutes)
    values (target_user_id, target_summary_key, claim_row.billing_period, claim_row.charged_minutes);
  return true;
end;
$$;

create or replace function public.fail_summary_generation(target_summary_key text, target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare claim_row public.summary_generation_claims%rowtype;
begin
  select * into claim_row from public.summary_generation_claims
    where summary_key = target_summary_key for update;
  if not found or claim_row.claimant_user_id <> target_user_id or claim_row.state <> 'claimed'
     or claim_row.lease_expires_at <= now() then return false; end if;
  update public.summary_generation_claims set state = 'failed', finished_at = now(), lease_expires_at = null
    where summary_key = target_summary_key;
  update public.summaries set state = 'failed', summary_id = null, summary_text = null,
    key_points = '[]'::jsonb, retry_after = case when claim_row.attempts < 3 then now() + interval '2 minutes' else null end,
    updated_at = now() where summary_key = target_summary_key;
  return claim_row.attempts < 3;
end;
$$;

revoke execute on function public.claim_summary_generation(uuid, text, text, text, text, integer),
  public.complete_summary_generation(text, uuid, text, text, jsonb, text, text, text),
  public.fail_summary_generation(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_summary_generation(uuid, text, text, text, text, integer),
  public.complete_summary_generation(text, uuid, text, text, jsonb, text, text, text),
  public.fail_summary_generation(text, uuid) to service_role;

-- Include the state needed to prevent a live/upcoming item from invoking inference.
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
      when p.duration_seconds < 90 then 'short_video'
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
revoke execute on function public.read_feed_page(uuid,timestamptz,text,text,integer) from public,anon,authenticated;
grant execute on function public.read_feed_page(uuid,timestamptz,text,text,integer) to service_role;
