/** Product-owned shapes that provider adapters return to application code. */
export type Channel = {
  channel_uid: string;
  platform: "youtube";
  native_channel_id: string;
  handle: string | null;
  title: string;
  canonical_url: string;
  thumbnail_url: string | null;
  monitoring_status: "active" | "idle" | "error";
};

export type ResolvedChannel = Omit<Channel, "monitoring_status">;

export type UploadHint = {
  native_video_id: string;
  published_at: string;
  title: string | null;
  url: string;
};

export type Video = {
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

export type SummaryState =
  | "available"
  | "generating"
  | "not_requested"
  | "short_video"
  | "long_video"
  | "live_or_upcoming"
  | "quota_blocked"
  | "failed";

export type SummaryView = {
  state: SummaryState;
  summary_id: string | null;
  summary: string | null;
  key_points: string[];
  language: string | null;
  generated_at: string | null;
  retryable: boolean | null;
};

/** Minimal provider-facing information retained for server-side auditability. */
export type ProviderSummaryResult = {
  summary: SummaryView;
  provider: string | null;
  model: string | null;
};

export interface ChannelDiscoveryProvider {
  resolve(reference: string): Promise<ResolvedChannel>;
  listRecentUploads(channel: ResolvedChannel, limit: number): Promise<UploadHint[]>;
}

export interface VideoArtifactProvider {
  ensureVideo(videoReference: string): Promise<Video>;
  inspectVideo(videoUid: string): Promise<Video | null>;
  ensureSummary(videoUid: string): Promise<ProviderSummaryResult>;
}

export class ProviderError extends Error {
  readonly code: "invalid_reference" | "not_found" | "unavailable" | "invalid_response";

  constructor(code: ProviderError["code"], message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}
