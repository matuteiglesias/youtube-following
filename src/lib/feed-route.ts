import { makeFeedPage, parseFeedQuery, type FeedItem, type FeedQuery } from "./feed.ts";

type User = { id: string };
type Dependencies = {
  getUser: () => Promise<User | null>;
  loadRows: (userId: string, query: FeedQuery) => Promise<FeedItem[]>;
};

export async function handleFeedGet(request: Request, dependencies: Dependencies): Promise<Response> {
  const user = await dependencies.getUser();
  if (!user) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401 });
  }

  const parsed = parseFeedQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json({ error: { code: "INVALID_FEED_QUERY", message: parsed.message } }, { status: 400 });
  }

  try {
    const rows = await dependencies.loadRows(user.id, parsed.value);
    return Response.json(makeFeedPage(rows, parsed.value.limit), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json({
      error: { code: "FEED_UNAVAILABLE", message: "Your feed is temporarily unavailable. Try again shortly." },
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
