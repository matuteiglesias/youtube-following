import type { FeedItem } from "./feed.ts";

export const DEFAULT_DAILY_DIGEST_LIMIT = 100;
export const MAX_DAILY_DIGEST_LIMIT = 100;
export const MAX_DAILY_DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type DailyDigestQuery = {
  window_start: string;
  window_end: string;
  limit: number;
};

export type DailyDigestInput = {
  generated_at: string;
  window_start: string;
  window_end: string;
  item_count: number;
  channel_count: number;
  truncated: boolean;
  items: FeedItem[];
};

export type DailyDigestQueryResult =
  | { ok: true; value: DailyDigestQuery }
  | { ok: false; message: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

function validTimestamp(value: string | null): value is string {
  return value !== null && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

export function parseDailyDigestQuery(params: URLSearchParams): DailyDigestQueryResult {
  const windowStart = params.get("window_start");
  const windowEnd = params.get("window_end");
  if (!validTimestamp(windowStart) || !validTimestamp(windowEnd)) {
    return { ok: false, message: "window_start and window_end must be valid ISO timestamps." };
  }

  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  if (startMs >= endMs) {
    return { ok: false, message: "window_start must be before window_end." };
  }
  if (endMs - startMs > MAX_DAILY_DIGEST_WINDOW_MS) {
    return { ok: false, message: "Digest windows cannot exceed 7 days." };
  }

  const rawLimit = params.get("limit");
  let limit = DEFAULT_DAILY_DIGEST_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit)) {
      return { ok: false, message: "Invalid digest limit." };
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_DAILY_DIGEST_LIMIT) {
      return { ok: false, message: "Digest limit must be between 1 and 100." };
    }
  }

  return {
    ok: true,
    value: { window_start: windowStart, window_end: windowEnd, limit },
  };
}

/** The database projection over-fetches one row so truncation is explicit. */
export function makeDailyDigest(
  rows: FeedItem[],
  query: DailyDigestQuery,
  generatedAt: string,
): DailyDigestInput {
  if (!validTimestamp(generatedAt)) throw new TypeError("Invalid digest generated_at");

  const items = rows.slice(0, query.limit);
  return {
    generated_at: generatedAt,
    window_start: query.window_start,
    window_end: query.window_end,
    item_count: items.length,
    channel_count: new Set(items.map((item) => item.channel.channel_uid)).size,
    truncated: rows.length > query.limit,
    items,
  };
}

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "unknown";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remaining}s`;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${remaining}s`;
}

/** Pure, byte-stable Markdown renderer for an already-built digest input. */
export function renderDailyDigest(input: DailyDigestInput): string {
  const lines = [
    "# YouTube Following daily digest",
    "",
    `Generated at: ${input.generated_at}`,
    `Window: [${input.window_start}, ${input.window_end})`,
    `Uploads: ${input.item_count}`,
    `Channels: ${input.channel_count}`,
    `Truncated: ${input.truncated ? "yes" : "no"}`,
  ];

  if (input.items.length === 0) {
    lines.push("", "No uploads in this window.");
    return `${lines.join("\n")}\n`;
  }

  for (const item of input.items) {
    const channel = item.channel.handle
      ? `${inline(item.channel.title)} (${inline(item.channel.handle)})`
      : inline(item.channel.title);
    lines.push(
      "",
      `## ${channel} — ${inline(item.video.title)}`,
      "",
      `Published: ${item.video.published_at}`,
      `Duration: ${durationLabel(item.video.duration_seconds)}`,
      `Watch on YouTube: ${item.video.canonical_url}`,
    );

    if (item.summary.state === "available" && item.summary.summary?.trim()) {
      lines.push("", item.summary.summary.trim());
      const points = item.summary.key_points.filter((point) => point.trim()).slice(0, 3);
      if (points.length > 0) {
        lines.push("", "Key points:");
        for (const point of points) lines.push(`- ${inline(point)}`);
      }
    } else {
      lines.push("", "No cached summary yet.");
    }
  }

  return `${lines.join("\n")}\n`;
}
