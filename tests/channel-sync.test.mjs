import assert from "node:assert/strict";
import test from "node:test";

import {
  CHANNEL_SYNC_CONCURRENCY,
  runChannelSync,
} from "../src/lib/channel-sync.ts";

const channelA = {
  channel_uid: "youtube-channel:UC0123456789abcdefghijkl",
  platform: "youtube",
  native_channel_id: "UC0123456789abcdefghijkl",
  handle: "@a",
  title: "A",
  canonical_url: "https://youtube.com/@a",
  thumbnail_url: null,
  monitoring_status: "idle",
  last_feed_checked_at: null,
  next_feed_check_at: null,
  sync_claim_until: null,
};

const channelB = {
  ...channelA,
  channel_uid: "youtube-channel:UCabcdefghijkl0123456789",
  native_channel_id: "UCabcdefghijkl0123456789",
  handle: "@b",
  title: "B",
  canonical_url: "https://youtube.com/@b",
};

function video(id, channelUid = channelA.channel_uid) {
  return {
    video_uid: `youtube:${id}`,
    channel_uid: channelUid,
    native_video_id: id,
    title: `Video ${id}`,
    canonical_url: `https://youtube.com/watch?v=${id}`,
    thumbnail_url: null,
    published_at: "2026-10-06T12:00:00.000Z",
    duration_seconds: 120,
    availability: "public",
    provider_snapshot_id: `snapshot-${id}`,
  };
}

function repository(channels = [channelA]) {
  const existing = new Set(["known000000"]);
  const calls = { upserted: [], marked: [], claimed: [] };
  return {
    calls,
    existing,
    async claimDueChannels(limit, leaseSeconds) {
      calls.claimed.push({ limit, leaseSeconds });
      return channels.slice(0, limit);
    },
    async listExistingNativeVideoIds(ids) {
      return new Set(ids.filter((id) => existing.has(id)));
    },
    async upsertVideo(value) {
      calls.upserted.push(value);
      existing.add(value.native_video_id);
    },
    async markChannelSyncResult(channelUid, status, checkedAt, nextCheck) {
      calls.marked.push({ channelUid, status, checkedAt, nextCheck });
    },
    async countDueChannels() { return 0; },
  };
}

test("D6 ensures only unseen uploads, projects them globally, and never requests summaries", async () => {
  const repo = repository();
  const summarized = [];
  const ensured = [];
  const frontier = {
    async listRecentUploads(channel, limit) {
      assert.equal(channel.channel_uid, channelA.channel_uid);
      assert.equal(limit, 15);
      return [
        { native_video_id: "known000000", published_at: "2026-10-06T10:00:00Z", title: "Known", url: "https://youtube.com/watch?v=known000000" },
        { native_video_id: "fresh000000", published_at: "2026-10-06T11:00:00Z", title: "Fresh", url: "https://youtube.com/watch?v=fresh000000" },
      ];
    },
  };
  const artifacts = {
    async ensureVideo(reference) {
      ensured.push(reference);
      return video(new URL(reference).searchParams.get("v"));
    },
    async inspectVideo() { return null; },
    async ensureSummary(uid) { summarized.push(uid); throw new Error("must not summarize"); },
  };

  const result = await runChannelSync(repo, frontier, artifacts, {
    now: () => new Date("2026-10-06T12:00:00Z"),
    random: () => 0,
  });

  assert.equal(result.claimed, 1);
  assert.equal(result.checked, 1);
  assert.equal(result.new_videos, 1);
  assert.equal(result.canonicalized, 1);
  assert.equal(result.failures, 0);
  assert.deepEqual(ensured, ["https://youtube.com/watch?v=fresh000000"]);
  assert.deepEqual(summarized, []);
  assert.equal(repo.calls.upserted.length, 1);
  assert.equal(repo.calls.marked[0].status, "active");
  assert.equal(repo.calls.marked[0].nextCheck, "2026-10-06T13:00:00.000Z");
});

