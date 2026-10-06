import assert from "node:assert/strict";
import test from "node:test";
import { FakeChannelResolver, FakeUploadFrontierProvider } from "../src/lib/providers/fakes.ts";
import { ProviderError } from "../src/lib/providers/contracts.ts";
import { FollowLifecycleError, followChannel, resolveChannel, unfollowChannel } from "../src/lib/follow-lifecycle.ts";
import { productError } from "../src/lib/api-errors.ts";

const channelId = "UC0123456789abcdefghijkl";
const channel = {
  channel_uid: `youtube-channel:${channelId}`,
  platform: "youtube",
  native_channel_id: channelId,
  handle: "@sample",
  title: "Sample Channel",
  canonical_url: "https://www.youtube.com/@sample",
  thumbnail_url: "https://img.example/channel.jpg",
};

function video(id, channelUid = channel.channel_uid) {
  return {
    video_uid: `youtube:${id}`,
    channel_uid: channelUid,
    native_video_id: id,
    title: `Video ${id}`,
    canonical_url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail_url: "https://img.example/video.jpg",
    published_at: "2026-10-04T12:00:00.000Z",
    duration_seconds: 120,
    availability: "public",
    provider_snapshot_id: `snapshot-${id}`,
  };
}

function repository(limit = 30) {
  const channels = new Map([[channel.channel_uid, { ...channel, monitoring_status: "idle", last_feed_checked_at: null, next_feed_check_at: null }]]);
  const follows = new Map();
  const videos = new Map();
  const calls = { checked: [], upsertedVideos: [] };
  return {
    channels, follows, videos, calls, limit,
    async upsertChannel(value) { channels.set(value.channel_uid, { ...value, monitoring_status: "idle", last_feed_checked_at: null, next_feed_check_at: null }); return channels.get(value.channel_uid); },
    async getChannel(uid) { return channels.get(uid) ?? null; },
    async getMyFollowChannelUids(userId) { return [...(follows.get(userId) ?? new Map()).keys()]; },
    async createFollowWithLimit(userId, uid) {
      const userFollows = follows.get(userId) ?? new Map(); follows.set(userId, userFollows);
      if (userFollows.has(uid)) return { ...userFollows.get(uid), created: false };
      if (userFollows.size >= limit) throw new Error("follow_limit_reached");
      const result = { channel_uid: uid, followed_at: new Date().toISOString() };
      userFollows.set(uid, result); return { ...result, created: true };
    },
    async deleteFollow(userId, uid) { follows.get(userId)?.delete(uid); },
    async upsertVideo(value) { videos.set(value.video_uid, value); calls.upsertedVideos.push(value); },
    async markChannelChecked(uid, status, next) { calls.checked.push({ uid, status, next }); channels.set(uid, { ...channels.get(uid), monitoring_status: status, next_feed_check_at: next }); },
  };
}

function artifactsFor() {
  return {
    ensured: [], summarized: [],
    async ensureVideo(reference) { const id = new URL(reference).searchParams.get("v"); this.ensured.push(id); return video(id); },
    async inspectVideo() { return null; },
    async ensureSummary(uid) { this.summarized.push(uid); throw new Error("summary must not be called"); },
  };
}

function uploads(count) {
  return Array.from({ length: count }, (_, index) => ({ native_video_id: `abcdefghij${String.fromCharCode(107 + index)}`, published_at: "2026-10-04T12:00:00.000Z", title: `Hint ${index}`, url: `https://www.youtube.com/watch?v=abcdefghij${String.fromCharCode(107 + index)}` }));
}

test("resolve returns the canonical preview and never creates a Follow", async () => {
  const repo = repository();
  const resolver = new FakeChannelResolver(channel);
  const result = await resolveChannel("@sample", "user-a", resolver, repo);
  assert.equal(result.channel.title, "Sample Channel");
  assert.equal(result.channel.handle, "@sample");
  assert.equal(result.already_followed, false);
  assert.equal(repo.follows.get("user-a")?.size ?? 0, 0);
});

test("resolve maps invalid, missing, and unavailable channels to safe product errors", async () => {
  const repo = repository();
  for (const [code, productCode] of [["invalid_reference", "invalid_channel"], ["not_found", "channel_not_resolved"], ["unavailable", "provider_unavailable"]]) {
    const resolver = { resolve: async () => { throw new ProviderError(code, "raw upstream detail"); } };
    await assert.rejects(resolveChannel("bad", "user-a", resolver, repo), (error) => error instanceof FollowLifecycleError && error.code === productCode && !error.message.includes("raw"));
  }
});

