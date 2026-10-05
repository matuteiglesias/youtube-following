-- D8: expose a bounded global projection for server-configured public demo channels.
-- Only the server's service-role adapter can call this function. No Follow table is read.
create or replace function public.read_demo_feed_page(
  requested_channel_uids text[],
  requested_limit integer default 20
)
returns table(feed_item jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_channel_uids is null
     or cardinality(requested_channel_uids) > 12
     or exists (
       select 1 from unnest(requested_channel_uids) as uid
       where uid !~ '^youtube-channel:UC[A-Za-z0-9_-]{22}$'
     ) then
    raise exception 'invalid_demo_channels';
  end if;

  return query
  with page as materialized (
    select v.*, c.title as channel_title, c.handle as channel_handle,
      c.canonical_url as channel_url, c.thumbnail_url as channel_thumbnail_url,
      s.summary_key, s.state as summary_state, s.summary_id, s.summary_text,
      s.key_points, s.language, s.generated_at
    from public.videos v
    join public.channels c on c.channel_uid = v.channel_uid
    join lateral (
      select summary_key, state, summary_id, summary_text, key_points, language, generated_at
      from public.summaries
      where video_uid = v.video_uid and state = 'available'
      order by generated_at desc nulls last, summary_key desc
      limit 1
    ) s on true
    where v.channel_uid = any(requested_channel_uids)
      and v.availability = 'public'
      and v.live_status not in ('live', 'upcoming')
    order by v.published_at desc, v.video_uid desc
    limit least(greatest(coalesce(requested_limit, 20), 1), 20)
  )
  select jsonb_build_object(
    'video', jsonb_build_object(
      'video_uid', p.video_uid, 'channel_uid', p.channel_uid, 'native_video_id', p.native_video_id,
      'title', p.title, 'canonical_url', p.canonical_url, 'thumbnail_url', p.thumbnail_url,
      'published_at', p.published_at, 'duration_seconds', p.duration_seconds,
      'availability', p.availability, 'provider_snapshot_id', p.provider_snapshot_id,
      'live_status', p.live_status
    ),
    'channel', jsonb_build_object(
      'channel_uid', p.channel_uid, 'title', p.channel_title, 'handle', p.channel_handle,
      'canonical_url', p.channel_url, 'thumbnail_url', p.channel_thumbnail_url
    ),
    'summary', jsonb_build_object(
      'state', p.summary_state, 'summary_id', p.summary_id, 'summary', p.summary_text,
      'key_points', coalesce(p.key_points, '[]'::jsonb), 'language', p.language,
      'generated_at', p.generated_at, 'retryable', false
    )
  ) as feed_item
  from page p
  order by p.published_at desc, p.video_uid desc;
end;
$$;

revoke execute on function public.read_demo_feed_page(text[], integer) from public, anon, authenticated;
grant execute on function public.read_demo_feed_page(text[], integer) to service_role;
