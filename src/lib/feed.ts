import { Buffer } from "node:buffer";

export const DEFAULT_FEED_LIMIT = 20;
export const MAX_FEED_LIMIT = 50;

export type FeedCursor = {
  published_at: string;
  video_uid: string;
};

export type FeedQuery = {
  cursor: FeedCursor | null;
  channel_uid: string | null;
  limit: number;
};

export type FeedItem = {
  video: {
    video_uid: string;
    channel_uid: string;
    native_video_id: string;
    title: string;
    canonical_url: string;
    thumbnail_url: string | null;
    published_at: string;
    duration_seconds: number | null;
    availability: "public" | "private" | "unavailable" | "unknown";
    provider_snapshot_id: string | null;
    live_status?: "unknown" | "completed" | "live" | "upcoming";
  };
  channel: {
    channel_uid: string;
    title: string;
    handle: string | null;
    canonical_url: string;
    thumbnail_url: string | null;
  };
  summary: {
    state: "available" | "generating" | "not_requested" | "short_video" | "long_video" | "live_or_upcoming" | "quota_blocked" | "failed";
    summary_id: string | null;
    summary: string | null;
    key_points: string[];
    language: string | null;
    generated_at: string | null;
    retryable: boolean | null;
  };
};

export function summaryStateLabel(state: FeedItem["summary"]["state"]): string {
  switch (state) {
    case "available": return "Summary";
    case "generating": return "Summarizing…";
    case "short_video": return "Short clip · no summary";
    case "long_video": return "Long video · summary unavailable";
    case "live_or_upcoming": return "Live or upcoming · not summarized";
    case "quota_blocked": return "Summary allowance reached";
    case "failed": return "Summary temporarily unavailable";
    case "not_requested": return "No summary yet";
  }
}

export type FeedPage = {
  items: FeedItem[];
  next_cursor: string | null;
};

export type FeedQueryResult = { ok: true; value: FeedQuery } | { ok: false; message: string };

const CHANNEL_UID = /^youtube-channel:UC[A-Za-z0-9_-]{22}$/;
const VIDEO_UID = /^youtube:[A-Za-z0-9_-]{11}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function validCursor(value: unknown): value is FeedCursor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cursor = value as Record<string, unknown>;
  return Object.keys(cursor).length === 2
    && typeof cursor.published_at === "string"
    && TIMESTAMP.test(cursor.published_at)
    && Number.isFinite(Date.parse(cursor.published_at))
    && typeof cursor.video_uid === "string"
    && VIDEO_UID.test(cursor.video_uid);
}

export function encodeFeedCursor(cursor: FeedCursor): string {
  if (!validCursor(cursor)) throw new TypeError("Invalid feed cursor");
  return `v1.${Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")}`;
}

export function decodeFeedCursor(value: string): FeedCursor | null {
  if (!value || value.length > 512 || !value.startsWith("v1.")) return null;
  const encoded = value.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return validCursor(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

export function parseFeedQuery(params: URLSearchParams): FeedQueryResult {
  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeFeedCursor(rawCursor);
  if (rawCursor !== null && !cursor) return { ok: false, message: "Invalid feed cursor." };

  const rawChannel = params.get("channel_uid");
  if (rawChannel !== null && !CHANNEL_UID.test(rawChannel)) {
    return { ok: false, message: "Invalid channel filter." };
  }

  const rawLimit = params.get("limit");
  let limit = DEFAULT_FEED_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit)) return { ok: false, message: "Invalid page size." };
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_FEED_LIMIT) return { ok: false, message: "Invalid page size." };
  }

  return { ok: true, value: { cursor, channel_uid: rawChannel, limit } };
}

/** The database query returns one extra row so the client can know whether to page. */
export function makeFeedPage(rows: FeedItem[], limit: number): FeedPage {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: rows.length > limit && last
      ? encodeFeedCursor({ published_at: last.video.published_at, video_uid: last.video.video_uid })
      : null,
  };
}
