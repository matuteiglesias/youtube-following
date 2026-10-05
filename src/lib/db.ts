import "server-only";
import type { ResolvedChannel, Video } from "@/lib/providers/contracts";
import type { FeedItem, FeedQuery } from "@/lib/feed";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FollowRecord = {
  channel_uid: string;
  followed_at: string;
};

export type ChannelRecord = ResolvedChannel & {
  monitoring_status: "active" | "idle" | "error";
  last_feed_checked_at: string | null;
  next_feed_check_at: string | null;
};

type FollowMutation = FollowRecord & { created: boolean };

function admin() {
  return createSupabaseAdminClient();
}

export async function upsertChannel(channel: ResolvedChannel): Promise<ChannelRecord> {
  const { data, error } = await admin().from("channels").upsert({
    ...channel,
    monitoring_status: "idle",
  }, { onConflict: "native_channel_id" }).select("channel_uid,native_channel_id,handle,title,canonical_url,thumbnail_url,monitoring_status,last_feed_checked_at,next_feed_check_at").single();
  if (error || !data) throw new Error("Could not save channel");
  return data as ChannelRecord;
}

export async function getChannel(channelUid: string): Promise<ChannelRecord | null> {
  const { data, error } = await admin().from("channels")
    .select("channel_uid,native_channel_id,handle,title,canonical_url,thumbnail_url,monitoring_status,last_feed_checked_at,next_feed_check_at")
    .eq("channel_uid", channelUid).maybeSingle();
  if (error) throw new Error("Could not load channel");
  return data as ChannelRecord | null;
}

export async function listMyFollows(userId: string): Promise<Array<{ channel: ChannelRecord; followed_at: string }>> {
  const { data, error } = await admin().from("follows")
    .select("channel_uid,followed_at,channels(channel_uid,native_channel_id,handle,title,canonical_url,thumbnail_url,monitoring_status,last_feed_checked_at,next_feed_check_at)")
    .eq("user_id", userId).order("followed_at", { ascending: false });
  if (error) throw new Error("Could not load follows");
  return (data ?? []).flatMap((row) => {
    const channel = Array.isArray(row.channels) ? row.channels[0] : row.channels;
    return channel ? [{ channel: channel as ChannelRecord, followed_at: row.followed_at as string }] : [];
  });
}

export async function getMyFollowChannelUids(userId: string): Promise<string[]> {
  const { data, error } = await admin().from("follows").select("channel_uid").eq("user_id", userId);
  if (error) throw new Error("Could not load follows");
  return (data ?? []).map((row) => row.channel_uid as string);
}

