import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { getEntitlement, listMyFollows } from "@/lib/db";
import { FollowingScreen } from "@/components/following-screen";

export default async function FollowingPage() {
  const user = await requireAuthenticatedUser();
  let items: Awaited<ReturnType<typeof listMyFollows>> = [];
  let limit = 0;
  let initialError = false;
  try {
    [items, limit] = await Promise.all([
      listMyFollows(user.id),
      getEntitlement(user.id).then((entitlement) => entitlement?.follow_limit ?? 0),
    ]);
  } catch {
    initialError = true;
  }
  return <FollowingScreen
    initialItems={items.map((item) => ({
      followed_at: item.followed_at,
      channel: {
        channel_uid: item.channel.channel_uid,
        platform: "youtube" as const,
        native_channel_id: item.channel.native_channel_id,
        handle: item.channel.handle,
        title: item.channel.title,
        canonical_url: item.channel.canonical_url,
        thumbnail_url: item.channel.thumbnail_url,
      },
    }))}
    limit={limit}
    initialError={initialError}
  />;
}
