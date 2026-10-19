-- New generation requires verified completed-video metadata. The shared
-- cache lookup occurs first and remains free across all users.
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
  if video_row.duration_seconds is not null and video_row.duration_seconds < 90 then return jsonb_build_object('state', 'short_video'); end if;
  if video_row.duration_seconds is not null and video_row.duration_seconds > 7200 then return jsonb_build_object('state', 'long_video'); end if;
  if video_row.availability <> 'public' then return jsonb_build_object('state', 'failed'); end if;

  perform pg_advisory_xact_lock(hashtextextended(target_summary_key, 0));
  select * into summary_row from public.summaries where summary_key = target_summary_key for update;
  summary_found := found;
  if summary_found and summary_row.state = 'available' then
    return jsonb_build_object('state', 'available', 'summary', to_jsonb(summary_row));
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
