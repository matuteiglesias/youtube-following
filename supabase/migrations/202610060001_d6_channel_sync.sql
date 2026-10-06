-- D6: globally deduplicated due-channel synchronization.
-- Channels are claimed once regardless of how many users follow them.
alter table public.channels
  add column sync_claim_until timestamptz;

create index channels_due_sync_idx
  on public.channels (next_feed_check_at, sync_claim_until, channel_uid);

create or replace function public.claim_due_channels(
  requested_limit integer default 25,
  lease_seconds integer default 300
)
returns table (
  channel_uid text,
  native_channel_id text,
  handle text,
  title text,
  canonical_url text,
  thumbnail_url text,
  monitoring_status text,
  last_feed_checked_at timestamptz,
  next_feed_check_at timestamptz,
  sync_claim_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_limit < 1 or requested_limit > 25 then
    raise exception 'requested_limit must be between 1 and 25';
  end if;
  if lease_seconds < 30 or lease_seconds > 1800 then
    raise exception 'lease_seconds must be between 30 and 1800';
  end if;

  return query
  with due as (
    select c.channel_uid
    from public.channels c
    where exists (
      select 1
      from public.follows f
      where f.channel_uid = c.channel_uid
    )
      and (c.next_feed_check_at is null or c.next_feed_check_at <= now())
      and (c.sync_claim_until is null or c.sync_claim_until <= now())
    order by c.next_feed_check_at asc nulls first, c.channel_uid asc
    for update of c skip locked
    limit requested_limit
  )
  update public.channels c
  set
    sync_claim_until = now() + (lease_seconds * interval '1 second'),
    updated_at = now()
  from due
  where c.channel_uid = due.channel_uid
  returning
    c.channel_uid,
    c.native_channel_id,
    c.handle,
    c.title,
    c.canonical_url,
    c.thumbnail_url,
    c.monitoring_status,
    c.last_feed_checked_at,
    c.next_feed_check_at,
    c.sync_claim_until;
end;
$$;

create or replace function public.count_due_channels()
returns bigint
language sql
security definer
set search_path = ''
stable
as $$
  select count(*)
  from public.channels c
  where exists (
    select 1
    from public.follows f
    where f.channel_uid = c.channel_uid
  )
    and (c.next_feed_check_at is null or c.next_feed_check_at <= now())
    and (c.sync_claim_until is null or c.sync_claim_until <= now());
$$;

revoke execute on function public.claim_due_channels(integer, integer)
  from public, anon, authenticated;
revoke execute on function public.count_due_channels()
  from public, anon, authenticated;
grant execute on function public.claim_due_channels(integer, integer)
  to service_role;
grant execute on function public.count_due_channels()
  to service_role;
