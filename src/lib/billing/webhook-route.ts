import { webhooks } from "@polar-sh/sdk/2026-10";
type PolarWebhookEvent = Awaited<ReturnType<typeof webhooks.validateEvent>>;

export type PolarSubscriptionEvent = {
  id: string;
  product_id: string;
  amount: number;
  currency: string;
  recurring_interval: string;
  recurring_interval_count: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  modified_at?: string | null;
  created_at?: string;
  cancel_at_period_end?: boolean;
  ends_at?: string | null;
  customer_id: string;
  customer: { external_id?: string | null };
};

type Dependencies = {
  verify: (body: Uint8Array, headers: Headers) => Promise<PolarWebhookEvent>;
  productId: string;
  followLimit: number;
  generationMinutesLimit: number;
  apply: (input: {
    eventId: string;
    userId: string;
    action: "active" | "past_due" | "canceled" | "none";
    subscriptionId: string;
    customerId: string;
    periodStart: string | null;
    periodEnd: string | null;
    eventAt: string;
    followLimit: number;
    generationMinutesLimit: number;
  }) => Promise<"applied" | "duplicate" | "stale">;
  now?: () => Date;
};

const subscriptionEventTypes = new Set([
  "subscription.created", "subscription.updated", "subscription.active", "subscription.cycled",
  "subscription.canceled", "subscription.uncanceled", "subscription.past_due", "subscription.revoked",
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function isUuid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function statusFor(eventType: string, subscription: PolarSubscriptionEvent): "active" | "past_due" | "canceled" | "none" | null {
  if (eventType === "subscription.revoked") return "none";
  if (eventType === "subscription.past_due" || subscription.status === "past_due" || subscription.status === "unpaid") return "past_due";
  if (eventType === "subscription.canceled" || subscription.status === "canceled" || subscription.cancel_at_period_end) return "canceled";
  if (subscription.status === "active" && ["subscription.created", "subscription.updated", "subscription.active", "subscription.cycled", "subscription.uncanceled"].includes(eventType)) return "active";
  return null;
}

export async function handlePolarWebhook(request: Request, deps: Dependencies) {
  const eventId = request.headers.get("webhook-id");
  if (!eventId || eventId.length > 200) return json({ error: "Invalid webhook" }, 400);

  let event: PolarWebhookEvent;
  try {
    event = await deps.verify(new Uint8Array(await request.arrayBuffer()), request.headers);
  } catch {
    return json({ error: "Invalid webhook signature or payload" }, 400);
  }

  if (!subscriptionEventTypes.has(event.type)) return json({ received: true, ignored: true });
  if (!event.data || typeof event.data !== "object") return json({ error: "Invalid billing event" }, 400);
  const subscription = event.data as unknown as PolarSubscriptionEvent;
  if (subscription.product_id !== deps.productId || subscription.amount !== 399
      || typeof subscription.currency !== "string" || subscription.currency.toLowerCase() !== "usd"
      || subscription.recurring_interval !== "month" || subscription.recurring_interval_count !== 1) {
    return json({ received: true, ignored: true });
  }

  const userId = subscription.customer?.external_id;
  if (!isUuid(userId) || typeof subscription.id !== "string" || !subscription.id
      || typeof subscription.customer_id !== "string" || !subscription.customer_id) {
    return json({ error: "Invalid billing event" }, 400);
  }
  const periodStart = subscription.current_period_start;
  const periodEnd = subscription.current_period_end;
  if (typeof periodStart !== "string" || typeof periodEnd !== "string"
      || Number.isNaN(Date.parse(periodStart)) || Number.isNaN(Date.parse(periodEnd))) return json({ error: "Invalid billing event" }, 400);
  const action = statusFor(event.type, subscription);
  if (!action) return json({ received: true, ignored: true });
  const eventAt = subscription.modified_at ?? event.timestamp;
  if (typeof eventAt !== "string" || Number.isNaN(Date.parse(eventAt))) return json({ error: "Invalid billing event" }, 400);

  try {
    const result = await deps.apply({
      eventId,
      userId,
      action,
      subscriptionId: subscription.id,
      customerId: subscription.customer_id,
      periodStart,
      periodEnd,
      eventAt,
      followLimit: deps.followLimit,
      generationMinutesLimit: deps.generationMinutesLimit,
    });
    return json({ received: true, result });
  } catch {
    return json({ error: "Billing event could not be applied" }, 500);
  }
}
