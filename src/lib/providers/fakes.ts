import type { ChannelDiscoveryProvider, ResolvedChannel, UploadHint } from "./contracts.ts";

export class FakeChannelDiscoveryProvider implements ChannelDiscoveryProvider {
  private readonly channel: ResolvedChannel;
  private readonly uploads: UploadHint[];
  readonly resolved: string[] = [];
  readonly listed: Array<{ channel: ResolvedChannel; limit: number }> = [];

  constructor(
    channel: ResolvedChannel,
    uploads: UploadHint[] = [],
  ) {
    this.channel = channel;
    this.uploads = uploads;
  }

  async resolve(reference: string): Promise<ResolvedChannel> {
    this.resolved.push(reference);
    return this.channel;
  }

  async listRecentUploads(channel: ResolvedChannel, limit: number): Promise<UploadHint[]> {
    this.listed.push({ channel, limit });
    return this.uploads.slice(0, limit);
  }
}
