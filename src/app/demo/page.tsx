import Link from "next/link";
import { FeedScreen } from "@/components/feed-screen";
import { listDemoFeedRows } from "@/lib/db";
import { makeFeedPage, type FeedItem } from "@/lib/feed";
import { parseDemoChannelUids } from "@/lib/demo-feed-route";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const channelUids = parseDemoChannelUids(process.env.DEMO_CHANNEL_UIDS);
  let initialError = false;
  let items: FeedItem[] = [];
  if (channelUids.length > 0) {
    try {
      items = await listDemoFeedRows(channelUids, 20);
    } catch {
      initialError = true;
    }
  }
  return <>
    <div className="demo-banner"><div><strong>Public demo</strong><span>Read-only · summaries are already cached</span></div><Link href="/login">Create your own feed</Link></div>
    {channelUids.length === 0 ? <section className="feed-empty" aria-labelledby="demo-unavailable">
      <h1 id="demo-unavailable">Demo feed isn’t configured yet.</h1>
      <p>Sign in to create a feed from the channels you choose.</p>
    </section> : <FeedScreen
      initialPage={makeFeedPage(items, 20)}
      channels={[]}
      selectedChannelUid={null}
      initialError={initialError}
      filterUnavailable={false}
      demo
    />}
  </>;
}
