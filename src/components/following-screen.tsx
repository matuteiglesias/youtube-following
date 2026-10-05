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

type Props = { initialItems: FollowItem[]; limit: number };

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return "Something went wrong. Try again shortly.";
}

export function FollowingScreen({ initialItems, limit }: Props) {
  const [items, setItems] = useState(initialItems);
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<Channel | null>(null);
  const [alreadyFollowed, setAlreadyFollowed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Channel | null>(null);

  async function resolve(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null); setPreview(null);
    try {
      const response = await fetch("/api/channels/resolve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reference }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setPreview(payload.channel); setAlreadyFollowed(payload.already_followed);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't resolve that channel."); }
    finally { setBusy(false); }
  }

  async function follow() {
    if (!preview) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/follows", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_uid: preview.channel_uid }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setItems((current) => current.some((item) => item.channel.channel_uid === preview.channel_uid)
        ? current : [{ channel: preview, followed_at: payload.follow.followed_at }, ...current]);
      setPreview(null); setReference(""); setAlreadyFollowed(false);
      setMessage(payload.backfill === "partial" ? "Following added. Recent videos will retry shortly." : `${preview.title} is now in your following.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't follow that channel."); }
    finally { setBusy(false); }
  }

  async function unfollow(channel: Channel) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(channel.channel_uid)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(errorMessage(await response.json()));
      setItems((current) => current.filter((item) => item.channel.channel_uid !== channel.channel_uid));
      setUndo(channel); setMessage(`Unfollowed ${channel.title}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't update your follows."); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (!undo) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/follows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel_uid: undo.channel_uid }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload));
      setItems((current) => [{ channel: undo, followed_at: payload.follow.followed_at }, ...current]);
      setUndo(null); setMessage(`${undo.title} is followed again.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't restore that follow."); }
    finally { setBusy(false); }
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
        <button type="submit" disabled={busy}>Resolve</button>
      </div>
    </form>
    {message ? <p role="status" className="follow-message">{message} {undo ? <button type="button" className="link-button" onClick={restore} disabled={busy}>Undo</button> : null}</p> : null}
    {preview ? <article className="channel-preview">
      {preview.thumbnail_url ? <img src={preview.thumbnail_url} alt="" width="72" height="72" /> : null}
      <div><h2>{preview.title}</h2><p>{preview.handle ?? "YouTube channel"}</p><a href={preview.canonical_url} rel="noreferrer">{preview.canonical_url}</a></div>
      <button type="button" onClick={follow} disabled={busy || alreadyFollowed}>{alreadyFollowed ? "Already following" : "Follow"}</button>
    </article> : null}
    {items.length === 0 ? <div className="empty-following"><h2>Your feed starts with the people you choose.</h2><p>Follow a YouTube channel and its latest videos will appear here.</p></div> : <div className="follow-list">
      {items.map((item) => <article className="follow-row" key={item.channel.channel_uid}>
        {item.channel.thumbnail_url ? <img src={item.channel.thumbnail_url} alt="" width="56" height="56" /> : null}
        <div><h2>{item.channel.title}</h2><p>{item.channel.handle ?? "YouTube channel"}</p><a href={item.channel.canonical_url} rel="noreferrer">{item.channel.canonical_url}</a></div>
        <button type="button" onClick={() => unfollow(item.channel)} disabled={busy}>Unfollow</button>
      </article>)}
    </div>}
  </section>;
}
