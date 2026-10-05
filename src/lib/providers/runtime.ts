import "server-only";
import { MediaMonitorVideoArtifactProvider } from "./media-monitor-video-artifacts";
import { YouTubeChannelDiscoveryProvider } from "./youtube-channel-discovery";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

export function runtimeChannelDiscoveryProvider() {
  return new YouTubeChannelDiscoveryProvider(required("YOUTUBE_API_KEY"));
}

export function runtimeVideoArtifactProvider() {
  const baseUrl = required("MEDIA_MONITOR_SIDECAR_URL");
  return new MediaMonitorVideoArtifactProvider(
    baseUrl,
    undefined,
    undefined,
    {
      audience: process.env.MEDIA_MONITOR_SIDECAR_AUDIENCE?.trim() || new URL(baseUrl).origin,
      paths: {
        ensure: required("MEDIA_MONITOR_ENSURE_PATH"),
        inspect: required("MEDIA_MONITOR_INSPECT_PATH"),
        summary: required("MEDIA_MONITOR_SUMMARY_PATH"),
      },
    },
  );
}
