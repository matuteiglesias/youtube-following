import { webhooks } from "@polar-sh/sdk/2026-10";
import { polarConfig } from "@/lib/billing/config";
import { applyPolarEntitlementEvent } from "@/lib/db";
import { handlePolarWebhook } from "@/lib/billing/webhook-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = polarConfig();
  if (!config) return Response.json({ error: "Billing webhook is unavailable" }, { status: 503 });
  return handlePolarWebhook(request, {
    productId: config.productId,
    followLimit: config.followLimit,
    generationMinutesLimit: config.generationMinutesLimit,
    verify: (body, headers) => webhooks.validateEvent(body, {
      "webhook-id": headers.get("webhook-id") ?? "",
      "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
      "webhook-signature": headers.get("webhook-signature") ?? "",
    }, config.webhookSecret),
    apply: applyPolarEntitlementEvent,
  });
}
