import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
} from "../src/lib/providers/contracts.ts";
import {
  parseYouTubeUploadFeed,
  YouTubeChannelDiscoveryProvider,
} from "../src/lib/providers/youtube-channel-discovery.ts";
import {
  cloudRunIdentityToken,
  FakeVideoArtifactProvider,
  MediaMonitorVideoArtifactProvider,
} from "../src/lib/providers/media-monitor-video-artifacts.ts";
import { FakeChannelDiscoveryProvider } from "../src/lib/providers/fakes.ts";

const channelId = "UC0123456789abcdefghijkl";
const videoId = "abcdefghijk";
const sidecarPaths = { ensure: "/ensure", inspect: "/inspect", summary: "/summary" };
const channel = {
  channel_uid: `youtube-channel:${channelId}`,
  platform: "youtube",
  native_channel_id: channelId,
  handle: "@sample",
  title: "Sample & Channel",
  canonical_url: "https://www.youtube.com/@sample",
  thumbnail_url: "https://i.ytimg.com/channel.jpg",
};

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("channel references accept canonical channel IDs, ID URLs, handles and handle URLs", async () => {
  const calls = [];
  const provider = new YouTubeChannelDiscoveryProvider("secret-api-key", async (url) => {
    calls.push(String(url));
    return response({ items: [{ id: channelId, snippet: { title: " Sample ", customUrl: "sample", thumbnails: { high: { url: "https://img.example/channel.jpg" } } } }] });
  });

  const fromHandle = await provider.resolve("@sample");
  assert.equal(fromHandle.channel_uid, `youtube-channel:${channelId}`);
  assert.equal(fromHandle.handle, "@sample");
  assert.equal(fromHandle.title, "Sample");
  assert.equal(fromHandle.canonical_url, "https://www.youtube.com/@sample");
  assert.equal(fromHandle.thumbnail_url, "https://img.example/channel.jpg");
  assert.equal(new URL(calls[0]).searchParams.get("forHandle"), "sample");

  await provider.resolve(`https://www.youtube.com/channel/${channelId}`);
  assert.equal(new URL(calls[1]).searchParams.get("id"), channelId);
  await provider.resolve(`https://youtube.com/@sample`);
  assert.equal(new URL(calls[2]).searchParams.get("forHandle"), "sample");
});

test("channel resolver rejects malformed and foreign references before network access", async () => {
  let calls = 0;
  const provider = new YouTubeChannelDiscoveryProvider("secret", async () => { calls += 1; return response({}); });
  for (const input of ["sample", "http://youtube.com/@sample", "https://youtube.com/@sample/videos", "https://evil.example/@sample"]) {
    await assert.rejects(provider.resolve(input), (error) => error instanceof ProviderError && error.code === "invalid_reference");
  }
  assert.equal(calls, 0);
});

test("resolver maps upstream errors to bounded product errors and omits API key from output", async () => {
  let requestedUrl = "";
  const provider = new YouTubeChannelDiscoveryProvider("server-secret-key", async (url) => {
    requestedUrl = String(url);
    return response({ error: { message: "sensitive upstream detail" } }, 403);
  });
  await assert.rejects(provider.resolve("@sample"), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.code, "unavailable");
    assert.equal(error.message, "YouTube is temporarily unavailable");
    assert.equal(error.message.includes("sensitive"), false);
    return true;
  });
  assert.equal(new URL(requestedUrl).searchParams.get("key"), "server-secret-key");
});

