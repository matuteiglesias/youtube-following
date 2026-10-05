import {
  ProviderError,
  type ProviderSummaryResult,
  type SummaryState,
  type Video,
  type VideoArtifactProvider,
} from "./contracts.ts";

type MediaMonitorPaths = {
  ensure: string;
  inspect: string;
  summary: string;
};

type FetchLike = typeof fetch;
type TokenProvider = (audience: string) => Promise<string>;

/** Obtain a short-lived Cloud Run identity token from the attached runtime identity. */
export async function cloudRunIdentityToken(audience: string, fetcher: FetchLike = fetch): Promise<string> {
  const metadata = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
  metadata.searchParams.set("audience", audience);
  metadata.searchParams.set("format", "full");
  let response: Response;
  try {
    response = await fetcher(metadata, { headers: { "Metadata-Flavor": "Google" } });
  } catch {
    throw new ProviderError("unavailable", "Media Monitor authentication is unavailable");
  }
  if (!response.ok) throw new ProviderError("unavailable", "Media Monitor authentication is unavailable");
  const token = (await response.text()).trim();
  if (!token || token.split(".").length !== 3) {
    throw new ProviderError("unavailable", "Media Monitor authentication is unavailable");
  }
  return token;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pick(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableHttpsUrl(value: unknown): string | null {
  const candidate = stringValue(value);
  if (!candidate) return null;
  try { return new URL(candidate).protocol === "https:" ? candidate : null; }
  catch { return null; }
}

function productVideo(payload: unknown): Video {
  const root = object(payload);
  const record = object(root?.video) ?? object(root?.data) ?? root;
  const metadata = object(record?.metadata) ?? record;
  const channel = object(record?.channel);
  if (!record || !metadata) throw new ProviderError("invalid_response", "Media Monitor returned an invalid video");
  const nativeVideoId = stringValue(pick(record, "native_video_id", "video_id", "youtube_video_id"));
  const nativeChannelId = stringValue(pick(channel ?? record, "native_channel_id", "channel_id", "youtube_channel_id"));
  const title = stringValue(pick(metadata, "title", "video_title"));
  const published = stringValue(pick(metadata, "published_at", "published", "upload_date"));
  if (!nativeVideoId || !/^[A-Za-z0-9_-]{11}$/.test(nativeVideoId)
    || !nativeChannelId || !/^UC[A-Za-z0-9_-]{22}$/.test(nativeChannelId)
    || !title || !published) {
    throw new ProviderError("invalid_response", "Media Monitor returned an invalid video");
  }
  const publishedDate = new Date(published);
  if (!Number.isFinite(publishedDate.getTime())) {
    throw new ProviderError("invalid_response", "Media Monitor returned an invalid video");
  }
  const durationValue = pick(metadata, "duration_seconds", "duration");
  const duration = typeof durationValue === "number" && Number.isFinite(durationValue) && durationValue >= 0
    ? Math.floor(durationValue)
    : null;
  const rawAvailability = stringValue(pick(metadata, "availability", "privacy_status"))?.toLowerCase();
  const availability: Video["availability"] = rawAvailability === "public" || rawAvailability === "private"
    || rawAvailability === "unavailable" ? rawAvailability : "unknown";
  const snapshotId = stringValue(pick(metadata, "provider_snapshot_id", "snapshot_id", "artifact_id"));
  return {
    video_uid: `youtube:${nativeVideoId}`,
    channel_uid: `youtube-channel:${nativeChannelId}`,
    native_video_id: nativeVideoId,
    title,
    canonical_url: `https://www.youtube.com/watch?v=${nativeVideoId}`,
    thumbnail_url: nullableHttpsUrl(pick(metadata, "thumbnail_url", "thumbnail")),
    published_at: publishedDate.toISOString(),
    duration_seconds: duration,
    availability,
    provider_snapshot_id: snapshotId,
  };
}

const SUMMARY_STATES = new Set<SummaryState>([
  "available", "generating", "not_requested", "short_video", "long_video",
  "live_or_upcoming", "quota_blocked", "failed",
]);

function productSummary(payload: unknown): ProviderSummaryResult {
  const root = object(payload);
  const record = object(root?.summary) ?? object(root?.data) ?? root;
  const providerState = stringValue(record?.state);
  const state = providerState === "not_attempted" ? "not_requested"
    : providerState === "provider_limit" ? "quota_blocked"
      : providerState as SummaryState | null;
  if (!record || !state || !SUMMARY_STATES.has(state)) {
    throw new ProviderError("invalid_response", "Media Monitor returned an invalid summary");
  }
  const keyPoints = Array.isArray(record.key_points)
    ? record.key_points.filter((point): point is string => typeof point === "string").map((point) => point.trim()).filter(Boolean).slice(0, 3)
    : [];
  const summary = stringValue(pick(record, "summary", "summary_text"));
  if (state === "available" && !summary) {
    throw new ProviderError("invalid_response", "Media Monitor returned an invalid summary");
  }
  const generated = stringValue(record.generated_at);
  const generatedDate = generated ? new Date(generated) : null;
  return {
    summary: {
      state,
      summary_id: stringValue(pick(record, "summary_id", "id")),
      summary: state === "available" ? summary : null,
      key_points: state === "available" ? keyPoints : [],
      language: stringValue(record.language),
      generated_at: generatedDate && Number.isFinite(generatedDate.getTime()) ? generatedDate.toISOString() : null,
      retryable: typeof record.retryable === "boolean" ? record.retryable : null,
    },
    provider: stringValue(pick(record, "provider")),
    model: stringValue(pick(record, "model")),
  };
}

function videoId(reference: string): string {
  const value = reference.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ProviderError("invalid_reference", "Invalid YouTube video reference"); }
  if (!new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]).has(url.hostname.toLowerCase())
    || url.protocol !== "https:") {
    throw new ProviderError("invalid_reference", "Invalid YouTube video reference");
  }
  const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new ProviderError("invalid_reference", "Invalid YouTube video reference");
  }
  return id;
}

