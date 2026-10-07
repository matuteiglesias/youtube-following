import { getAuthenticatedUser } from "@/lib/supabase/auth";
import { followRepository } from "@/lib/db";
import { resolveChannel } from "@/lib/follow-lifecycle";
import { productError } from "@/lib/api-errors";
import { runtimeChannelResolver } from "@/lib/providers/runtime";
import { ProviderError } from "@/lib/providers/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: { code: "INVALID_CHANNEL_REFERENCE", message: "That doesn't look like a YouTube channel." } }, { status: 400 }); }
  const reference = body && typeof body === "object" && typeof (body as { reference?: unknown }).reference === "string"
    ? (body as { reference: string }).reference : "";
  if (!reference.trim()) return Response.json({ error: { code: "INVALID_CHANNEL_REFERENCE", message: "That doesn't look like a YouTube channel." } }, { status: 400 });
  try {
    const result = await resolveChannel(reference, user.id, runtimeChannelResolver(), followRepository());
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    const fields = error && typeof error === "object" ? error as {
      code?: unknown;
      diagnosticCode?: unknown;
      upstreamStatus?: unknown;
    } : {};
    console.error("channel resolution failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      code: typeof fields.code === "string" ? fields.code : null,
      diagnosticCode: typeof fields.diagnosticCode === "string" ? fields.diagnosticCode : null,
      upstreamStatus: typeof fields.upstreamStatus === "number" ? fields.upstreamStatus : null,
      providerError: Boolean(providerError),
    });
    const mapped = productError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
