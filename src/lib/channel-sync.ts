import type { SyncChannelRecord } from "@/lib/db";
import type { UploadFrontierProvider, Video, VideoArtifactProvider } from "@/lib/providers/contracts";

export const CHANNEL_SYNC_RUN_LIMIT = 25;
export const CHANNEL_SYNC_CONCURRENCY = 5;
export const CHANNEL_SYNC_FRONTIER_LIMIT = 15;
export const CHANNEL_SYNC_LEASE_SECONDS = 300;
export const CHANNEL_SYNC_SUCCESS_MS = 60 * 60 * 1000;
export const CHANNEL_SYNC_RETRY_MS = 5 * 60 * 1000;
const CHANNEL_SYNC_JITTER_MS = 5 * 60 * 1000;
const CHANNEL_SYNC_RETRY_JITTER_MS = 60 * 1000;

export type ChannelSyncFailureKind =
  | "frontier_fetch_failed"
  | "artifact_ensure_failed"
  | "artifact_channel_mismatch"
  | "db_projection_failed"
  | "state_update_failed";

export type ChannelSyncRepository = {
  claimDueChannels(limit: number, leaseSeconds: number): Promise<SyncChannelRecord[]>;
  listExistingNativeVideoIds(nativeVideoIds: string[]): Promise<Set<string>>;
  upsertVideo(video: Video): Promise<void>;
  markChannelSyncResult(
    channelUid: string,
    status: SyncChannelRecord["monitoring_status"],
    checkedAt: string,
    nextCheck: string,
  ): Promise<void>;
  countDueChannels(): Promise<number>;
};

export type ChannelSyncItemResult = {
  channel_uid: string;
  frontier_read: boolean;
  new_videos: number;
  canonicalized: number;
  failure_kinds: ChannelSyncFailureKind[];
};

export type ChannelSyncRunResult = {
  claimed: number;
  checked: number;
  new_videos: number;
  canonicalized: number;
  failures: number;
  remaining_due: number | null;
  items: ChannelSyncItemResult[];
};

type ChannelSyncOptions = {
  limit?: number;
  concurrency?: number;
  frontierLimit?: number;
  leaseSeconds?: number;
  now?: () => Date;
  random?: () => number;
};

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function nextCheckTime(
  current: Date,
  ok: boolean,
  random: () => number,
): string {
  const base = ok ? CHANNEL_SYNC_SUCCESS_MS : CHANNEL_SYNC_RETRY_MS;
  const jitterRange = ok ? CHANNEL_SYNC_JITTER_MS : CHANNEL_SYNC_RETRY_JITTER_MS;
  const sample = Math.max(0, Math.min(0.999999, random()));
  return new Date(current.getTime() + base + Math.floor(sample * jitterRange)).toISOString();
}

async function markSafely(
  repository: ChannelSyncRepository,
  channel: SyncChannelRecord,
  ok: boolean,
  current: Date,
  random: () => number,
  failures: ChannelSyncFailureKind[],
): Promise<void> {
  try {
    await repository.markChannelSyncResult(
      channel.channel_uid,
      ok ? "active" : "error",
      current.toISOString(),
      nextCheckTime(current, ok, random),
    );
  } catch {
    if (!failures.includes("state_update_failed")) failures.push("state_update_failed");
  }
}

async function syncOneChannel(
  channel: SyncChannelRecord,
  repository: ChannelSyncRepository,
  frontier: UploadFrontierProvider,
  artifacts: VideoArtifactProvider,
  frontierLimit: number,
  now: () => Date,
  random: () => number,
): Promise<ChannelSyncItemResult> {
  const failures: ChannelSyncFailureKind[] = [];
  const current = now();
  let hints;

  try {
    hints = await frontier.listRecentUploads(channel, frontierLimit);
  } catch {
    failures.push("frontier_fetch_failed");
    await markSafely(repository, channel, false, current, random, failures);
    return {
      channel_uid: channel.channel_uid,
      frontier_read: false,
      new_videos: 0,
      canonicalized: 0,
      failure_kinds: failures,
    };
  }

  let existing: Set<string>;
  try {
    existing = await repository.listExistingNativeVideoIds(
      hints.map((hint) => hint.native_video_id),
    );
  } catch {
    failures.push("db_projection_failed");
    await markSafely(repository, channel, false, current, random, failures);
    return {
      channel_uid: channel.channel_uid,
      frontier_read: true,
      new_videos: 0,
      canonicalized: 0,
      failure_kinds: failures,
    };
  }

  const unseen = hints.filter((hint) => !existing.has(hint.native_video_id));
  let canonicalized = 0;

  for (const hint of unseen) {
    let video: Video;
    try {
      video = await artifacts.ensureVideo(hint.url);
    } catch {
      failures.push("artifact_ensure_failed");
      continue;
    }
    if (video.channel_uid !== channel.channel_uid) {
      failures.push("artifact_channel_mismatch");
      continue;
    }
    try {
      await repository.upsertVideo(video);
      canonicalized += 1;
    } catch {
      failures.push("db_projection_failed");
    }
  }

  const uniqueFailures = [...new Set(failures)];
  await markSafely(
    repository,
    channel,
    uniqueFailures.length === 0,
    current,
    random,
    uniqueFailures,
  );

  return {
    channel_uid: channel.channel_uid,
    frontier_read: true,
    new_videos: unseen.length,
    canonicalized,
    failure_kinds: uniqueFailures,
  };
}

export async function runChannelSync(
  repository: ChannelSyncRepository,
  frontier: UploadFrontierProvider,
  artifacts: VideoArtifactProvider,
  options: ChannelSyncOptions = {},
): Promise<ChannelSyncRunResult> {
  const limit = boundedInteger(
    options.limit ?? CHANNEL_SYNC_RUN_LIMIT,
    1,
    CHANNEL_SYNC_RUN_LIMIT,
    "channel sync limit",
  );
  const concurrency = boundedInteger(
    options.concurrency ?? CHANNEL_SYNC_CONCURRENCY,
    1,
    CHANNEL_SYNC_CONCURRENCY,
    "channel sync concurrency",
  );
  const frontierLimit = boundedInteger(
    options.frontierLimit ?? CHANNEL_SYNC_FRONTIER_LIMIT,
    1,
    CHANNEL_SYNC_FRONTIER_LIMIT,
    "frontier limit",
  );
  const leaseSeconds = boundedInteger(
    options.leaseSeconds ?? CHANNEL_SYNC_LEASE_SECONDS,
    30,
    1800,
    "lease seconds",
  );
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;

  const claimed = await repository.claimDueChannels(limit, leaseSeconds);
  const results: ChannelSyncItemResult[] = new Array(claimed.length);
  let cursor = 0;

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= claimed.length) return;
      results[index] = await syncOneChannel(
        claimed[index],
        repository,
        frontier,
        artifacts,
        frontierLimit,
        now,
        random,
      );
    }
  }

  const workerCount = Math.min(concurrency, claimed.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  let remainingDue: number | null = null;
  try {
    remainingDue = await repository.countDueChannels();
  } catch {
    remainingDue = null;
  }

  return {
    claimed: claimed.length,
    checked: results.filter((item) => item.frontier_read).length,
    new_videos: results.reduce((sum, item) => sum + item.new_videos, 0),
    canonicalized: results.reduce((sum, item) => sum + item.canonicalized, 0),
    failures: results.filter((item) => item.failure_kinds.length > 0).length,
    remaining_due: remainingDue,
    items: results,
  };
}
