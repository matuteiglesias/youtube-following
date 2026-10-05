-- D7: billing receipts, provider-derived entitlements, and paid-through access.
alter table public.entitlements add column billing_event_at timestamptz;

create table public.billing_webhook_events (
  event_id text primary key check (length(event_id) between 1 and 200),
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now()
);
alter table public.billing_webhook_events enable row level security;
revoke all on public.billing_webhook_events from public, anon, authenticated;
grant all on public.billing_webhook_events to service_role;

create or replace function public.has_paid_entitlement_access(target_status text, target_period_end timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (target_status = 'active' and target_period_end is not null and target_period_end > now())
      or (target_status = 'canceled' and target_period_end is not null and target_period_end > now());
$$;
revoke execute on function public.has_paid_entitlement_access(text, timestamptz) from public, anon, authenticated;
grant execute on function public.has_paid_entitlement_access(text, timestamptz) to service_role;

-- Preserve D3's serialized follow-limit mutation while requiring an active
-- entitlement or a canceled subscription still inside its paid-through period.
create or replace function public.create_follow_with_limit(
  target_user_id uuid,
  target_channel_uid text
)
returns table(channel_uid text, followed_at timestamptz, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitlement_row public.entitlements%rowtype;
  existing_follow public.follows%rowtype;
  current_follow_count integer;
begin
  select * into entitlement_row from public.entitlements where user_id = target_user_id for update;
  if not found then raise exception 'entitlement_not_found'; end if;
  select * into existing_follow from public.follows
    where user_id = target_user_id and public.follows.channel_uid = target_channel_uid;
  if found then
    return query select existing_follow.channel_uid, existing_follow.followed_at, false;
    return;
  end if;
  if not public.has_paid_entitlement_access(entitlement_row.status, entitlement_row.period_end)
     or entitlement_row.follow_limit <= 0 then
    raise exception 'follow_limit_reached';
  end if;
  select count(*)::integer into current_follow_count from public.follows where user_id = target_user_id;
  if current_follow_count >= entitlement_row.follow_limit then raise exception 'follow_limit_reached'; end if;
  insert into public.follows (user_id, channel_uid) values (target_user_id, target_channel_uid)
    returning public.follows.channel_uid, public.follows.followed_at
    into existing_follow.channel_uid, existing_follow.followed_at;
  return query select existing_follow.channel_uid, existing_follow.followed_at, true;
end;
$$;
revoke execute on function public.create_follow_with_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.create_follow_with_limit(uuid, text) to service_role;

-- D5's only paid-use gate is updated here so cancellation stays usable through
-- the period_end timestamp; past_due and expired subscriptions block immediately.
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
  select * into entitlement_row from public.entitlements where user_id = target_user_id for update;
  if not found or not public.has_paid_entitlement_access(entitlement_row.status, entitlement_row.period_end) then
    return jsonb_build_object('state', 'quota_blocked');
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
revoke execute on function public.claim_summary_generation(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_summary_generation(uuid, text, text, text, text, integer) to service_role;

-- Receipt insertion and entitlement mutation happen in one transaction.
create or replace function public.apply_polar_entitlement_event(
  target_event_id text,
  target_user_id uuid,
  target_action text,
  target_subscription_id text,
  target_customer_id text,
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_event_at timestamptz,
  target_follow_limit integer,
  target_generation_minutes_limit integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare current_row public.entitlements%rowtype;
begin
  if target_event_id is null or length(target_event_id) not between 1 and 200
     or target_user_id is null or target_action not in ('active','past_due','canceled','none')
     or target_subscription_id is null or length(target_subscription_id) > 200
     or target_customer_id is null or length(target_customer_id) > 200
     or target_event_at is null or target_follow_limit < 1 or target_generation_minutes_limit < 1
     or target_follow_limit > 10000 or target_generation_minutes_limit > 1000000
     or target_period_start is null or target_period_end is null or target_period_end <= target_period_start
    then raise exception 'invalid_billing_event'; end if;
  insert into public.billing_webhook_events(event_id) values (target_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  select * into current_row from public.entitlements where user_id = target_user_id for update;
  if not found then raise exception 'entitlement_not_found'; end if;
  if current_row.billing_event_at is not null and target_event_at <= current_row.billing_event_at then return 'stale'; end if;
  if current_row.billing_subscription_id is not null and current_row.billing_subscription_id <> target_subscription_id
     and (current_row.plan_code = 'paid' and current_row.period_end > now()) then return 'stale'; end if;

  if target_action = 'none' or (target_action in ('active','canceled') and target_period_end <= now()) then
    update public.entitlements set plan_code = 'none', status = 'none', follow_limit = 0,
      generation_minutes_limit = 0, period_start = null, period_end = null,
      billing_customer_id = target_customer_id, billing_subscription_id = target_subscription_id,
      billing_event_at = target_event_at, updated_at = now() where user_id = target_user_id;
  else
    update public.entitlements set plan_code = 'paid', status = target_action,
      follow_limit = target_follow_limit, generation_minutes_limit = target_generation_minutes_limit,
      period_start = target_period_start, period_end = target_period_end,
      billing_customer_id = target_customer_id, billing_subscription_id = target_subscription_id,
      billing_event_at = target_event_at, updated_at = now() where user_id = target_user_id;
  end if;
  return 'applied';
end;
$$;
revoke execute on function public.apply_polar_entitlement_event(text, uuid, text, text, text, timestamptz, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.apply_polar_entitlement_event(text, uuid, text, text, text, timestamptz, timestamptz, timestamptz, integer, integer) to service_role;
