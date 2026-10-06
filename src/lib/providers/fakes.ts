import type { ChannelResolver, ResolvedChannel, UploadFrontierProvider, UploadHint } from "./contracts.ts";

export class FakeChannelResolver implements ChannelResolver {
  private readonly channel: ResolvedChannel;
  readonly resolved: string[] = [];

  constructor(channel: ResolvedChannel) {
    this.channel = channel;
  }

  async resolve(reference: string): Promise<ResolvedChannel> {
    this.resolved.push(reference);
    return this.channel;
  }
}

export class FakeUploadFrontierProvider implements UploadFrontierProvider {
  private readonly uploads: UploadHint[];
  readonly listed: Array<{ channel: ResolvedChannel; limit: number }> = [];

  constructor(uploads: UploadHint[] = []) {
    this.uploads = uploads;
  }

  async listRecentUploads(channel: ResolvedChannel, limit: number): Promise<UploadHint[]> {
    this.listed.push({ channel, limit });
    return this.uploads.slice(0, limit);
  }
}
