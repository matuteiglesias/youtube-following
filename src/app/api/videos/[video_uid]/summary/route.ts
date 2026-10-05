import { claimSummaryGeneration, completeSummaryGeneration, failSummaryGeneration, getVideoForSummary } from "@/lib/db";
import { runtimeVideoArtifactProvider } from "@/lib/providers/runtime";
import { handleSummaryPost } from "@/lib/summary-generation";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Context = { params: Promise<{ video_uid: string }> };

export async function POST(request: Request, context: Context) {
  const { video_uid: videoUid } = await context.params;
  return handleSummaryPost(request, videoUid, {
    getUser: getAuthenticatedUser,
    loadVideo: getVideoForSummary,
    claim: claimSummaryGeneration,
    ensureSummary: (uid) => runtimeVideoArtifactProvider().ensureSummary(uid),
    complete: completeSummaryGeneration,
    fail: failSummaryGeneration,
  });
}
