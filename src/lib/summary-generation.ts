import { createHash } from "node:crypto";
import type { ProviderSummaryResult } from "./providers/contracts.ts";

export const SUMMARY_SPEC_VERSION = "v1";
export const SUMMARY_LANGUAGE = "primary";
export const MAX_SUMMARY_ATTEMPTS = 3;

export type SummaryVideo = {
  video_uid: string; duration_seconds: number | null; availability: string; live_status: string;
};
export type SummaryClaim = { state: string; summary?: Record<string, unknown>; retryable?: boolean };
type SummaryView = {
  state: string; summary_id: string | null; summary: string | null; key_points: string[];
  language: string | null; generated_at: string | null; retryable: boolean | null;
};
type Dependencies = {
  getUser: () => Promise<{ id: string } | null>;
  loadVideo: (videoUid: string) => Promise<SummaryVideo | null>;
  claim: (input: { userId: string; videoUid: string; summaryKey: string; specVersion: string; language: string; chargedMinutes: number }) => Promise<SummaryClaim>;
  ensureSummary: (videoUid: string) => Promise<ProviderSummaryResult>;
  complete: (input: { summaryKey: string; userId: string; summaryId: string; summary: string; keyPoints: string[]; language: string; provider: string | null; model: string | null }) => Promise<boolean>;
  fail: (summaryKey: string, userId: string) => Promise<boolean>;
};

function view(row: Record<string, unknown>): SummaryView {
  return {
    state: String(row.state), summary_id: typeof row.summary_id === "string" ? row.summary_id : null,
    summary: typeof row.summary_text === "string" ? row.summary_text : null,
    key_points: Array.isArray(row.key_points) ? row.key_points.filter((point): point is string => typeof point === "string").slice(0, 3) : [],
    language: typeof row.language === "string" ? row.language : null,
    generated_at: typeof row.generated_at === "string" ? row.generated_at : null,
    retryable: row.retry_after ? Date.parse(String(row.retry_after)) > Date.now() : false,
  };
}

function response(summary: Partial<SummaryView> & { state: string }, status = 200) {
  return Response.json({ summary: {
    state: summary.state, summary_id: summary.summary_id ?? null, summary: summary.summary ?? null,
    key_points: summary.key_points ?? [], language: summary.language ?? null,
    generated_at: summary.generated_at ?? null, retryable: summary.retryable ?? null,
  } }, { status, headers: { "cache-control": "private, no-store" } });
}

export async function handleSummaryPost(_request: Request, videoUid: string, dependencies: Dependencies): Promise<Response> {
  const user = await dependencies.getUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  if (!/^youtube:[A-Za-z0-9_-]{11}$/.test(videoUid)) {
    return Response.json({ error: { code: "INVALID_VIDEO", message: "That video could not be summarized." } }, { status: 400 });
  }

  try {
    const video = await dependencies.loadVideo(videoUid);
    if (!video) return Response.json({ error: { code: "VIDEO_NOT_FOUND", message: "That video could not be found." } }, { status: 404 });
    const key = `sha256:${createHash("sha256").update(`${videoUid}\n${SUMMARY_SPEC_VERSION}\n${SUMMARY_LANGUAGE}`).digest("hex")}`;
    const chargedMinutes = video.duration_seconds === null ? 1 : Math.max(1, Math.ceil(video.duration_seconds / 60));
    const claim = await dependencies.claim({ userId: user.id, videoUid, summaryKey: key,
      specVersion: SUMMARY_SPEC_VERSION, language: SUMMARY_LANGUAGE, chargedMinutes });

    if (claim.state === "available" && claim.summary) return response(view(claim.summary));
    if (claim.state === "claimed") {
      try {
        const result = await dependencies.ensureSummary(videoUid);
        const summary = result.summary;
        if (summary.state !== "available" || !summary.summary_id || !summary.summary?.trim()) {
          const retryable = await dependencies.fail(key, user.id);
          return response({ state: "failed", retryable });
        }
        const saved = await dependencies.complete({ summaryKey: key, userId: user.id,
          summaryId: summary.summary_id, summary: summary.summary.trim(),
          keyPoints: summary.key_points.filter((point) => typeof point === "string" && point.trim()).slice(0, 3),
          language: summary.language ?? SUMMARY_LANGUAGE, provider: result.provider, model: result.model });
        if (!saved) return response({ state: "generating" }, 202);
        return response({ ...summary, language: summary.language ?? SUMMARY_LANGUAGE });
      } catch {
        let retryable = false;
        try { retryable = await dependencies.fail(key, user.id); } catch { /* lease expiry makes a claim recoverable */ }
        return response({ state: "failed", retryable });
      }
    }
    if (claim.state === "generating") return response({ state: "generating" }, 202);
    if (claim.state === "quota_blocked") return response({ state: "quota_blocked" });
    if (claim.state === "short_video" || claim.state === "long_video" || claim.state === "live_or_upcoming") {
      return response({ state: claim.state });
    }
    if (claim.state === "failed") return response({ state: "failed", retryable: claim.retryable ?? false });
    return Response.json({ error: { code: "VIDEO_NOT_FOUND", message: "That video could not be found." } }, { status: 404 });
  } catch {
    return Response.json({ error: { code: "SUMMARY_UNAVAILABLE", message: "Summary is temporarily unavailable. Try again shortly." } }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
