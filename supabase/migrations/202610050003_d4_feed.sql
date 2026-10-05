-- D4: keep feed reads in the product database and page on the stable ordering key.
create index if not exists videos_channel_feed_order_idx
  on public.videos (channel_uid, published_at desc, video_uid desc);

create or replace function public.read_feed_page(
  target_user_id uuid,
  after_published_at timestamptz,
  after_video_uid text,
  requested_channel_uid text,
  requested_limit integer
)
returns table(feed_item jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null then
    raise exception 'feed_user_required';
  end if;
  if (after_published_at is null) <> (after_video_uid is null) then
    raise exception 'invalid_feed_cursor';
  end if;
  if after_video_uid is not null and after_video_uid !~ '^youtube:[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid_feed_cursor';
  end if;
  if requested_channel_uid is not null and requested_channel_uid !~ '^youtube-channel:UC[A-Za-z0-9_-]+$' then
    raise exception 'invalid_channel_filter';
  end if;

  return query
  with page as materialized (
    select
      v.video_uid,
      v.channel_uid,
      v.native_video_id,
      v.title as video_title,
      v.canonical_url as video_url,
      v.thumbnail_url as video_thumbnail_url,
      v.published_at,
      v.duration_seconds,
      v.availability,
      v.provider_snapshot_id,
      c.title as channel_title,
      c.handle as channel_handle,
      c.canonical_url as channel_url,
      c.thumbnail_url as channel_thumbnail_url
    from public.follows f
    join public.videos v on v.channel_uid = f.channel_uid
    join public.channels c on c.channel_uid = f.channel_uid
    where f.user_id = target_user_id
      and (requested_channel_uid is null or f.channel_uid = requested_channel_uid)
      and (
        after_published_at is null
        or (v.published_at, v.video_uid) < (after_published_at, after_video_uid)
      )
    order by v.published_at desc, v.video_uid desc
    limit least(greatest(coalesce(requested_limit, 20), 1), 50) + 1
  )
  select jsonb_build_object(
    'video', jsonb_build_object(
      'video_uid', p.video_uid,
      'channel_uid', p.channel_uid,
      'native_video_id', p.native_video_id,
      'title', p.video_title,
      'canonical_url', p.video_url,
      'thumbnail_url', p.video_thumbnail_url,
      'published_at', p.published_at,
      'duration_seconds', p.duration_seconds,
      'availability', p.availability,
      'provider_snapshot_id', p.provider_snapshot_id
    ),
    'channel', jsonb_build_object(
      'channel_uid', p.channel_uid,
      'title', p.channel_title,
      'handle', p.channel_handle,
      'canonical_url', p.channel_url,
      'thumbnail_url', p.channel_thumbnail_url
    ),
    'summary', jsonb_build_object(
      'state', coalesce(s.state, 'not_requested'),
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
    select summary_key, state, summary_id, summary_text, key_points, language, generated_at
    from public.summaries
    where video_uid = p.video_uid and state = 'available'
    order by generated_at desc nulls last, summary_key desc
    limit 1
  ) s on true
  order by p.published_at desc, p.video_uid desc;
end;
$$;

revoke execute on function public.read_feed_page(uuid, timestamptz, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.read_feed_page(uuid, timestamptz, text, text, integer)
  to service_role;
