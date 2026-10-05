"use client";

/* YouTube thumbnails use provider-hosted URLs; keeping img avoids an open remote-image allowlist. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ChannelRecord } from "@/lib/db";
import { summaryStateLabel, type FeedItem, type FeedPage } from "@/lib/feed";

type Props = {
  initialPage: FeedPage;
  channels: ChannelRecord[];
  selectedChannelUid: string | null;
  initialError: boolean;
  filterUnavailable: boolean;
  demo?: boolean;
};

function durationLabel(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function publishedLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Publication date unavailable";
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

function availabilityLabel(value: FeedItem["video"]["availability"]): string | null {
  if (value === "public") return null;
  if (value === "private") return "Private video";
  if (value === "unavailable") return "Video unavailable";
  return "Availability unknown";
}

export function mayAutoRequestSummary(demo: boolean, item: FeedItem): boolean {
  return !demo
    && item.summary.state === "not_requested"
    && item.video.live_status !== "live"
    && item.video.live_status !== "upcoming"
    && item.video.availability === "public"
    && (item.video.duration_seconds === null || item.video.duration_seconds >= 90 && item.video.duration_seconds <= 7200);
}

function FeedCard({ item, onRetry }: { item: FeedItem; onRetry: (videoUid: string) => void }) {
  const duration = durationLabel(item.video.duration_seconds);
  const availability = availabilityLabel(item.video.availability);
  return <article className="feed-card">
    {item.video.thumbnail_url
      ? <img className="feed-card__thumbnail" src={item.video.thumbnail_url} alt="" />
      : <div className="feed-card__thumbnail feed-card__thumbnail--empty" aria-hidden="true">No thumbnail</div>}
    <div className="feed-card__body">
      <p className="feed-card__metadata">
        <a href={item.channel.canonical_url} target="_blank" rel="noreferrer">{item.channel.title}</a>
        <span aria-hidden="true"> · </span>
        <time dateTime={item.video.published_at}>{publishedLabel(item.video.published_at)}</time>
        {duration ? <><span aria-hidden="true"> · </span><span>{duration}</span></> : null}
      </p>
      <h2 className="feed-card__title">{item.video.title}</h2>
      {availability ? <p className="feed-card__availability">{availability}</p> : null}
      <section className="feed-card__summary" aria-label="Summary status">
        <h3>{summaryStateLabel(item.summary.state)}</h3>
        {item.summary.state === "available" && item.summary.summary
          ? <p>{item.summary.summary}</p>
          : null}
        {item.summary.state === "available" && item.summary.key_points.length > 0
          ? <ul>{item.summary.key_points.slice(0, 3).map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
          : null}
        {item.summary.state === "failed" && item.summary.retryable
          ? <button type="button" onClick={() => onRetry(item.video.video_uid)}>Try summary again</button>
          : null}
      </section>
      <a className="feed-card__watch" href={item.video.canonical_url} target="_blank" rel="noreferrer">
        Watch on YouTube <span aria-hidden="true">↗</span>
      </a>
    </div>
  </article>;
}

export function FeedScreen({ initialPage, channels, selectedChannelUid, initialError, filterUnavailable, demo = false }: Props) {
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.next_cursor);
  const [error, setError] = useState(initialError
    ? "Your feed is temporarily unavailable. Try again shortly."
    : filterUnavailable ? "That channel isn’t in your follows." : null);
  const [loading, setLoading] = useState(false);
  const activeSummaryRequests = useRef(new Set<string>());
  const [summaryError, setSummaryError] = useState<string | null>(null);

  async function requestSummary(videoUid: string) {
    if (activeSummaryRequests.current.size >= 2 || activeSummaryRequests.current.has(videoUid)) return;
    activeSummaryRequests.current.add(videoUid);
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoUid)}/summary`, { method: "POST", cache: "no-store" });
      const payload = await response.json() as { summary?: FeedItem["summary"] };
      if (!response.ok || !payload.summary) throw new Error("Summary is temporarily unavailable.");
      setItems((current) => current.map((item) => item.video.video_uid === videoUid
        && JSON.stringify(item.summary) !== JSON.stringify(payload.summary)
        ? { ...item, summary: payload.summary! } : item));
    } catch {
      setSummaryError("A summary couldn’t be loaded. Your feed is still available.");
    } finally {
      activeSummaryRequests.current.delete(videoUid);
      setItems((current) => [...current]);
    }
  }

  useEffect(() => {
    if (demo) return;
    const candidates = items.filter((item) => mayAutoRequestSummary(demo, item));
    let scheduled = 0;
    for (const item of candidates) {
      if (scheduled >= 2) break;
      const uid = item.video.video_uid;
      if (activeSummaryRequests.current.has(uid)) continue;
      scheduled += 1;
      window.setTimeout(() => { void requestSummary(uid); }, 0);
    }
  }, [demo, items]);

  useEffect(() => {
    if (demo) return;
    const generating = items.filter((item) => item.summary.state === "generating");
    if (generating.length === 0) return;
    const poll = window.setInterval(() => {
      for (const item of generating) {
        if (activeSummaryRequests.current.size >= 2) break;
        void requestSummary(item.video.video_uid);
      }
    }, 4000);
    return () => window.clearInterval(poll);
  }, [demo, items]);

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cursor: nextCursor, limit: "20" });
    if (selectedChannelUid) params.set("channel_uid", selectedChannelUid);
    try {
      const response = await fetch(`/api/feed?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as FeedPage | { error?: { message?: string } };
      if (!response.ok || !("items" in payload) || !Array.isArray(payload.items)) {
        throw new Error("Your feed is temporarily unavailable. Try again shortly.");
      }
      const newItems = payload.items as FeedItem[];
      setItems((current) => {
        const known = new Set(current.map((item) => item.video.video_uid));
        return [...current, ...newItems.filter((item) => !known.has(item.video.video_uid))];
      });
      setNextCursor(typeof payload.next_cursor === "string" ? payload.next_cursor : null);
    } catch {
      setError("Your feed is temporarily unavailable. Try again shortly.");
    } finally {
      setLoading(false);
    }
  }

  async function retrySummary(videoUid: string) {
    await requestSummary(videoUid);
  }

  return <section className="feed-screen" aria-labelledby="feed-heading">
    <div className="feed-heading-row">
      <div><p className="placeholder__label">Feed</p><h1 id="feed-heading">Following</h1></div>
      {!demo ? <form className="feed-filter" method="get" action="/">
        <label htmlFor="feed-channel-filter">Show</label>
        <select id="feed-channel-filter" name="channel_uid" defaultValue={selectedChannelUid ?? ""}>
          <option value="">All channels</option>
          {channels.map((channel) => <option key={channel.channel_uid} value={channel.channel_uid}>{channel.title}</option>)}
        </select>
        <button type="submit">Filter</button>
      </form> : null}
    </div>

    {error ? <p role="alert" className="feed-error">{error}</p> : null}
    {summaryError ? <p role="status" className="feed-error">{summaryError}</p> : null}

    {items.length > 0 ? <div className="feed-list">{items.map((item) => <FeedCard key={item.video.video_uid} item={item} onRetry={retrySummary} />)}</div>
      : error
        ? <div className="feed-empty">
          <h2>{filterUnavailable ? error : "We couldn’t load your feed."}</h2>
          <p>{filterUnavailable ? "Choose one of your followed channels or clear the filter." : "Please try again shortly."}</p>
          {initialError ? <button type="button" onClick={() => window.location.reload()}>Try again</button> : null}
          {filterUnavailable ? <Link href="/">View all channels</Link> : null}
        </div>
        : demo
        ? <div className="feed-empty">
          <h2>No demo videos are available yet.</h2>
          <p>Check back later, or sign in to build a feed from the channels you choose.</p>
          <Link href="/login">Sign in</Link>
        </div>
        : channels.length === 0
        ? <div className="feed-empty">
          <h2>Your feed starts with the people you choose.</h2>
          <p>Follow a YouTube channel and its latest videos will appear here.</p>
          <Link className="feed-empty__action" href="/following">Follow a channel</Link>
        </div>
        : <div className="feed-empty">
          <h2>{selectedChannelUid ? "No videos from this channel yet." : "Nothing new from your channels yet."}</h2>
          <p>The latest available video metadata will appear here.</p>
          {selectedChannelUid ? <Link href="/">View all channels</Link> : null}
        </div>}

    {!demo && nextCursor ? <div className="feed-pagination">
      <button type="button" onClick={loadMore} disabled={loading}>{loading ? "Loading…" : error ? "Try again" : "Load more"}</button>
    </div> : null}
  </section>;
}
