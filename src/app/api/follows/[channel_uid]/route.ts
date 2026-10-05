import { followRepository } from "@/lib/db";
import { productError } from "@/lib/api-errors";
import { unfollowChannel } from "@/lib/follow-lifecycle";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ channel_uid: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  const { channel_uid: channelUid } = await context.params;
  if (!/^youtube-channel:UC[A-Za-z0-9_-]{22}$/.test(channelUid)) {
    return Response.json({ error: { code: "INVALID_CHANNEL_REFERENCE", message: "That doesn't look like a YouTube channel." } }, { status: 400 });
  }
  try {
    await unfollowChannel(user.id, channelUid, followRepository());
    return new Response(null, { status: 204 });
  } catch (error) {
    const mapped = productError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
