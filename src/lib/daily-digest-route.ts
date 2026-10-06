import {
  makeDailyDigest,
  parseDailyDigestQuery,
  type DailyDigestQuery,
} from "./daily-digest.ts";
import type { FeedItem } from "./feed.ts";

type User = { id: string };

type Dependencies = {
  getUser: () => Promise<User | null>;
  loadRows: (userId: string, query: DailyDigestQuery) => Promise<FeedItem[]>;
  now?: () => string;
};

export async function handleDailyDigestGet(
  request: Request,
  dependencies: Dependencies,
): Promise<Response> {
  const user = await dependencies.getUser();
  if (!user) {
    return Response.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } },
      { status: 401 },
    );
  }

  const parsed = parseDailyDigestQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return Response.json(
      { error: { code: "INVALID_DIGEST_QUERY", message: parsed.message } },
      { status: 400 },
    );
  }

  try {
    const rows = await dependencies.loadRows(user.id, parsed.value);
    const digest = makeDailyDigest(
      rows,
      parsed.value,
      dependencies.now?.() ?? new Date().toISOString(),
    );
    return Response.json({ digest }, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "DIGEST_UNAVAILABLE",
          message: "Your digest is temporarily unavailable. Try again shortly.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