export async function createFollowWithLimit(userId: string, channelUid: string): Promise<FollowMutation> {
  const { data, error } = await admin().rpc("create_follow_with_limit", {
    target_user_id: userId,
    target_channel_uid: channelUid,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.channel_uid || !row.followed_at) throw new Error("Could not create follow");
  return {
    channel_uid: row.channel_uid,
    followed_at: row.followed_at,
    created: row.created === true,
  };
}

export async function deleteFollow(userId: string, channelUid: string): Promise<void> {
  const { error } = await admin().from("follows").delete().eq("user_id", userId).eq("channel_uid", channelUid);
  if (error) throw new Error("Could not remove follow");
}

export async function upsertVideo(video: Video): Promise<void> {
  const { error } = await admin().from("videos").upsert({ ...video, live_status: video.live_status ?? "unknown" }, { onConflict: "native_video_id" });
  if (error) throw new Error("Could not save video");
}

export type SummaryClaimResult = { state: string; summary?: Record<string, unknown>; retryable?: boolean };

export async function claimSummaryGeneration(input: {
  userId: string; videoUid: string; summaryKey: string; specVersion: string;
  language: string; chargedMinutes: number;
}): Promise<SummaryClaimResult> {
  const { data, error } = await admin().rpc("claim_summary_generation", {
    target_user_id: input.userId,
    target_video_uid: input.videoUid,
    target_summary_key: input.summaryKey,
    target_spec_version: input.specVersion,
    target_language: input.language,
    target_charged_minutes: input.chargedMinutes,
  });
  if (error) throw new Error("Could not claim summary generation");
  return data as SummaryClaimResult;
}

export async function completeSummaryGeneration(input: {
  summaryKey: string; userId: string; summaryId: string; summary: string;
  keyPoints: string[]; language: string; provider: string | null; model: string | null;
}): Promise<boolean> {
  const { data, error } = await admin().rpc("complete_summary_generation", {
    target_summary_key: input.summaryKey, target_user_id: input.userId,
    target_summary_id: input.summaryId, target_summary_text: input.summary,
    target_key_points: input.keyPoints, target_language: input.language,
    target_provider: input.provider, target_model: input.model,
  });
  if (error) throw new Error("Could not save summary");
  return data === true;
}

export async function failSummaryGeneration(summaryKey: string, userId: string): Promise<boolean> {
  const { data, error } = await admin().rpc("fail_summary_generation", {
    target_summary_key: summaryKey, target_user_id: userId,
  });
  if (error) throw new Error("Could not record summary failure");
  return data === true;
}

export async function getVideoForSummary(videoUid: string) {
  const { data, error } = await admin().from("videos")
    .select("video_uid,duration_seconds,availability,live_status")
    .eq("video_uid", videoUid).maybeSingle();
  if (error) throw new Error("Could not load video");
  return data as { video_uid: string; duration_seconds: number | null; availability: string; live_status: string } | null;
}

export async function markChannelChecked(channelUid: string, status: ChannelRecord["monitoring_status"], nextCheck: string): Promise<void> {
  const { error } = await admin().from("channels").update({
    last_feed_checked_at: new Date().toISOString(),
    next_feed_check_at: nextCheck,
    monitoring_status: status,
  }).eq("channel_uid", channelUid);
  if (error) throw new Error("Could not update channel state");
}

export function followRepository() {
  return {
    upsertChannel,
    getChannel,
    getMyFollowChannelUids,
    createFollowWithLimit,
    deleteFollow,
    upsertVideo,
    markChannelChecked,
  };
}

export async function getMyProfile() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("user_id,created_at,updated_at").maybeSingle();
  if (error) throw new Error("Could not load profile");
  return data;
}

export async function getMyEntitlement() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("entitlements")
    .select("plan_code,status,follow_limit,generation_minutes_limit,period_start,period_end")
    .maybeSingle();
  if (error) throw new Error("Could not load entitlement");
  return data;
}

export async function getEntitlement(userId: string) {
  const { data, error } = await admin().from("entitlements")
    .select("plan_code,status,follow_limit,generation_minutes_limit,period_start,period_end")
    .eq("user_id", userId).maybeSingle();
  if (error) throw new Error("Could not load entitlement");
  return data;
}

/** Read one bounded, user-scoped page. This query never invokes a provider. */
export async function listFeedRows(userId: string, query: FeedQuery): Promise<FeedItem[]> {
  const { data, error } = await admin().rpc("read_feed_page", {
    target_user_id: userId,
    after_published_at: query.cursor?.published_at ?? null,
    after_video_uid: query.cursor?.video_uid ?? null,
    requested_channel_uid: query.channel_uid,
    requested_limit: query.limit,
  });
  if (error) throw new Error("Could not load feed");
  return (data ?? []).map((row: { feed_item: unknown }) => row.feed_item as FeedItem);
}

/** Public demo reads a bounded global projection for server-configured channels only. */
export async function listDemoFeedRows(channelUids: string[], limit = 20): Promise<FeedItem[]> {
  if (channelUids.length === 0) return [];
  const { data, error } = await admin().rpc("read_demo_feed_page", {
    requested_channel_uids: channelUids,
    requested_limit: limit,
  });
  if (error) throw new Error("Could not load demo feed");
  return (data ?? []).map((row: { feed_item: unknown }) => row.feed_item as FeedItem);
}
