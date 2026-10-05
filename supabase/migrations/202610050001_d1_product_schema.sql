-- D1: product state owned by Supabase Postgres. All writes except profile edits
-- run through the server database adapter using the service role.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.channels (
  channel_uid text primary key,
  native_channel_id text not null unique,
  handle text,
  title text not null,
  canonical_url text not null,
  thumbnail_url text,
  last_feed_checked_at timestamptz,
  next_feed_check_at timestamptz,
  monitoring_status text not null default 'idle' check (monitoring_status in ('active', 'idle', 'error')),
  check (channel_uid = 'youtube-channel:' || native_channel_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_uid text not null references public.channels(channel_uid) on delete restrict,
  followed_at timestamptz not null default now(),
  primary key (user_id, channel_uid)
);
create index follows_channel_uid_idx on public.follows(channel_uid);

create table public.videos (
  video_uid text primary key,
  channel_uid text not null references public.channels(channel_uid) on delete restrict,
  native_video_id text not null unique,
  title text not null,
  canonical_url text not null,
  thumbnail_url text,
  published_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  availability text not null default 'unknown' check (availability in ('public', 'private', 'unavailable', 'unknown')),
  provider_snapshot_id text,
  check (video_uid = 'youtube:' || native_video_id),
  updated_at timestamptz not null default now()
);
create index videos_feed_order_idx on public.videos(published_at desc, video_uid desc);
create index videos_channel_uid_idx on public.videos(channel_uid);

create table public.summaries (
  summary_key text primary key,
  video_uid text not null references public.videos(video_uid) on delete restrict,
  spec_version text not null,
  language text not null,
  state text not null check (state in ('available', 'generating', 'failed')),
  summary_id text,
  summary_text text,
  key_points jsonb not null default '[]'::jsonb check (jsonb_typeof(key_points) = 'array'),
  provider text,
  model text,
  generated_at timestamptz,
  retry_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_uid, spec_version, language),
  check (state <> 'available' or (summary_id is not null and summary_text is not null and generated_at is not null))
);

create table public.summary_generation_claims (
  summary_key text primary key references public.summaries(summary_key) on delete restrict,
  claimant_user_id uuid not null references auth.users(id) on delete restrict,
  state text not null default 'claimed' check (state in ('claimed', 'succeeded', 'failed')),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.summary_usage (
  usage_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_key text not null unique,
  billing_period date not null,
  charged_minutes integer not null check (charged_minutes > 0),
  created_at timestamptz not null default now(),
  foreign key (summary_key) references public.summary_generation_claims(summary_key) on delete restrict
);
create index summary_usage_user_period_idx on public.summary_usage(user_id, billing_period);

create or replace function public.enforce_successful_summary_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.summary_generation_claims claim
    join public.summaries summary using (summary_key)
    where claim.summary_key = new.summary_key
      and claim.claimant_user_id = new.user_id
      and claim.state = 'succeeded'
      and summary.state = 'available'
  ) then
    raise exception 'usage requires the successful claimant and an available summary';
  end if;
  return new;
end;
$$;
-- D5 must set the summary to available and claim to succeeded before inserting
-- usage, inside the same transaction, so failures roll back without a charge.
create trigger summary_usage_success_guard
  before insert or update on public.summary_usage
  for each row execute function public.enforce_successful_summary_charge();

create table public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null default 'none' check (plan_code in ('paid', 'internal_test', 'none')),
  status text not null default 'none' check (status in ('active', 'past_due', 'canceled', 'none')),
  follow_limit integer not null default 0 check (follow_limit >= 0),
  generation_minutes_limit integer not null default 0 check (generation_minutes_limit >= 0),
  period_start timestamptz,
  period_end timestamptz,
  billing_customer_id text,
  billing_subscription_id text,
  updated_at timestamptz not null default now(),
  check ((plan_code = 'none' and status = 'none' and follow_limit = 0 and generation_minutes_limit = 0)
      or (plan_code <> 'none' and status <> 'none'))
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.entitlements (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Internal QA entitlement helper. It is only executable with the server role;
-- the local development CLI additionally refuses NODE_ENV=production.
create or replace function public.grant_internal_test_entitlement(
  target_user_id uuid,
  requested_follow_limit integer default 30,
  requested_generation_minutes integer default 600
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_follow_limit < 0 or requested_generation_minutes < 0 then
    raise exception 'limits must be non-negative';
  end if;
  insert into public.entitlements (
    user_id, plan_code, status, follow_limit, generation_minutes_limit,
    period_start, period_end, updated_at
  ) values (
    target_user_id, 'internal_test', 'active', requested_follow_limit,
    requested_generation_minutes, now(), now() + interval '100 years', now()
  )
  on conflict (user_id) do update set
    plan_code = excluded.plan_code,
    status = excluded.status,
    follow_limit = excluded.follow_limit,
    generation_minutes_limit = excluded.generation_minutes_limit,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    updated_at = now();
end;
$$;

alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.follows enable row level security;
alter table public.videos enable row level security;
alter table public.summaries enable row level security;
alter table public.summary_generation_claims enable row level security;
alter table public.summary_usage enable row level security;
alter table public.entitlements enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy channels_read_authenticated on public.channels for select to authenticated using (true);
create policy follows_select_own on public.follows for select to authenticated using ((select auth.uid()) = user_id);
create policy follows_delete_own on public.follows for delete to authenticated using ((select auth.uid()) = user_id);
create policy videos_read_authenticated on public.videos for select to authenticated using (true);
create policy summaries_read_available on public.summaries for select to authenticated using (state = 'available');
create policy summary_usage_select_own on public.summary_usage for select to authenticated using ((select auth.uid()) = user_id);
create policy entitlements_select_own on public.entitlements for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.channels, public.follows, public.videos,
  public.summaries, public.summary_generation_claims, public.summary_usage,
  public.entitlements from anon, authenticated;
revoke all on public.profiles, public.channels, public.follows, public.videos,
  public.summaries, public.summary_generation_claims, public.summary_usage,
  public.entitlements from public;

grant select on public.profiles to authenticated;
grant update (updated_at) on public.profiles to authenticated;
grant select (channel_uid, native_channel_id, handle, title, canonical_url, thumbnail_url, monitoring_status)
  on public.channels to authenticated;
grant select (channel_uid, followed_at) on public.follows to authenticated;
grant delete on public.follows to authenticated;
grant select (video_uid, channel_uid, native_video_id, title, canonical_url, thumbnail_url, published_at, duration_seconds, availability, provider_snapshot_id)
  on public.videos to authenticated;
grant select (summary_key, video_uid, spec_version, language, state, summary_id, summary_text, key_points, generated_at, retry_after)
  on public.summaries to authenticated;
grant select on public.summary_usage to authenticated;
-- Expose only non-billing entitlement columns to browser clients.
grant select (plan_code, status, follow_limit, generation_minutes_limit, period_start, period_end, updated_at)
  on public.entitlements to authenticated;
grant all on public.profiles, public.channels, public.follows, public.videos,
  public.summaries, public.summary_generation_claims, public.summary_usage,
  public.entitlements to service_role;
revoke execute on function public.grant_internal_test_entitlement(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.grant_internal_test_entitlement(uuid, integer, integer) to service_role;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.enforce_successful_summary_charge() from public, anon, authenticated;
