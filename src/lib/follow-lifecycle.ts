import type { ChannelDiscoveryProvider, ResolvedChannel, Video, VideoArtifactProvider } from "./providers/contracts.ts";
import type { ChannelRecord, FollowRecord } from "./db.ts";

export const INITIAL_BACKFILL_LIMIT = 10;
const FRESH_FRONTIER_MS = 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;

export type BackfillStatus = "not_needed" | "complete" | "partial";

export type FollowRepository = {
  upsertChannel(channel: ResolvedChannel): Promise<ChannelRecord>;
  getChannel(channelUid: string): Promise<ChannelRecord | null>;
  getMyFollowChannelUids(userId: string): Promise<string[]>;
  createFollowWithLimit(userId: string, channelUid: string): Promise<FollowRecord & { created: boolean }>;
  deleteFollow(userId: string, channelUid: string): Promise<void>;
  upsertVideo(video: Video): Promise<void>;
  markChannelChecked(channelUid: string, status: ChannelRecord["monitoring_status"], nextCheck: string): Promise<void>;
};

export class FollowLifecycleError extends Error {
  readonly code: "channel_not_resolved" | "follow_limit_reached" | "provider_unavailable" | "invalid_channel";

  constructor(code: FollowLifecycleError["code"], message: string) {
    super(message);
    this.name = "FollowLifecycleError";
    this.code = code;
  }
}

function isChannelUid(value: string): boolean {
  return /^youtube-channel:UC[A-Za-z0-9_-]{22}$/.test(value);
}

function isStale(channel: ChannelRecord): boolean {
  if (!channel.next_feed_check_at) return true;
  const nextCheck = Date.parse(channel.next_feed_check_at);
  return !Number.isFinite(nextCheck) || nextCheck <= Date.now();
}

function safeProviderError(): FollowLifecycleError {
  return new FollowLifecycleError("provider_unavailable", "YouTube is temporarily unavailable. Try again shortly.");
}

export async function resolveChannel(
  reference: string,
  userId: string,
  discovery: ChannelDiscoveryProvider,
  repository: FollowRepository,
): Promise<{ channel: ResolvedChannel; already_followed: boolean }> {
  let channel: ResolvedChannel;
  try {
    channel = await discovery.resolve(reference);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "invalid_reference") {
      throw new FollowLifecycleError("invalid_channel", "That doesn't look like a YouTube channel.");
    }
    if (error instanceof Error && "code" in error && error.code === "not_found") {
      throw new FollowLifecycleError("channel_not_resolved", "We couldn't find that channel.");
    }
    throw safeProviderError();
  }
  await repository.upsertChannel(channel);
  const follows = await repository.getMyFollowChannelUids(userId);
  return { channel, already_followed: follows.includes(channel.channel_uid) };
}

export async function followChannel(
  userId: string,
  channelUid: string,
  discoveryFactory: () => ChannelDiscoveryProvider,
  artifactsFactory: () => VideoArtifactProvider,
  repository: FollowRepository,
): Promise<{ follow: FollowRecord & { created: boolean }; backfill: BackfillStatus }> {
  if (!isChannelUid(channelUid)) throw new FollowLifecycleError("invalid_channel", "That doesn't look like a YouTube channel.");
  const channel = await repository.getChannel(channelUid);
  if (!channel) throw new FollowLifecycleError("channel_not_resolved", "We couldn't find that channel.");

  let mutation: FollowRecord & { created: boolean };
  try {
    mutation = await repository.createFollowWithLimit(userId, channelUid);
  } catch (error) {
    if (error instanceof Error && error.message.includes("follow_limit_reached")) {
      throw new FollowLifecycleError("follow_limit_reached", "You've reached your channel limit.");
    }
    throw new FollowLifecycleError("provider_unavailable", "We couldn't update your follows. Try again shortly.");
  }

  if (!mutation.created || !isStale(channel)) {
    return { follow: mutation, backfill: "not_needed" };
  }

  const discovery = discoveryFactory();
  const artifacts = artifactsFactory();
  let partial = false;
  try {
    const hints = await discovery.listRecentUploads(channel, INITIAL_BACKFILL_LIMIT);
    for (const hint of hints.slice(0, INITIAL_BACKFILL_LIMIT)) {
      try {
        const video = await artifacts.ensureVideo(hint.url);
        if (video.channel_uid !== channel.channel_uid) throw new Error("video channel mismatch");
        await repository.upsertVideo(video);
      } catch {
        partial = true;
      }
    }
    await repository.markChannelChecked(
      channel.channel_uid,
      partial ? "error" : "active",
      new Date(Date.now() + (partial ? RETRY_AFTER_MS : FRESH_FRONTIER_MS)).toISOString(),
    );
  } catch {
    partial = true;
    try {
      await repository.markChannelChecked(
        channel.channel_uid,
        "error",
        new Date(Date.now() + RETRY_AFTER_MS).toISOString(),
      );
    } catch {
      // The follow remains safe and durable even if recording retry state fails.
    }
  }

  return { follow: mutation, backfill: partial ? "partial" : "complete" };
}

export async function unfollowChannel(userId: string, channelUid: string, repository: FollowRepository): Promise<void> {
  if (!isChannelUid(channelUid)) throw new FollowLifecycleError("invalid_channel", "That doesn't look like a YouTube channel.");
  await repository.deleteFollow(userId, channelUid);
}
