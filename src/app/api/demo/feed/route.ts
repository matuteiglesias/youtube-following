import { listDemoFeedRows } from "@/lib/db";
import { handleDemoFeedGet, parseDemoChannelUids } from "@/lib/demo-feed-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDemoFeedGet(request, {
    channelUids: parseDemoChannelUids(process.env.DEMO_CHANNEL_UIDS),
    loadRows: listDemoFeedRows,
  });
}