test("public upload parser normalizes Atom/RSS dates, decodes text, deduplicates, and bounds output", () => {
  const xml = `<?xml version="1.0"?><feed>
    <entry><yt:videoId>${videoId}</yt:videoId><published>2026-10-04T12:00:00+00:00</published><title>A &amp; B</title></entry>
    <entry><yt:videoId>${videoId}</yt:videoId><published>2026-10-04T12:00:00Z</published><title>Duplicate</title></entry>
    <entry><yt:videoId>bad</yt:videoId><published>not-a-date</published></entry>
    <entry><yt:videoId>ZYXWVUTSRQP</yt:videoId><published>2026-10-03T00:00:00Z</published><title><![CDATA[Latest]]></title></entry>
  </feed>`;
  const result = parseYouTubeUploadFeed(xml, 10);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    native_video_id: videoId,
    published_at: "2026-10-04T12:00:00.000Z",
    title: "A & B",
    url: `https://www.youtube.com/watch?v=${videoId}`,
  });
  assert.equal(result[1].title, "Latest");
  assert.equal(parseYouTubeUploadFeed(xml, 1).length, 1);
  assert.equal(parseYouTubeUploadFeed(xml, 1000).length, 2);
});

test("feed fetch rejects oversized or malformed responses and maps timeout/upstream failures", async () => {
  const providerFor = (fetcher) => new YouTubeChannelDiscoveryProvider("key", fetcher);
  const args = [channel, 10];
  await assert.rejects(providerFor(async () => response("<html>no feed</html>")).listRecentUploads(...args), (error) => error.code === "invalid_response");
  await assert.rejects(providerFor(async () => response("<feed />", 200, { "content-length": "1000001" })).listRecentUploads(...args), (error) => error.code === "invalid_response");
  await assert.rejects(providerFor(async () => response("upstream secret", 503)).listRecentUploads(...args), (error) => error.code === "unavailable" && !error.message.includes("secret"));
  await assert.rejects(providerFor(async () => { throw new Error("network details"); }).listRecentUploads(...args), (error) => error.code === "unavailable" && !error.message.includes("details"));
});

test("fake discovery provider returns test data without any external call", async () => {
  const upload = { native_video_id: videoId, published_at: "2026-10-04T12:00:00.000Z", title: "Example", url: `https://www.youtube.com/watch?v=${videoId}` };
  const fake = new FakeChannelDiscoveryProvider(channel, [upload]);
  assert.deepEqual(await fake.resolve("@sample"), channel);
  assert.deepEqual(await fake.listRecentUploads(channel, 1), [upload]);
  assert.deepEqual(fake.resolved, ["@sample"]);
  assert.equal(fake.listed[0].limit, 1);
});

test("Cloud Run token helper requests only a short-lived audience token from metadata", async () => {
  let requested;
  const token = await cloudRunIdentityToken("https://sidecar-xyz.run.app", async (url, options) => {
    requested = { url: new URL(String(url)), options };
    return new Response("header.payload.signature");
  });
  assert.equal(token, "header.payload.signature");
  assert.equal(requested.url.searchParams.get("audience"), "https://sidecar-xyz.run.app");
  assert.equal(requested.url.searchParams.get("format"), "full");
  assert.equal(requested.options.headers["Metadata-Flavor"], "Google");
});

