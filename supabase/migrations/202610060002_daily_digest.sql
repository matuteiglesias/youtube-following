-- R3: deterministic, provider-free projection of followed-channel uploads
-- inside a caller-supplied half-open time window.
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
        when p.duration_seconds < 90 then 'short_video'
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
grant execute on function public.read_daily_digest(uuid, timestamptz, timestamptz, integer)
  to service_role;
