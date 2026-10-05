import assert from "node:assert/strict";
import test from "node:test";
import { handleSummaryPost } from "../src/lib/summary-generation.ts";

const video = {
  video_uid: "youtube:abcdefghijk", duration_seconds: 121, availability: "public", live_status: "completed",
};
const request = new Request("https://example.test/api/videos/youtube%3Aabcdefghijk/summary", { method: "POST" });

function dependencies(overrides = {}) {
  const calls = { provider: 0, complete: 0, fail: 0, claim: null };
  return {
    calls,
    getUser: async () => ({ id: "user-a" }),
    loadVideo: async (uid) => uid === video.video_uid ? video : null,
    claim: async (input) => { calls.claim = input; return { state: "claimed" }; },
    ensureSummary: async () => {
      calls.provider += 1;
      return { summary: { state: "available", summary_id: "summary-1", summary: "Useful summary.", key_points: ["Point"], language: "en", generated_at: "2026-10-05T00:00:00Z", retryable: false }, provider: "Media Monitor", model: "test" };
    },
    complete: async () => { calls.complete += 1; return true; },
    fail: async () => { calls.fail += 1; return true; },
    ...overrides,
  };
}

test("summary route authenticates before reads and has no anonymous provider path", async () => {
  const deps = dependencies({ getUser: async () => null });
  const response = await handleSummaryPost(request, video.video_uid, deps);
  assert.equal(response.status, 401);
  assert.equal(deps.calls.provider, 0);
});

test("summary route derives the key and charge server-side and commits only valid provider output", async () => {
  const deps = dependencies();
  const response = await handleSummaryPost(request, video.video_uid, deps);
  assert.equal(response.status, 200);
  assert.equal(deps.calls.provider, 1);
  assert.equal(deps.calls.complete, 1);
  assert.equal(deps.calls.claim.chargedMinutes, 3);
  assert.match(deps.calls.claim.summaryKey, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual((await response.json()).summary, {
    state: "available", summary_id: "summary-1", summary: "Useful summary.", key_points: ["Point"],
    language: "en", generated_at: "2026-10-05T00:00:00Z", retryable: false,
  });
});

test("cache, concurrent claims, quota, and ineligible videos do not call the provider", async () => {
  for (const state of ["available", "generating", "quota_blocked", "short_video", "long_video", "live_or_upcoming"]) {
    const deps = dependencies({ claim: async () => state === "available"
      ? { state, summary: { state, summary_id: "cached", summary_text: "Cached", key_points: ["Point"], language: "en", generated_at: "2026-10-01T00:00:00Z" } }
      : ({ state }) });
    const response = await handleSummaryPost(request, video.video_uid, deps);
    assert.equal(deps.calls.provider, 0, state);
    assert.equal((await response.json()).summary.state, state);
    if (state === "generating") assert.equal(response.status, 202);
  }
});

test("provider failure produces bounded failed state and never completes or charges", async () => {
  const deps = dependencies({ ensureSummary: async () => { throw new Error("private provider exception"); } });
  const response = await handleSummaryPost(request, video.video_uid, deps);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).summary, {
    state: "failed", summary_id: null, summary: null, key_points: [], language: null, generated_at: null, retryable: true,
  });
  assert.equal(deps.calls.complete, 0);
  assert.equal(deps.calls.fail, 1);
});
