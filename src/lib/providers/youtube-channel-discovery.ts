import {
  ProviderError,
  type ChannelResolver,
  type ProviderDiagnosticCode,
  type ResolvedChannel,
  type UploadFrontierProvider,
  type UploadHint,
} from "./contracts.ts";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const MAX_FEED_LIMIT = 50;
const MAX_FEED_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 8_000;

type FetchLike = typeof fetch;

type YouTubeChannelResponse = {
  items?: Array<{
    id?: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> };
  }>;
};

type YouTubeThumbnails = NonNullable<NonNullable<YouTubeChannelResponse["items"]>[number]["snippet"]>["thumbnails"];

type GoogleErrorPayload = {
  error?: {
    errors?: Array<{ reason?: unknown }>;
    details?: Array<{ reason?: unknown }>;
  };
};

function canonicalReference(reference: string): { kind: "id" | "handle"; value: string } {
  const input = reference.trim();
  if (/^UC[A-Za-z0-9_-]{22}$/.test(input)) return { kind: "id", value: input };
  if (/^@[A-Za-z0-9._-]{1,100}$/.test(input)) return { kind: "handle", value: input.slice(1) };

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ProviderError("invalid_reference", "Invalid YouTube channel reference");
  }
  if (url.protocol !== "https:" || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ProviderError("invalid_reference", "Invalid YouTube channel reference");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "channel" && /^UC[A-Za-z0-9_-]{22}$/.test(parts[1])) {
    return { kind: "id", value: parts[1] };
  }
  if (parts.length === 1 && parts[0].startsWith("@") && /^@[A-Za-z0-9._-]{1,100}$/.test(parts[0])) {
    return { kind: "handle", value: parts[0].slice(1) };
  }
  throw new ProviderError("invalid_reference", "Invalid YouTube channel reference");
}

function firstThumbnail(thumbnails: YouTubeThumbnails): string | null {
  if (!thumbnails) return null;
  for (const key of ["high", "medium", "default", "standard", "maxres"]) {
    const value = thumbnails[key]?.url;
    if (value && safeHttpsUrl(value)) return value;
  }
  return null;
}

function safeHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function normalizeHandle(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const withoutAt = trimmed.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{1,100}$/.test(withoutAt) ? "@" + withoutAt : null;
}

function decodeXml(value: string): string {
  return value.replace(/&#x([\da-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

async function readBoundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_FEED_BYTES) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed", {
        diagnosticCode: "youtube_invalid_response",
        upstreamStatus: response.status,
      });
    }
    return text;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed", {
          diagnosticCode: "youtube_invalid_response",
          upstreamStatus: response.status,
        });
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function xmlTag(block: string, localName: string): string | null {
  const escaped = localName.replace(/[^A-Za-z0-9_-]/g, "\\$&");
  const pattern = "<(?:(?:[A-Za-z0-9_-]+):)?" + escaped
    + "\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_-]+):)?"
    + escaped + "\\s*>";
  const match = block.match(new RegExp(pattern, "i"));
  return match ? decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim()) : null;
}

/** Parse only public Atom/RSS upload hints; this is not canonical video metadata. */
export function parseYouTubeUploadFeed(xml: string, limit: number): UploadHint[] {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative integer");
  const safeLimit = Math.min(limit, MAX_FEED_LIMIT);
  if (safeLimit === 0) return [];
  const blocks = [...xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?entry\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?entry\s*>|<(?:[A-Za-z0-9_-]+:)?item\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?item\s*>/gi)];
  const results: UploadHint[] = [];
  const seen = new Set<string>();
  for (const match of blocks) {
    const block = match[1] ?? match[2] ?? "";
    const videoId = xmlTag(block, "videoId") ?? xmlTag(block, "video_id");
    const published = xmlTag(block, "published") ?? xmlTag(block, "pubDate") ?? xmlTag(block, "updated");
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId) || !published) continue;
    const date = new Date(published);
    if (!Number.isFinite(date.getTime())) continue;
    seen.add(videoId);
    const title = xmlTag(block, "title");
    results.push({
      native_video_id: videoId,
      published_at: date.toISOString(),
      title,
      url: "https://www.youtube.com/watch?v=" + videoId,
    });
    if (results.length === safeLimit) break;
  }
  return results;
}

function collectErrorReasons(payload: unknown): Set<string> {
  const reasons = new Set<string>();
  if (!payload || typeof payload !== "object") return reasons;
  const error = (payload as GoogleErrorPayload).error;
  for (const entry of error?.errors ?? []) if (typeof entry?.reason === "string") reasons.add(entry.reason);
  for (const entry of error?.details ?? []) if (typeof entry?.reason === "string") reasons.add(entry.reason);
  return reasons;
}

