import { FollowLifecycleError } from "./follow-lifecycle";
import { ProviderError } from "./providers/contracts";

export function productError(error: unknown): { status: number; body: { error: { code: string; message: string } } } {
  if (error instanceof FollowLifecycleError) {
    const status = error.code === "follow_limit_reached" ? 403
      : error.code === "channel_not_resolved" ? 404
        : error.code === "invalid_channel" ? 400 : 503;
    const code = error.code === "invalid_channel" ? "INVALID_CHANNEL_REFERENCE"
      : error.code === "channel_not_resolved" ? "CHANNEL_NOT_FOUND"
        : error.code === "follow_limit_reached" ? "FOLLOW_LIMIT_REACHED" : "PROVIDER_UNAVAILABLE";
    return { status, body: { error: { code, message: error.message } } };
  }
  if (error instanceof ProviderError) {
    return { status: error.code === "invalid_reference" ? 400 : error.code === "not_found" ? 404 : 503,
      body: { error: { code: "PROVIDER_UNAVAILABLE", message: "YouTube is temporarily unavailable. Try again shortly." } } };
  }
  return { status: 503, body: { error: { code: "PROVIDER_UNAVAILABLE", message: "YouTube is temporarily unavailable. Try again shortly." } } };
}
