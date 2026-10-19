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
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
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
    && (item.video.duration_seconds === null || item.video.duration_seconds <= 0
      || item.video.duration_seconds >= 30 && item.video.duration_seconds <= 7200);
}

export function shouldAutoRequestSelectedSummary(
  demo: boolean,
  selectedItem: FeedItem | null,
  attempted: ReadonlySet<string>,
): boolean {
  return selectedItem !== null
    && mayAutoRequestSummary(demo, selectedItem)
    && !attempted.has(selectedItem.video.video_uid);
}

function FeedCard({ item, onSelect, selected, preparing }: {
  item: FeedItem;
  onSelect: (videoUid: string) => void;
  selected: boolean;
  preparing: boolean;
}) {
  const duration = durationLabel(item.video.duration_seconds);
  const availability = availabilityLabel(item.video.availability);
  return <article className={`feed-card${selected ? " feed-card--selected" : ""}`}>
    <img className="feed-card__thumbnail"
      src={item.video.thumbnail_url ?? `https://i.ytimg.com/vi/${item.video.native_video_id}/hqdefault.jpg`}
      alt="" loading="lazy" />
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
        <h3>{preparing ? "Preparing summary…" : summaryStateLabel(item.summary.state)}</h3>
        {item.summary.state === "available" && item.summary.summary
          ? <>
            <p className="feed-card__summary-preview">{item.summary.summary}</p>
            {item.summary.key_points.length > 0
              ? <ul className="feed-card__key-points">{item.summary.key_points.slice(0, 2).map(
                (point, index) => <li key={index}>{point}</li>)}</ul> : null}
          </> : null}
      </section>
      <div className="feed-card__actions">
        <button className="feed-card__open" type="button"
          aria-pressed={selected}
          onClick={() => onSelect(item.video.video_uid)}>{preparing ? "Preparing…" : item.summary.state === "short_video" ? "Video details" : item.summary.state === "available" ? "Read summary" : "Summarize video"} <span aria-hidden="true">→</span></button>
        <a className="feed-card__watch" href={item.video.canonical_url} target="_blank" rel="noreferrer">
          YouTube <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </article>;
}