test("Media Monitor adapter authenticates service call and translates sidecar payloads to product contracts", async () => {
  const calls = [];
  const provider = new MediaMonitorVideoArtifactProvider(
    "https://sidecar-xyz.run.app",
    async (audience) => { assert.equal(audience, "https://sidecar-xyz.run.app"); return "signed.id.token"; },
    async (url, options) => {
      calls.push({ url: new URL(String(url)), options });
      if (String(url).endsWith("/ensure")) return response({
        video_id: videoId,
        canonical_url: `https://www.youtube.com/watch?v=${videoId}`,
        channel: { native_channel_id: channelId, display_name: "Sample & Channel" },
        metadata: { title: "Video", published_at: "2026-10-01T12:00:00Z", duration_seconds: 95, availability: "public", liveBroadcastContent: "upcoming", snapshot_id: "snapshot-1", thumbnail_url: "https://img.example/video.jpg" },
        summary: { state: "not_attempted", summary_id: null, summary: null, key_points: [], provider: null, model: null },
        internal_trace: "must-not-escape",
      });
      if (String(url).endsWith("/inspect")) return response({ video_id: videoId, channel: { native_channel_id: channelId }, metadata: { title: "Video", published_at: "2026-10-01T12:00:00Z" } });
      return response({ summary: { state: "available", summary_id: "s-1", summary: "A compact summary.", key_points: ["One point", 4, "Two point"], provider: "private-provider", model: "private-model", language: "en", generated_at: "2026-10-04T12:00:00Z" }, private_field: "must-not-escape" });
    },
    { audience: "https://sidecar-xyz.run.app", paths: sidecarPaths },
  );
  const video = await provider.ensureVideo(`https://www.youtube.com/watch?v=${videoId}`);
  assert.deepEqual(Object.keys(video).sort(), ["availability", "canonical_url", "channel_uid", "duration_seconds", "live_status", "native_video_id", "published_at", "provider_snapshot_id", "thumbnail_url", "title", "video_uid"].sort());
  assert.equal(video.video_uid, `youtube:${videoId}`);
  assert.equal(video.channel_uid, `youtube-channel:${channelId}`);
  assert.equal(video.provider_snapshot_id, "snapshot-1");
  assert.equal(video.live_status, "upcoming");
  assert.equal(await provider.inspectVideo(video.video_uid).then((result) => result.title), "Video");
  const summary = await provider.ensureSummary(video.video_uid);
  assert.deepEqual(summary.summary.key_points, ["One point", "Two point"]);
  assert.equal(summary.provider, "private-provider");
  assert.equal(summary.model, "private-model");
  assert.deepEqual(Object.keys(summary.summary).sort(), ["generated_at", "key_points", "language", "retryable", "state", "summary", "summary_id"].sort());
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.headers.authorization, "Bearer signed.id.token");
  assert.deepEqual(JSON.parse(calls[0].options.body), { video_id: videoId });
  assert.equal(calls[0].url.origin, "https://sidecar-xyz.run.app");
});

test("Media Monitor adapter returns null for absent inspect result and hides provider errors", async () => {
  const provider = new MediaMonitorVideoArtifactProvider(
    "https://sidecar-xyz.run.app",
    async () => "signed.id.token",
    async (url) => String(url).endsWith("/inspect") ? response("", 404) : response({ error: "sensitive" }, 500),
    { paths: sidecarPaths },
  );
  assert.equal(await provider.inspectVideo(`youtube:${videoId}`), null);
  await assert.rejects(provider.ensureVideo(videoId), (error) => error.code === "unavailable" && !error.message.includes("sensitive"));
  assert.throws(() => new MediaMonitorVideoArtifactProvider("http://localhost:8080", async () => "token", fetch, { paths: sidecarPaths }), /HTTPS/);
});

test("fake artifact provider implements the product seam", async () => {
  const video = { video_uid: `youtube:${videoId}`, channel_uid: channel.channel_uid, native_video_id: videoId, title: "Video", canonical_url: `https://www.youtube.com/watch?v=${videoId}`, thumbnail_url: null, published_at: "2026-10-01T12:00:00.000Z", duration_seconds: null, availability: "unknown", provider_snapshot_id: null };
  const result = { summary: { state: "not_requested", summary_id: null, summary: null, key_points: [], language: null, generated_at: null, retryable: null }, provider: null, model: null };
  const fake = new FakeVideoArtifactProvider(video, result);
  assert.equal(await fake.ensureVideo(videoId), video);
  assert.equal(await fake.inspectVideo(video.video_uid), video);
  assert.equal(await fake.inspectVideo("youtube:ZYXWVUTSRQP"), null);
  assert.equal(await fake.ensureSummary(video.video_uid), result);
  assert.deepEqual(fake.ensured, [videoId]);
  assert.deepEqual(fake.inspected, [video.video_uid, "youtube:ZYXWVUTSRQP"]);
  assert.deepEqual(fake.summarized, [video.video_uid]);
});