function videoIdFromUid(uid: string): string {
  const match = /^youtube:([A-Za-z0-9_-]{11})$/.exec(uid);
  if (!match) throw new ProviderError("invalid_reference", "Invalid canonical YouTube video ID");
  return match[1];
}

/**
 * Thin server-side adapter. The paths and payload mapping are intentionally
 * isolated here because the existing private sidecar contract is transitional.
 */
export class MediaMonitorVideoArtifactProvider implements VideoArtifactProvider {
  private readonly baseUrl: URL;
  private readonly audience: string;
  private readonly paths: MediaMonitorPaths;
  private readonly tokenProvider: TokenProvider;
  private readonly fetcher: FetchLike;

  constructor(
    baseUrl: string,
    tokenProvider: TokenProvider = cloudRunIdentityToken,
    fetcher: FetchLike = fetch,
    options: { audience?: string; paths: MediaMonitorPaths; timeoutMs?: number },
  ) {
    this.baseUrl = new URL(baseUrl);
    if (this.baseUrl.protocol !== "https:") throw new Error("Media Monitor URL must use HTTPS");
    this.audience = options.audience ?? this.baseUrl.origin;
    this.paths = options.paths;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.tokenProvider = tokenProvider;
    this.fetcher = fetcher;
    for (const path of Object.values(this.paths)) {
      if (!path.startsWith("/")) throw new Error("Media Monitor paths must be absolute paths on the configured service");
    }
  }

  private readonly timeoutMs: number;

  async ensureVideo(reference: string): Promise<Video> {
    const id = videoId(reference);
    return productVideo(await this.post(this.paths.ensure, { video_id: id }));
  }

  async inspectVideo(uid: string): Promise<Video | null> {
    const id = videoIdFromUid(uid);
    const result = await this.post(this.paths.inspect, { video_id: id }, true);
    return result === null ? null : productVideo(result);
  }

  async ensureSummary(uid: string): Promise<ProviderSummaryResult> {
    const id = videoIdFromUid(uid);
    return productSummary(await this.post(this.paths.summary, { video_id: id }));
  }

  private async post(path: string, body: Record<string, string>, missingIsNull = false): Promise<unknown | null> {
    const target = new URL(path, this.baseUrl);
    if (target.origin !== this.baseUrl.origin) throw new Error("Media Monitor endpoint must share the configured origin");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = await this.tokenProvider(this.audience);
      const response = await this.fetcher(target, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (missingIsNull && response.status === 404) return null;
      if (!response.ok) throw new ProviderError("unavailable", "Media Monitor is temporarily unavailable");
      try { return await response.json() as unknown; }
      catch { throw new ProviderError("invalid_response", "Media Monitor returned an invalid response"); }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", "Media Monitor is temporarily unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Test-only implementation of both seams; application code can inject these directly. */
export class FakeVideoArtifactProvider implements VideoArtifactProvider {
  private readonly video: Video;
  private readonly providerSummary: ProviderSummaryResult;
  readonly ensured: string[] = [];
  readonly inspected: string[] = [];
  readonly summarized: string[] = [];

  constructor(
    video: Video,
    providerSummary: ProviderSummaryResult,
  ) {
    this.video = video;
    this.providerSummary = providerSummary;
  }

  async ensureVideo(reference: string): Promise<Video> {
    this.ensured.push(reference);
    return this.video;
  }
  async inspectVideo(uid: string): Promise<Video | null> {
    this.inspected.push(uid);
    return uid === this.video.video_uid ? this.video : null;
  }
  async ensureSummary(uid: string): Promise<ProviderSummaryResult> {
    this.summarized.push(uid);
    return this.providerSummary;
  }
}
