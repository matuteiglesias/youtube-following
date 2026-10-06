import assert from "node:assert/strict";
import test from "node:test";
import {
  makeDailyDigest,
  parseDailyDigestQuery,
  renderDailyDigest,
} from "../src/lib/daily-digest.ts";
import { handleDailyDigestGet } from "../src/lib/daily-digest-route.ts";

const start = "2026-10-06T00:00:00.000Z";
const end = "2026-10-07T00:00:00.000Z";
const generatedAt = "2026-10-07T00:05:00.000Z";

function item(id, options = {}) {
  return {
    video: {
      video_uid: `youtube:${id}`,
      channel_uid: options.channelUid ?? "youtube-channel:UC0123456789abcdefghijkl",
      native_video_id: id,
      title: options.title ?? `Video ${id}`,
      canonical_url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail_url: null,
      published_at: options.publishedAt ?? "2026-10-06T12:00:00.000Z",
      duration_seconds: options.durationSeconds ?? 121,
      availability: "public",
      provider_snapshot_id: null,
      live_status: "completed",
    },
    channel: {
      channel_uid: options.channelUid ?? "youtube-channel:UC0123456789abcdefghijkl",
      title: options.channelTitle ?? "Example channel",
      handle: options.handle ?? "@example",
      canonical_url: options.channelUrl ?? "https://www.youtube.com/@example",
      thumbnail_url: null,
    },
    summary: options.summary ?? {
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

test("digest query requires an explicit valid bounded half-open window and bounded limit", () => {
  assert.equal(parseDailyDigestQuery(new URLSearchParams()).ok, false);
  assert.equal(parseDailyDigestQuery(new URLSearchParams({ window_start: end, window_end: start })).ok, false);
  assert.equal(parseDailyDigestQuery(new URLSearchParams({
    window_start: start,
    window_end: "2026-10-14T00:00:00.001Z",
  })).ok, false);

  const parsed = parseDailyDigestQuery(new URLSearchParams({
    window_start: start,
    window_end: end,
    limit: "2",
  }));
  assert.deepEqual(parsed, {
    ok: true,
    value: { window_start: start, window_end: end, limit: 2 },
  });

  for (const limit of ["0", "101", "1x"]) {
    assert.equal(parseDailyDigestQuery(new URLSearchParams({
      window_start: start,
      window_end: end,
      limit,
    })).ok, false, limit);
  }
});

test("digest construction counts visible channels and reports truncation from one-row overfetch", () => {
  const rows = [
    item("zzzzzzzzzzz"),
    item("yyyyyyyyyyy", { channelUid: "youtube-channel:UCabcdefghijklmnopqrstuv" }),
    item("xxxxxxxxxxx"),
  ];
  const digest = makeDailyDigest(
    rows,
    { window_start: start, window_end: end, limit: 2 },
    generatedAt,
  );
  assert.equal(digest.item_count, 2);
  assert.equal(digest.channel_count, 2);
  assert.equal(digest.truncated, true);
  assert.deepEqual(digest.items, rows.slice(0, 2));
});

test("pure Markdown renderer is byte-stable and distinguishes cached from absent summaries", () => {
  const cached = item("abcdefghijk", {
    summary: {
      state: "available",
      summary_id: "summary-1",
      summary: "A cached explanation.",
      key_points: ["First point", "Second point"],
      language: "en",
      generated_at: "2026-10-06T13:00:00.000Z",
      retryable: false,
    },
  });
  const uncached = item("lmnopqrstuv", { durationSeconds: null });
  const digest = makeDailyDigest(
    [cached, uncached],
    { window_start: start, window_end: end, limit: 100 },
    generatedAt,
  );

  const first = renderDailyDigest(digest);
  const second = renderDailyDigest(digest);
  assert.equal(first, second);
  assert.match(first, /A cached explanation\./);
  assert.match(first, /- First point/);
  assert.match(first, /No cached summary yet\./);
  assert.match(first, /Watch on YouTube: https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/);
});

test("empty digest remains useful and deterministic", () => {
  const digest = makeDailyDigest(
    [],
    { window_start: start, window_end: end, limit: 100 },
    generatedAt,
  );
  assert.equal(digest.item_count, 0);
  assert.equal(digest.channel_count, 0);
  assert.equal(digest.truncated, false);
  assert.match(renderDailyDigest(digest), /No uploads in this window\./);
});

test("digest route authenticates, validates before DB work, scopes to session user, and exposes no work trigger", async () => {
  let loads = 0;
  const dependencies = {
    getUser: async () => null,
    loadRows: async () => { loads += 1; return []; },
    now: () => generatedAt,
  };

  const unauthenticated = await handleDailyDigestGet(
    new Request(`https://example.test/api/daily-digest?window_start=${encodeURIComponent(start)}&window_end=${encodeURIComponent(end)}`),
    dependencies,
  );
  assert.equal(unauthenticated.status, 401);
  assert.equal(loads, 0);

  dependencies.getUser = async () => ({ id: "user-a" });
  const invalid = await handleDailyDigestGet(
    new Request("https://example.test/api/daily-digest?window_start=bad&window_end=also-bad"),
    dependencies,
  );
  assert.equal(invalid.status, 400);
  assert.equal(loads, 0);

  dependencies.loadRows = async (userId, query) => {
    loads += 1;
    assert.equal(userId, "user-a");
    assert.deepEqual(query, { window_start: start, window_end: end, limit: 1 });
    return [item("zzzzzzzzzzz"), item("yyyyyyyyyyy")];
  };

  const response = await handleDailyDigestGet(
    new Request(`https://example.test/api/daily-digest?window_start=${encodeURIComponent(start)}&window_end=${encodeURIComponent(end)}&limit=1`),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.digest.generated_at, generatedAt);
  assert.equal(body.digest.item_count, 1);
  assert.equal(body.digest.truncated, true);
  assert.equal(loads, 1);
});

test("digest read failure is bounded and does not leak database detail", async () => {
  const response = await handleDailyDigestGet(
    new Request(`https://example.test/api/daily-digest?window_start=${encodeURIComponent(start)}&window_end=${encodeURIComponent(end)}`),
    {
      getUser: async () => ({ id: "user-a" }),
      loadRows: async () => { throw new Error("service role credential leaked"); },
      now: () => generatedAt,
    },
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: "DIGEST_UNAVAILABLE",
      message: "Your digest is temporarily unavailable. Try again shortly.",
    },
  });
});
