-- D3: serialize entitlement checking and follow insertion on the entitlement row.
-- Only the server role may call this function; browser roles cannot bypass it.
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
  select * into entitlement_row
  from public.entitlements
  where user_id = target_user_id
  for update;

  if not found then
    raise exception 'entitlement_not_found';
  end if;

  select * into existing_follow
  from public.follows
  where user_id = target_user_id and public.follows.channel_uid = target_channel_uid;

  if found then
    return query select existing_follow.channel_uid, existing_follow.followed_at, false;
    return;
  end if;

  select count(*)::integer into current_follow_count
  from public.follows
  where user_id = target_user_id;

  if current_follow_count >= entitlement_row.follow_limit then
    raise exception 'follow_limit_reached';
  end if;

  insert into public.follows (user_id, channel_uid)
  values (target_user_id, target_channel_uid)
  returning public.follows.channel_uid, public.follows.followed_at
  into existing_follow.channel_uid, existing_follow.followed_at;

  return query select existing_follow.channel_uid, existing_follow.followed_at, true;
end;
$$;

revoke execute on function public.create_follow_with_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.create_follow_with_limit(uuid, text) to service_role;