test("resolver diagnostics survive lifecycle mapping while user copy stays bounded", async () => {
  const repo = repository();
  const resolver = {
    resolve: async () => {
      throw new ProviderError("unavailable", "YouTube is temporarily unavailable", {
        diagnosticCode: "youtube_key_restricted",
        upstreamStatus: 403,
      });
    },
  };
  await assert.rejects(resolveChannel("@sample", "user-a", resolver, repo), (error) => {
    assert.ok(error instanceof FollowLifecycleError);
    assert.equal(error.code, "provider_unavailable");
    assert.equal(error.providerDiagnosticCode, "youtube_key_restricted");
    assert.equal(error.providerStatus, 403);
    assert.equal(error.message, "YouTube is temporarily unavailable. Try again shortly.");
    assert.doesNotMatch(error.message, /restricted|403/i);
    return true;
  });
});

test("browser-visible errors omit internal provider diagnostics", () => {
  const mapped = productError(new FollowLifecycleError(
    "provider_unavailable",
    "YouTube is temporarily unavailable. Try again shortly.",
    { diagnosticCode: "youtube_key_restricted", upstreamStatus: 403 },
  ));
  assert.equal(mapped.status, 503);
  assert.deepEqual(mapped.body, {
    error: {
      code: "PROVIDER_UNAVAILABLE",
      message: "YouTube is temporarily unavailable. Try again shortly.",
    },
  });
  assert.doesNotMatch(JSON.stringify(mapped.body), /youtube_key_restricted|403/);
});

test("first follow backfills at most ten canonical videos and never summaries", async () => {
  const repo = repository();
  const frontier = new FakeUploadFrontierProvider(uploads(12));
  const artifacts = artifactsFor();
  const result = await followChannel("user-a", channel.channel_uid, () => frontier, () => artifacts, repo);
  assert.equal(result.backfill, "complete");
  assert.equal(frontier.listed[0].limit, 10);
  assert.equal(artifacts.ensured.length, 10);
  assert.equal(repo.calls.upsertedVideos.length, 10);
  assert.deepEqual(artifacts.summarized, []);
});

test("a second user reuses the global channel and fresh frontier", async () => {
  const repo = repository();
  const frontier = new FakeUploadFrontierProvider(uploads(2));
  const artifacts = artifactsFor();
  await followChannel("user-a", channel.channel_uid, () => frontier, () => artifacts, repo);
  const before = artifacts.ensured.length;
  const second = await followChannel("user-b", channel.channel_uid, () => frontier, () => artifacts, repo);
  assert.equal(second.backfill, "not_needed");
  assert.equal(repo.channels.size, 1);
  assert.equal(repo.follows.size, 2);
  assert.equal(artifacts.ensured.length, before);
});

test("limit rejection creates no relationship and makes no provider calls", async () => {
  const repo = repository(0);
  const frontier = new FakeUploadFrontierProvider(uploads(2));
  const artifacts = artifactsFor();
  await assert.rejects(followChannel("user-a", channel.channel_uid, () => { throw new Error("provider construction must not run"); }, () => { throw new Error("provider construction must not run"); }, repo), (error) => error instanceof FollowLifecycleError && error.code === "follow_limit_reached");
  assert.equal(frontier.listed.length, 0);
  assert.equal(artifacts.ensured.length, 0);
  assert.equal(repo.follows.get("user-a")?.size ?? 0, 0);
});

test("partial backfill remains a successful follow with bounded product state", async () => {
  const repo = repository();
  const frontier = new FakeUploadFrontierProvider();
  frontier.listRecentUploads = async () => { throw new Error("private upstream detail"); };
  const result = await followChannel("user-a", channel.channel_uid, () => frontier, artifactsFor, repo);
  assert.equal(result.backfill, "partial");
  assert.ok(repo.follows.get("user-a").has(channel.channel_uid));
  assert.equal(repo.calls.checked[0].status, "error");
});

test("unfollow removes only the authenticated user's relationship and supports Undo", async () => {
  const repo = repository();
  const frontier = new FakeUploadFrontierProvider([]);
  await followChannel("user-a", channel.channel_uid, () => frontier, artifactsFor, repo);
  await followChannel("user-b", channel.channel_uid, () => frontier, artifactsFor, repo);
  await unfollowChannel("user-a", channel.channel_uid, repo);
  assert.equal(repo.follows.get("user-a").has(channel.channel_uid), false);
  assert.equal(repo.follows.get("user-b").has(channel.channel_uid), true);
  const restored = await followChannel("user-a", channel.channel_uid, () => frontier, artifactsFor, repo);
  assert.equal(restored.backfill, "not_needed");
  assert.equal(repo.channels.size, 1);
});
