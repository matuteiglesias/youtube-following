import { signOut } from "@/app/login/actions";
import { FeedScreen } from "@/components/feed-screen";
import { listFeedRows, listMyFollows } from "@/lib/db";
import { DEFAULT_FEED_LIMIT, makeFeedPage } from "@/lib/feed";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FeedPage({ searchParams }: Props) {
  const user = await requireAuthenticatedUser();
  const query = await searchParams;
  let follows: Awaited<ReturnType<typeof listMyFollows>> = [];
  let initialError = false;
  try {
    follows = await listMyFollows(user.id);
  } catch {
    initialError = true;
  }
  const channelUidValue = query.channel_uid;
  const requestedChannelUid = typeof channelUidValue === "string" && channelUidValue ? channelUidValue : null;
  const filterUnavailable = requestedChannelUid !== null
    && !follows.some((item) => item.channel.channel_uid === requestedChannelUid);
  const selectedChannelUid = filterUnavailable ? null : requestedChannelUid;

  let initialPage = { items: [], next_cursor: null } as ReturnType<typeof makeFeedPage>;
  if (!initialError && !filterUnavailable) {
    try {
      const rows = await listFeedRows(user.id, {
        cursor: null,
        channel_uid: selectedChannelUid,
        limit: DEFAULT_FEED_LIMIT,
      });
      initialPage = makeFeedPage(rows, DEFAULT_FEED_LIMIT);
    } catch {
      initialError = true;
    }
  }

  return <>
    <header className="account-bar">
      <span>{user.email}</span>
      <form action={signOut}><button type="submit">Sign out</button></form>
    </header>
    {query.error === "signout-failed" ? <p role="alert">We couldn’t sign you out. Please try again.</p> : null}
    <FeedScreen
      initialPage={initialPage}
      channels={follows.map((item) => item.channel)}
      selectedChannelUid={selectedChannelUid}
      initialError={initialError}
      filterUnavailable={filterUnavailable}
    />
  </>;
}
