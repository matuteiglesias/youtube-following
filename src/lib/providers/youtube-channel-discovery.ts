import { ProviderError, type ChannelDiscoveryProvider, type ResolvedChannel, type UploadHint } from "./contracts.ts";

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
  return /^[A-Za-z0-9._-]{1,100}$/.test(withoutAt) ? `@${withoutAt}` : null;
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
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed");
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
        throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function xmlTag(block: string, localName: string): string | null {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_-]+):)?${escaped}\\s*>`, "i"));
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
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
    if (results.length === safeLimit) break;
  }
  return results;
}

export class YouTubeChannelDiscoveryProvider implements ChannelDiscoveryProvider {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    fetcher: FetchLike = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    if (!apiKey.trim()) throw new Error("YouTube Data API key is required");
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
    if (!item?.id || !/^UC[A-Za-z0-9_-]{22}$/.test(item.id) || !item.snippet?.title?.trim()) {
      throw new ProviderError("not_found", "YouTube channel not found");
    }
    const handle = normalizeHandle(item.snippet.customUrl);
    return {
      channel_uid: `youtube-channel:${item.id}`,
      platform: "youtube",
      native_channel_id: item.id,
      handle,
      title: item.snippet.title.trim(),
      canonical_url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${item.id}`,
      thumbnail_url: firstThumbnail(item.snippet.thumbnails),
    };
  }

  async listRecentUploads(channel: ResolvedChannel, limit: number): Promise<UploadHint[]> {
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel.native_channel_id)) {
      throw new ProviderError("invalid_reference", "Invalid canonical YouTube channel");
    }
    if (!Number.isInteger(limit) || limit < 0) throw new RangeError("limit must be a non-negative integer");
    const response = await this.fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.native_channel_id}`);
    if (!response.ok) throw new ProviderError("unavailable", "YouTube uploads are temporarily unavailable");
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_FEED_BYTES) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed");
    }
    const xml = await readBoundedText(response);
    if (!/<(?:[\w-]+:)?(?:feed|rss)\b/i.test(xml)) {
      throw new ProviderError("invalid_response", "YouTube returned an invalid uploads feed");
    }
    return parseYouTubeUploadFeed(xml, Math.min(limit, MAX_FEED_LIMIT));
  }

  private async requestJson<T>(url: URL): Promise<T> {
    const response = await this.fetchWithTimeout(url);
    if (response.status === 404) throw new ProviderError("not_found", "YouTube channel not found");
    if (!response.ok) throw new ProviderError("unavailable", "YouTube is temporarily unavailable");
    try { return await response.json() as T; }
    catch { throw new ProviderError("invalid_response", "YouTube returned an invalid response"); }
  }

  private async fetchWithTimeout(input: string | URL): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(input, { signal: controller.signal }); }
    catch { throw new ProviderError("unavailable", "YouTube is temporarily unavailable"); }
    finally { clearTimeout(timeout); }
  }
}