test("D6 isolates a failing channel and records a bounded retry without aborting others", async () => {
  const repo = repository([channelA, channelB]);
  const frontier = {
    async listRecentUploads(channel) {
      if (channel.channel_uid === channelB.channel_uid) throw new Error("private upstream detail");
      return [{ native_video_id: "fresh000000", published_at: "2026-10-06T11:00:00Z", title: null, url: "https://youtube.com/watch?v=fresh000000" }];
    },
  };
  const artifacts = {
    async ensureVideo(reference) {
      return video(new URL(reference).searchParams.get("v"));
    },
    async inspectVideo() { return null; },
    async ensureSummary() { throw new Error("must not summarize"); },
  };

  const result = await runChannelSync(repo, frontier, artifacts, {
    now: () => new Date("2026-10-06T12:00:00Z"),
    random: () => 0,
  });

  assert.equal(result.claimed, 2);
  assert.equal(result.checked, 1);
  assert.equal(result.failures, 1);
  assert.deepEqual(result.items[1].failure_kinds, ["frontier_fetch_failed"]);
  const failedMark = repo.calls.marked.find((item) => item.channelUid === channelB.channel_uid);
  assert.equal(failedMark.status, "error");
  assert.equal(failedMark.nextCheck, "2026-10-06T12:05:00.000Z");
});

test("D6 rejects a Media Monitor channel mismatch and does not project that video", async () => {
  const repo = repository();
  const frontier = {
    async listRecentUploads() {
      return [{ native_video_id: "fresh000000", published_at: "2026-10-06T11:00:00Z", title: null, url: "https://youtube.com/watch?v=fresh000000" }];
    },
  };
  const artifacts = {
    async ensureVideo() { return video("fresh000000", channelB.channel_uid); },
    async inspectVideo() { return null; },
    async ensureSummary() { throw new Error("must not summarize"); },
  };

  const result = await runChannelSync(repo, frontier, artifacts, {
    now: () => new Date("2026-10-06T12:00:00Z"),
    random: () => 0,
  });

  assert.equal(result.canonicalized, 0);
  assert.deepEqual(result.items[0].failure_kinds, ["artifact_channel_mismatch"]);
  assert.equal(repo.calls.upserted.length, 0);
  assert.equal(repo.calls.marked[0].status, "error");
});

test("D6 bounds simultaneous frontier reads", async () => {
  const channels = Array.from({ length: 8 }, (_, index) => ({
    ...channelA,
    channel_uid: `youtube-channel:UC${String(index).padStart(22, "0")}`,
    native_channel_id: `UC${String(index).padStart(22, "0")}`,
  }));
  const repo = repository(channels);
  let active = 0;
  let maximum = 0;
  const frontier = {
    async listRecentUploads() {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [];
    },
  };
  const artifacts = {
    async ensureVideo() { throw new Error("no videos"); },
    async inspectVideo() { return null; },
    async ensureSummary() { throw new Error("must not summarize"); },
  };

  await runChannelSync(repo, frontier, artifacts, {
    concurrency: CHANNEL_SYNC_CONCURRENCY,
    random: () => 0,
  });
  assert.ok(maximum <= CHANNEL_SYNC_CONCURRENCY);
  assert.ok(maximum > 1);
});

test("D6 validates run bounds before claiming work", async () => {
  const repo = repository();
  const frontier = { async listRecentUploads() { return []; } };
  const artifacts = {
    async ensureVideo() { throw new Error("not called"); },
    async inspectVideo() { return null; },
    async ensureSummary() { throw new Error("not called"); },
  };
  await assert.rejects(runChannelSync(repo, frontier, artifacts, { limit: 26 }), /between 1 and 25/);
  await assert.rejects(runChannelSync(repo, frontier, artifacts, { concurrency: 6 }), /between 1 and 5/);
  assert.equal(repo.calls.claimed.length, 0);
});
