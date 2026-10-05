import { getEntitlement, listMyFollows, followRepository } from "@/lib/db";
import { followChannel } from "@/lib/follow-lifecycle";
import { productError } from "@/lib/api-errors";
import { runtimeChannelDiscoveryProvider } from "@/lib/providers/runtime";
import { runtimeVideoArtifactProvider } from "@/lib/providers/runtime";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

function publicChannel(channel: Record<string, unknown>) {
  return {
    channel_uid: channel.channel_uid,
    platform: "youtube",
    native_channel_id: channel.native_channel_id,
    handle: channel.handle,
    title: channel.title,
    canonical_url: channel.canonical_url,
    thumbnail_url: channel.thumbnail_url,
  };
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  try {
    const [items, entitlement] = await Promise.all([listMyFollows(user.id), getEntitlement(user.id)]);
    return Response.json({
      items: items.map((item) => ({ channel: publicChannel(item.channel), followed_at: item.followed_at })),
      limit: entitlement?.follow_limit ?? 0,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const mapped = productError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const channelUid = body && typeof body === "object" && typeof (body as { channel_uid?: unknown }).channel_uid === "string"
    ? (body as { channel_uid: string }).channel_uid : "";
  try {
    const result = await followChannel(user.id, channelUid, runtimeChannelDiscoveryProvider, runtimeVideoArtifactProvider, followRepository());
    const { created, ...follow } = result.follow;
    return Response.json({ follow, backfill: result.backfill }, { status: created ? 201 : 200 });
  } catch (error) {
    const mapped = productError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
