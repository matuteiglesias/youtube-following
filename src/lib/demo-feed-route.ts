import { makeFeedPage, type FeedItem } from "./feed.ts";

const CHANNEL_UID = /^youtube-channel:UC[A-Za-z0-9_-]{22}$/;

export function parseDemoChannelUids(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter((entry) => CHANNEL_UID.test(entry)))].slice(0, 12);
}

type Dependencies = {
  channelUids: string[];
  loadRows: (channelUids: string[], limit: number) => Promise<FeedItem[]>;
};

export async function handleDemoFeedGet(_request: Request, dependencies: Dependencies): Promise<Response> {
  try {
    const rows = await dependencies.loadRows(dependencies.channelUids, 20);
    const items = rows.filter((item) => item.summary.state !== "available" || Boolean(item.summary.summary));
    return Response.json(makeFeedPage(items, 20), { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch {
    return Response.json({ error: { code: "DEMO_FEED_UNAVAILABLE", message: "The demo feed is temporarily unavailable. Try again shortly." } }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}
