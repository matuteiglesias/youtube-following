"use client";

/* YouTube thumbnails are provider URLs; D3 keeps the image path intentionally simple. */
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

type Channel = {
  channel_uid: string;
  platform: "youtube";
  native_channel_id: string;
  handle: string | null;
  title: string;
  canonical_url: string;
  thumbnail_url: string | null;
};

type FollowItem = { channel: Channel; followed_at: string };

type Props = { initialItems: FollowItem[]; limit: number; initialError?: boolean };

export function safeFollowingErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { code?: unknown } }).error;
    if (typeof error?.code === "string") {
      const safeMessages: Record<string, string> = {
        INVALID_CHANNEL_REFERENCE: "That doesn't look like a YouTube channel.",
        CHANNEL_NOT_FOUND: "We couldn't find that channel.",
        ALREADY_FOLLOWED: "You're already following this channel.",
        FOLLOW_LIMIT_REACHED: "You've reached your channel limit.",
        PROVIDER_UNAVAILABLE: "YouTube is temporarily unavailable. Try again shortly.",
        UNAUTHENTICATED: "Sign in to update your followed channels.",
      };
      return safeMessages[error.code] ?? "We couldn’t update your followed channels. Try again shortly.";
    }
  }
  return "Something went wrong. Try again shortly.";
}

export function FollowingScreen({ initialItems, limit, initialError = false }: Props) {
  const [items, setItems] = useState(initialItems);
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<Channel | null>(null);
  const [alreadyFollowed, setAlreadyFollowed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"resolve" | "follow" | "unfollow" | "restore" | null>(null);
  const busy = busyAction !== null;
  const [undo, setUndo] = useState<Channel | null>(null);
  const [loadError] = useState(initialError ? "Your followed channels couldn’t be loaded. Try again shortly." : null);

  async function resolve(event: React.FormEvent) {
    event.preventDefault();
    setBusyAction("resolve"); setMessage(null); setPreview(null);
    try {
      const response = await fetch("/api/channels/resolve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(safeFollowingErrorMessage(payload));
      setPreview(payload.channel); setAlreadyFollowed(payload.already_followed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't resolve that channel."); }
    finally { setBusyAction(null); }
  }

  async function follow() {
    if (!preview) return;
    setBusyAction("follow"); setMessage(null);
    try {
      const response = await fetch("/api/follows", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_uid: preview.channel_uid }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(safeFollowingErrorMessage(payload));
      setItems((current) => current.some((item) => item.channel.channel_uid === preview.channel_uid)
        ? current : [{ channel: preview, followed_at: payload.follow.followed_at }, ...current]);
      setPreview(null); setReference(""); setAlreadyFollowed(false);
      setMessage(payload.backfill === "partial" ? "Following added. Recent videos will retry shortly." : `${preview.title} is now in your following.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't follow that channel."); }
    finally { setBusyAction(null); }
  }

  async function unfollow(channel: Channel) {
    setBusyAction("unfollow"); setMessage(null);
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(channel.channel_uid)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(safeFollowingErrorMessage(await response.json()));
      setItems((current) => current.filter((item) => item.channel.channel_uid !== channel.channel_uid));
      setUndo(channel); setMessage(`Unfollowed ${channel.title}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't update your follows."); }
    finally { setBusyAction(null); }
  }

  async function restore() {
    if (!undo) return;
    setBusyAction("restore"); setMessage(null);
    try {
      const response = await fetch("/api/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_uid: undo.channel_uid }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(safeFollowingErrorMessage(payload));
      setItems((current) => [{ channel: undo, followed_at: payload.follow.followed_at }, ...current]);
      setUndo(null); setMessage(`${undo.title} is followed again.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't restore that follow."); }
    finally { setBusyAction(null); }
  }

  return <section className="following-screen" aria-labelledby="following-heading">
    <div className="following-heading-row">
      <div><p className="placeholder__label">Configuration</p><h1 id="following-heading">Following</h1></div>
      <p className="follow-count">{items.length} / {limit}</p>
    </div>
    <form className="follow-form" onSubmit={resolve}>
      <label htmlFor="channel-reference">YouTube channel URL or @handle</label>
      <div className="follow-form__controls">
        <input id="channel-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://youtube.com/@channel" required />
        <button type="submit" disabled={busy}>{busyAction === "resolve" ? "Resolving…" : "Resolve"}</button>
      </div>
    </form>
    {loadError ? <p role="alert" className="feed-error">{loadError} <button type="button" onClick={() => window.location.reload()}>Try again</button></p> : null}
    {message ? <p role="status" className="follow-message">{message} {undo ? <button type="button" className="link-button" onClick={restore} disabled={busy}>{busyAction === "restore" ? "Restoring…" : "Undo"}</button> : null}</p> : null}
    {preview ? <article className="channel-preview">
      {preview.thumbnail_url ? <img src={preview.thumbnail_url} alt="" width="72" height="72" /> : null}
      <div><h2>{preview.title}</h2><p>{preview.handle ?? "YouTube channel"}</p><a href={preview.canonical_url} rel="noreferrer">{preview.canonical_url}</a></div>
      <button type="button" onClick={follow} disabled={busy || alreadyFollowed}>{busyAction === "follow" ? "Adding…" : alreadyFollowed ? "Already following" : "Follow"}</button>
    </article> : null}
    {items.length === 0 && !loadError ? <div className="empty-following"><h2>Your feed starts with the people you choose.</h2><p>Follow a YouTube channel and its latest videos will appear here.</p></div> : null}
    {items.length > 0 ? <div className="follow-list">
      {items.map((item) => <article className="follow-row" key={item.channel.channel_uid}>
        {item.channel.thumbnail_url ? <img src={item.channel.thumbnail_url} alt="" width="56" height="56" /> : null}
        <div><h2>{item.channel.title}</h2><p>{item.channel.handle ?? "YouTube channel"}</p><a href={item.channel.canonical_url} rel="noreferrer">{item.channel.canonical_url}</a></div>
        <button type="button" onClick={() => unfollow(item.channel)} disabled={busy}>{busyAction === "unfollow" ? "Unfollowing…" : "Unfollow"}</button>
      </article>)}
    </div> : null}
  </section>;
}