function diagnosticFromFailure(status: number, reasons: Set<string>): ProviderDiagnosticCode | null {
  if (status === 429 || reasons.has("rateLimitExceeded") || reasons.has("userRateLimitExceeded") || reasons.has("RATE_LIMIT_EXCEEDED")) {
    return "youtube_rate_limited";
  }
  if (reasons.has("quotaExceeded") || reasons.has("dailyLimitExceeded") || reasons.has("dailyLimitExceededUnreg") || reasons.has("QUOTA_EXCEEDED")) {
    return "youtube_quota";
  }
  if (reasons.has("API_KEY_INVALID") || reasons.has("keyInvalid")) return "youtube_auth_invalid";
  if (reasons.has("SERVICE_DISABLED") || reasons.has("accessNotConfigured")) return "youtube_api_disabled";
  if ([
    "API_KEY_SERVICE_BLOCKED",
    "API_KEY_HTTP_REFERRER_BLOCKED",
    "API_KEY_IP_ADDRESS_BLOCKED",
    "API_KEY_ANDROID_APP_BLOCKED",
    "API_KEY_IOS_APP_BLOCKED",
  ].some((reason) => reasons.has(reason))) return "youtube_key_restricted";
  if (status >= 500) return "youtube_upstream_5xx";
  return null;
}

async function dataApiFailure(response: Response): Promise<ProviderError> {
  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* Classification is optional when the body is not JSON. */ }
  const reasons = collectErrorReasons(payload);
  if (response.status === 404 || reasons.has("channelNotFound")) {
    return new ProviderError("not_found", "YouTube channel not found", { upstreamStatus: response.status });
  }
  const diagnosticCode = diagnosticFromFailure(response.status, reasons);
  return new ProviderError("unavailable", "YouTube is temporarily unavailable", {
    ...(diagnosticCode ? { diagnosticCode } : {}),
    upstreamStatus: response.status,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class YouTubeDataApiChannelResolver implements ChannelResolver {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(apiKey: string, fetcher: FetchLike = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!apiKey.trim()) {
      throw new ProviderError("unavailable", "YouTube is temporarily unavailable", {
        diagnosticCode: "youtube_configuration_missing",
      });
    }
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  async resolve(reference: string): Promise<ResolvedChannel> {
    const parsed = canonicalReference(reference);
    const url = new URL(YOUTUBE_API);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set(parsed.kind === "id" ? "id" : "forHandle", parsed.value);
    const payload = await this.requestJson<YouTubeChannelResponse>(url);
    const item = payload.items?.[0];
    if (!item) throw new ProviderError("not_found", "YouTube channel not found");
    if (!item.id || !/^UC[A-Za-z0-9_-]{22}$/.test(item.id) || !item.snippet?.title?.trim()) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid response", {
        diagnosticCode: "youtube_invalid_response",
      });
    }
    const handle = normalizeHandle(item.snippet.customUrl);
    return {
      channel_uid: "youtube-channel:" + item.id,
      platform: "youtube",
      native_channel_id: item.id,
      handle,
      title: item.snippet.title.trim(),
      canonical_url: handle ? "https://www.youtube.com/" + handle : "https://www.youtube.com/channel/" + item.id,
      thumbnail_url: firstThumbnail(item.snippet.thumbnails),
    };
  }

  private async requestJson<T>(url: URL): Promise<T> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) throw await dataApiFailure(response);
    try { return await response.json() as T; }
    catch {
      throw new ProviderError("invalid_response", "YouTube returned an invalid response", {
        diagnosticCode: "youtube_invalid_response",
        upstreamStatus: response.status,
      });
    }
  }

  private async fetchWithTimeout(input: string | URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(input, { signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new ProviderError("unavailable", "YouTube is temporarily unavailable", {
          diagnosticCode: "youtube_timeout",
        });
      }
      throw new ProviderError("unavailable", "YouTube is temporarily unavailable");
    } finally { clearTimeout(timeout); }
  }
}

export class YouTubeAtomUploadFrontier implements UploadFrontierProvider {
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(fetcher: FetchLike = fetch, timeoutMs = REQUEST_TIMEOUT_MS) {
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  async listRecentUploads(channel: ResolvedChannel, limit: number): Promise<UploadHint[]> {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel.native_channel_id)) {
      throw new ProviderError("invalid_reference", "Invalid canonical YouTube channel");
    }
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative integer");
    const response = await this.fetchWithTimeout("https://www.youtube.com/feeds/videos.xml?channel_id=" + channel.native_channel_id);
    if (!response.ok) {
      const diagnosticCode = response.status === 429 ? "youtube_rate_limited"
        : response.status >= 500 ? "youtube_upstream_5xx" : undefined;
      throw new ProviderError("unavailable", "YouTube uploads are temporarily unavailable", {
        ...(diagnosticCode ? { diagnosticCode } : {}),
        upstreamStatus: response.status,
      });
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_FEED_BYTES) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed", {
        diagnosticCode: "youtube_invalid_response",
        upstreamStatus: response.status,
      });
    }
    const xml = await readBoundedText(response);
    if (!/<(?:[\w-]+:)?(?:feed|rss)\b/i.test(xml)) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed", {
        diagnosticCode: "youtube_invalid_response",
        upstreamStatus: response.status,
      });
    }
    return parseYouTubeUploadFeed(xml, Math.min(limit, MAX_FEED_LIMIT));
  }

  private async fetchWithTimeout(input: string | URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(input, { signal: controller.signal }); }
    catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        throw new ProviderError("unavailable", "YouTube uploads are temporarily unavailable", {
          diagnosticCode: "youtube_timeout",
        });
      }
      throw new ProviderError("unavailable", "YouTube uploads are temporarily unavailable");
    } finally { clearTimeout(timeout); }
  }
}
