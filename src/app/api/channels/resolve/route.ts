import { getAuthenticatedUser } from "@/lib/supabase/auth";
import { followRepository } from "@/lib/db";
import { resolveChannel } from "@/lib/follow-lifecycle";
import { productError } from "@/lib/api-errors";
import { runtimeChannelResolver } from "@/lib/providers/runtime";

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
    const mapped = productError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