function VideoSidecar({ item, demo, onClose, onRetry, canRetry, preparing }: {
  item: FeedItem | null;
  demo: boolean;
  onClose: () => void;
  onRetry: (videoUid: string) => void;
  canRetry: boolean;
  preparing: boolean;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const itemUid = item?.video.video_uid;
  useEffect(() => {
    if (itemUid && window.matchMedia("(max-width: 900px)").matches) closeButton.current?.focus();
  }, [itemUid]);

  return <aside className={`video-sidecar${item ? " video-sidecar--open" : ""}`}
    aria-label="Selected video summary" aria-live="polite">
    {item ? <>
      <div className="video-sidecar__header">
        <span className="placeholder__label">Video briefing</span>
        <button type="button" className="video-sidecar__close" ref={closeButton} onClick={onClose}
          aria-label="Close summary">Close ×</button>
      </div>
      <p className="video-sidecar__channel">{item.channel.title} · <time dateTime={item.video.published_at}>{publishedLabel(item.video.published_at)}</time></p>
      <h2>{item.video.title}</h2>
      <p className="video-sidecar__duration">{durationLabel(item.video.duration_seconds) ?? "Duration unavailable"}</p>
      <section className="video-sidecar__content" aria-label="Summary" aria-busy={preparing}>
        <h3>{preparing ? "Preparing summary…" : summaryStateLabel(item.summary.state)}</h3>
        {preparing ? <p role="status">Generating the first summary can take 30–60 seconds. Once ready, it will be cached and shared across users.</p> : null}
        {item.summary.state === "available" && item.summary.summary
          ? <p>{item.summary.summary}</p> : null}
        {item.summary.state === "available" && item.summary.key_points.length > 0
          ? <ul>{item.summary.key_points.slice(0, 3).map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
          : null}
        {!demo && (item.summary.state === "metadata_pending"
          || item.summary.state === "failed" && item.summary.retryable || canRetry)
          ? <button type="button" onClick={() => onRetry(item.video.video_uid)}>Retry summary</button> : null}
        {item.summary.state === "generation_not_enabled" && !demo
          ? <p>Activate your first-user trial in <a href="/account">Account</a>, or use an active summary plan. Previously cached summaries remain free.</p> : null}
        {item.summary.state === "metadata_pending"
          ? <p>Waiting for YouTube to provide a completed-video duration. Try again after publication.</p> : null}
        {item.summary.state === "short_video" && !demo
          ? <p>This clip is under 30 seconds, so it is too brief for on-demand AI generation. You can still watch it directly.</p> : null}
        {item.summary.state === "failed" && !preparing && !demo
          ? <p>We could not create a summary for this video. It may lack an accessible transcript. You can retry when the provider becomes available.</p> : null}
        {demo && item.summary.state !== "available"
          ? <p>Only previously cached summaries appear in the public demo.</p> : null}
      </section>
      <a className="video-sidecar__watch" href={item.video.canonical_url} target="_blank" rel="noreferrer">Watch on YouTube ↗</a>
    </> : <div className="video-sidecar__empty">
      <span className="placeholder__label">Video briefing</span>
      <h2>Select a video</h2>
      <p>Open a video from the feed to read its summary and key points here.</p>
      <p className="video-sidecar__hint">Only the video you open can trigger a new summary. Scrolling the feed costs nothing.</p>
    </div>}
  </aside>;
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
  const [preparingSummaryUids, setPreparingSummaryUids] = useState<ReadonlySet<string>>(new Set());
  const [selectedVideoUid, setSelectedVideoUid] = useState<string | null>(null);
  const requestedSummaryUids = useRef(new Set<string>());
  const [failedSummaryUids, setFailedSummaryUids] = useState<ReadonlySet<string>>(new Set());
  const selectedItem = items.find((item) => item.video.video_uid === selectedVideoUid) ?? null;

  async function requestSummary(videoUid: string) {
    if (activeSummaryRequests.current.size >= 2 || activeSummaryRequests.current.has(videoUid)) return;
    activeSummaryRequests.current.add(videoUid);
    requestedSummaryUids.current.add(videoUid);
    setPreparingSummaryUids((current) => new Set(current).add(videoUid));
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(videoUid)}/summary`, { method: "POST", cache: "no-store" });
      const payload = await response.json() as { summary?: FeedItem["summary"] };
      if (!response.ok || !payload.summary) throw new Error("Summary is temporarily unavailable.");
      setFailedSummaryUids((current) => {
        const next = new Set(current);
        next.delete(videoUid);
        return next;
      });
      setItems((current) => current.map((item) => item.video.video_uid === videoUid
        && JSON.stringify(item.summary) !== JSON.stringify(payload.summary)
        ? { ...item, summary: payload.summary! } : item));
    } catch {
      setSummaryError("A summary couldn’t be loaded. Your feed is still available.");
      setFailedSummaryUids((current) => new Set(current).add(videoUid));
    } finally {
      activeSummaryRequests.current.delete(videoUid);
      setPreparingSummaryUids((current) => {
        const next = new Set(current);
        next.delete(videoUid);
        return next;
      });
      setItems((current) => [...current]);
    }
  }

  // Only the explicitly selected video enters the costly summary frontier.
  useEffect(() => {
    if (!shouldAutoRequestSelectedSummary(demo, selectedItem, requestedSummaryUids.current)) return;
    void requestSummary(selectedItem!.video.video_uid);
  }, [demo, items, selectedItem, selectedVideoUid]); // The attempted-ID set prevents re-request loops after network failures.

  useEffect(() => {
    if (demo || !selectedItem || selectedItem.summary.state !== "generating") return;
    const uid = selectedItem.video.video_uid;
    const poll = window.setInterval(() => { void requestSummary(uid); }, 4000);
    return () => window.clearInterval(poll);
  }, [demo, items, selectedItem, selectedVideoUid]);

  function selectVideo(videoUid: string) {
    setSummaryError(null);
    setSelectedVideoUid(videoUid);
  }

  function closeSelectedVideo() {
    const button = document.querySelector<HTMLElement>(".feed-card__open[aria-pressed='true']");
    setSelectedVideoUid(null);
    button?.focus();
  }

  useEffect(() => {
    if (!selectedVideoUid) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedVideoUid(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedVideoUid]);

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
    setSummaryError(null);
    requestedSummaryUids.current.delete(videoUid);
    setFailedSummaryUids((current) => {
      const next = new Set(current);
      next.delete(videoUid);
      return next;
    });
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

    {items.length > 0 ? <div className="feed-workspace">
      <div className="feed-list">{items.map((item) => <FeedCard key={item.video.video_uid} item={item}
        selected={selectedVideoUid === item.video.video_uid}
        preparing={preparingSummaryUids.has(item.video.video_uid)} onSelect={selectVideo} />)}</div>
      <VideoSidecar item={selectedItem} demo={demo} onClose={closeSelectedVideo}
        onRetry={retrySummary} preparing={Boolean(selectedItem && preparingSummaryUids.has(selectedItem.video.video_uid))} canRetry={Boolean(selectedItem && failedSummaryUids.has(selectedItem.video.video_uid)
          && selectedItem.summary.state === "not_requested")} />
    </div>
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
