import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdir, rm, writeFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test, { after } from "node:test";
import ts from "typescript";
import { handleDemoFeedGet, parseDemoChannelUids } from "../src/lib/demo-feed-route.ts";

const built = new URL("./.d8-generated/", import.meta.url);
await mkdir(built, { recursive: true });
for (const name of ["account-plan", "feed-screen", "following-screen"]) {
  const source = await readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText.replaceAll("@/lib/feed", "../../src/lib/feed.ts").replaceAll('"next/link"', '"next/link.js"');
  await writeFile(new URL(`${name}.mjs`, built), compiled);
}
const { AccountPlan, EntitlementSummary } = await import("./.d8-generated/account-plan.mjs");
const { FeedScreen, mayAutoRequestSummary } = await import("./.d8-generated/feed-screen.mjs");
const { FollowingScreen, safeFollowingErrorMessage } = await import("./.d8-generated/following-screen.mjs");
after(async () => rm(built, { recursive: true, force: true }));

const channelUid = "youtube-channel:UC0123456789abcdefghijkl";

function item(state = "available") {
  return {
    video: { video_uid: "youtube:abcdefghijk", channel_uid: channelUid, native_video_id: "abcdefghijk", title: "Demo video", canonical_url: "https://youtube.com/watch?v=abcdefghijk", thumbnail_url: null, published_at: "2026-10-05T12:00:00.000Z", duration_seconds: 240, availability: "public", provider_snapshot_id: null },
    channel: { channel_uid: channelUid, title: "Demo Channel", handle: "@demo", canonical_url: "https://youtube.com/@demo", thumbnail_url: null },
    summary: { state, summary_id: state === "available" ? "cached" : null, summary: state === "available" ? "Already cached for product users." : null, key_points: [], language: "en", generated_at: null, retryable: false },
  };
}

test("demo channels come only from bounded server config", () => {
  assert.deepEqual(parseDemoChannelUids(undefined), []);
  assert.deepEqual(parseDemoChannelUids(`${channelUid},bad,${channelUid}`), [channelUid]);
  assert.equal(parseDemoChannelUids(Array.from({ length: 14 }, (_, i) => `youtube-channel:UC${String(i).padStart(22, "0")}`).join(",")).length, 12);
});

test("public demo API performs only a bounded configured global read and ignores visitor-selected channels", async () => {
  let called = null;
  const response = await handleDemoFeedGet(new Request(`https://example.test/api/demo/feed?channel_uid=${channelUid}&limit=50`), {
    channelUids: [channelUid],
    loadRows: async (uids, limit) => { called = { uids, limit }; return [item("available")]; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(called, { uids: [channelUid], limit: 20 });
  assert.equal(response.headers.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].summary.summary, "Already cached for product users.");
});

test("public demo API keeps database/provider failures behind safe copy", async () => {
  const response = await handleDemoFeedGet(new Request("https://example.test/api/demo/feed"), {
    channelUids: [channelUid],
    loadRows: async () => { throw new Error("raw provider secret failure"); },
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /temporarily unavailable/);
  assert.doesNotMatch(body, /raw provider secret failure/);
});

test("read-only demo has no filter, pagination, or summary action and renders cached cards", () => {
  const html = renderToStaticMarkup(React.createElement(FeedScreen, {
    initialPage: { items: [item("available")], next_cursor: "ignored" },
    channels: [], selectedChannelUid: null, initialError: false, filterUnavailable: false, demo: true,
  }));
  assert.match(html, /Demo video/);
  assert.match(html, /Already cached for product users\./);
  assert.doesNotMatch(html, /Show|Load more|Try summary again/);
});

test("anonymous demo cards can never enter the automatic summary request frontier", () => {
  const candidate = item("not_requested");
  assert.equal(mayAutoRequestSummary(true, candidate), false);
  assert.equal(mayAutoRequestSummary(false, candidate), true);
  assert.equal(mayAutoRequestSummary(false, { ...candidate, video: { ...candidate.video, duration_seconds: 30 } }), false);
});

test("Feed component renders each summary state and safe error and empty states", () => {
  const states = ["available", "generating", "not_requested", "short_video", "long_video", "live_or_upcoming", "quota_blocked", "failed"];
  const html = renderToStaticMarkup(React.createElement(FeedScreen, {
    initialPage: { items: states.map((state) => item(state)), next_cursor: null },
    channels: [], selectedChannelUid: null, initialError: false, filterUnavailable: false,
  }));
  for (const copy of ["Summary", "Summarizing…", "No summary yet", "Short clip", "Long video", "Live or upcoming", "Summary allowance reached", "Summary temporarily unavailable"]) assert.match(html, new RegExp(copy));
  const error = renderToStaticMarkup(React.createElement(FeedScreen, {
    initialPage: { items: [], next_cursor: null }, channels: [], selectedChannelUid: null, initialError: true, filterUnavailable: false,
  }));
  assert.match(error, /Your feed is temporarily unavailable/);
});

test("Following renders safe load error and empty state instead of exposing upstream details", () => {
  const html = renderToStaticMarkup(React.createElement(FollowingScreen, { initialItems: [], limit: 30, initialError: true }));
  assert.match(html, /couldn’t be loaded/);
  assert.doesNotMatch(html, /Your feed starts with the people you choose/);
  assert.doesNotMatch(html, /provider|exception/i);
  const actionError = safeFollowingErrorMessage({ error: { code: "PROVIDER_UNAVAILABLE", message: "raw provider exception" } });
  assert.equal(actionError, "YouTube is temporarily unavailable. Try again shortly.");
  assert.doesNotMatch(actionError, /raw provider exception/);
});

test("account plan displays single-plan pricing and the documented entitlement view", () => {
  const price = renderToStaticMarkup(React.createElement(AccountPlan));
  assert.match(price, /\$3\.99\/month/);
  assert.match(price, /600 minutes/);
  assert.match(price, /Choose this plan/);
  const entitlement = renderToStaticMarkup(React.createElement(EntitlementSummary, { entitlement: {
    plan_code: "paid", status: "active", follow_limit: 30, follow_count: 12,
    generation_minutes_limit: 600, generation_minutes_used: 75,
    period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-11-01T00:00:00.000Z",
  } }));
  assert.match(entitlement, /Paid plan/);
  assert.match(entitlement, /Channels: 12 \/ 30/);
  assert.match(entitlement, /75 \/ 600 minutes/);
});

test("responsive implementation declares mobile stack rules and acceptance records manual browser coverage", async () => {
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const acceptance = await readFile(new URL("../docs/acceptance/D8.md", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.feed-card \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 520px\)/);
  assert.match(acceptance, /Browser checks still required[\s\S]*375px/);
});
