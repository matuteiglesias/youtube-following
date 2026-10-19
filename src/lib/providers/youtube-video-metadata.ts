/** Bounded YouTube Data API metadata recheck for a video explicitly opened by a user.
 * This is NOT called while scrolling, running scheduler discovery or listing feeds.
 */
export type VideoMetadata = {
  duration_seconds: number | null;
  live_status: "completed" | "live" | "upcoming" | "unknown";
  availability: "public" | "private" | "unknown";
  thumbnail_url: string | null;
};

export function isoDurationSeconds(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw);
  if (!m) return null;
  const seconds = Number(m[1] ?? 0)*86400 + Number(m[2] ?? 0)*3600
    + Number(m[3] ?? 0)*60 + Number(m[4] ?? 0);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export async function fetchCurrentVideoMetadata(
  uid: string,
  key: string,
  fetcher: typeof fetch = fetch,
): Promise<VideoMetadata | null> {
  const videoId = /^youtube:([A-Za-z0-9_-]{11})$/.exec(uid)?.[1];
  if (!videoId || !key.trim()) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails,status,liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let payload: unknown;
  try {
    const response = await fetcher(url, { signal: controller.signal });
    if (!response.ok) return null;
    payload = await response.json();
  } catch { return null; }
  finally { clearTimeout(timeout); }
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  const entry = items.find((v) => v !== null && typeof v === "object" && (v as { id?: unknown }).id === videoId) as {
    snippet?: { liveBroadcastContent?: string; thumbnails?: Record<string,{ url?: string }> };
    contentDetails?: { duration?: string };
    status?: { privacyStatus?: string };
    liveStreamingDetails?: { actualEndTime?: string; scheduledStartTime?: string; actualStartTime?: string };
  } | undefined;
  if (!entry) return null;
  const duration = isoDurationSeconds(entry.contentDetails?.duration);
  const broadcast = entry.snippet?.liveBroadcastContent;
  const live = entry.liveStreamingDetails;
  const liveStatus = broadcast === "live" ? "live"
    : broadcast === "upcoming" ? "upcoming"
      : live?.actualStartTime && !live?.actualEndTime ? "live"
        : duration && (broadcast === "none" || Boolean(live?.actualEndTime))
          ? "completed" : "unknown";
  const privacy = entry.status?.privacyStatus;
  const thumbnail = ["high","medium","default"].map((k) => entry.snippet?.thumbnails?.[k]?.url)
    .find((v): v is string => typeof v === "string" && /^https:\/\//.test(v)) ?? null;
  return {
    duration_seconds: duration, live_status: liveStatus,
    availability: privacy === "public" || privacy === "unlisted" ? "public"
      : privacy === "private" ? "private" : "unknown",
    thumbnail_url: thumbnail,
  };
}
