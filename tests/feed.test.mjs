import assert from "node:assert/strict";
import test from "node:test";
import { decodeFeedCursor, encodeFeedCursor, makeFeedPage, parseFeedQuery, summaryStateLabel } from "../src/lib/feed.ts";
import { handleFeedGet } from "../src/lib/feed-route.ts";

const cursor = { published_at: "2026-10-05T12:00:00.000Z", video_uid: "youtube:abcdefghijk" };

function item(id, publishedAt = cursor.published_at) {
  return {
    video: {
      video_uid: `youtube:${id}`,
      channel_uid: "youtube-channel:UC0123456789abcdefghijkl",
      native_video_id: id,
      title: `Video ${id}`,
      canonical_url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail_url: null,
      published_at: publishedAt,
      duration_seconds: null,
      availability: "unknown",
      provider_snapshot_id: null,
    },
    channel: {
      channel_uid: "youtube-channel:UC0123456789abcdefghijkl",
      title: "Example channel",
      handle: "@example",
      canonical_url: "https://www.youtube.com/@example",
      thumbnail_url: null,
    },
    summary: {
      state: "not_requested",
      summary_id: null,
      summary: null,
      key_points: [],
      language: null,
      generated_at: null,
      retryable: null,
    },
  };
}

test("feed cursor round-trips and rejects malformed or injected values", () => {
  const encoded = encodeFeedCursor(cursor);
  assert.deepEqual(decodeFeedCursor(encoded), cursor);
  for (const value of ["", "v2.abc", "v1.!!!", `v1.${Buffer.from('{"published_at":"2099-01-01T00:00:00Z,video_uid.lt.inject"}').toString("base64url")}`]) {
    assert.equal(decodeFeedCursor(value), null);
  }
});

test("feed query defaults to 20, permits a followed-channel filter and caps page size at 50", () => {
  assert.deepEqual(parseFeedQuery(new URLSearchParams()), {
    ok: true,
    value: { cursor: null, channel_uid: null, limit: 20 },
  });
  const params = new URLSearchParams({ cursor: encodeFeedCursor(cursor), channel_uid: "youtube-channel:UC0123456789abcdefghijkl", limit: "50" });
  const parsed = parseFeedQuery(params);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.value, { cursor, channel_uid: "youtube-channel:UC0123456789abcdefghijkl", limit: 50 });
  }
  for (const query of ["limit=0", "limit=51", "limit=1x", "channel_uid=other", "cursor=bad"]) {
    assert.equal(parseFeedQuery(new URLSearchParams(query)).ok, false, query);
  }
});

test("feed page uses the last visible item as its next keyset cursor", () => {
  const rows = [item("abcdefghijk"), item("ZYXWVUTSRQP", "2026-10-05T11:00:00.000Z"), item("mnopqrstuvw", "2026-10-05T10:00:00.000Z")];
  const page = makeFeedPage(rows, 2);
  assert.deepEqual(page.items, rows.slice(0, 2));
  assert.deepEqual(decodeFeedCursor(page.next_cursor), {
    published_at: rows[1].video.published_at,
    video_uid: rows[1].video.video_uid,
  });
  assert.equal(makeFeedPage(rows.slice(0, 2), 2).next_cursor, null);
});

test("feed presents every D5 summary state with bounded, user-safe copy", () => {
  const states = ["available", "generating", "not_requested", "short_video", "long_video", "live_or_upcoming", "quota_blocked", "failed"];
  for (const state of states) assert.ok(summaryStateLabel(state), state);
  assert.equal(summaryStateLabel("quota_blocked"), "Summary allowance reached");
  assert.equal(summaryStateLabel("failed"), "Summary temporarily unavailable");
});

test("feed route authenticates, rejects malformed queries and scopes reads to the session user", async () => {
  let loads = 0;
  const dependencies = {
    getUser: async () => null,
    loadRows: async () => { loads += 1; return []; },
  };
  const unauthenticated = await handleFeedGet(new Request("https://example.test/api/feed"), dependencies);
  assert.equal(unauthenticated.status, 401);
  assert.equal(loads, 0);

  dependencies.getUser = async () => ({ id: "user-a" });
  const invalid = await handleFeedGet(new Request("https://example.test/api/feed?limit=100"), dependencies);
  assert.equal(invalid.status, 400);
  assert.equal(loads, 0);

  dependencies.loadRows = async (userId, query) => {
    loads += 1;
    assert.equal(userId, "user-a");
    assert.deepEqual(query, { cursor: null, channel_uid: null, limit: 2 });
    return [item("abcdefghijk"), item("ZYXWVUTSRQP", "2026-10-05T11:00:00.000Z"), item("mnopqrstuvw", "2026-10-05T10:00:00.000Z")];
  };
  const response = await handleFeedGet(new Request("https://example.test/api/feed?limit=2"), dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.items.length, 2);
  assert.ok(body.next_cursor);
  assert.equal(loads, 1);
});

test("feed read failure is bounded and never returns raw database detail", async () => {
  const response = await handleFeedGet(new Request("https://example.test/api/feed"), {
    getUser: async () => ({ id: "user-a" }),
    loadRows: async () => { throw new Error("service role credential leaked"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "FEED_UNAVAILABLE", message: "Your feed is temporarily unavailable. Try again shortly." },
  });
});
