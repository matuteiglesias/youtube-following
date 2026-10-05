import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { handleCheckoutPost } from "../src/lib/billing/checkout-route.ts";
import { paidCheckoutPayload } from "../src/lib/billing/checkout-payload.ts";
import { handleEntitlementGet } from "../src/lib/billing/entitlement-route.ts";
import { handlePolarWebhook } from "../src/lib/billing/webhook-route.ts";

const userId = "00000000-0000-4000-8000-00000000000a";
const productId = "single-monthly-product";
const secret = "whsec_test_signing_secret";

function subscription(overrides = {}) {
  return {
    id: "subscription-1", product_id: productId, amount: 399, currency: "usd", recurring_interval: "month", recurring_interval_count: 1, status: "active",
    current_period_start: "2026-10-01T00:00:00.000Z", current_period_end: "2026-11-01T00:00:00.000Z",
    modified_at: "2026-10-05T12:00:00.000Z", customer_id: "customer-1",
    customer: { external_id: userId }, ...overrides,
  };
}

function signedRequest(event, { id = "evt-1", body, signatureSecret = secret } = {}) {
  const raw = body ?? JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signatureSecret).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return new Request("https://example.test/api/webhooks/polar", {
    method: "POST", body: raw,
    headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` },
  });
}

function webhookDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    productId,
    followLimit: 30,
    generationMinutesLimit: 600,
    verify: (body, headers) => webhooks.validateEvent(body, {
      "webhook-id": headers.get("webhook-id") ?? "",
      "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
      "webhook-signature": headers.get("webhook-signature") ?? "",
    }, secret),
    apply: async (event) => { calls.push(event); return "applied"; },
    ...overrides,
  };
}

test("checkout requires an authenticated user and does not accept a browser plan", async () => {
  let checkoutCalls = 0;
  const deps = {
    getUser: async () => null,
    getEntitlement: async () => null,
    createCheckout: async () => { checkoutCalls += 1; return "https://polar.sh/checkout/test"; },
  };
  const unauthenticated = await handleCheckoutPost(new Request("https://example.test", { method: "POST", body: '{"plan":"paid"}' }), deps);
  assert.equal(unauthenticated.status, 401);
  assert.equal(checkoutCalls, 0);

  deps.getUser = async () => ({ id: userId, email: "a@example.test" });
  deps.getEntitlement = async () => ({ plan_code: "none", status: "none", follow_limit: 0, generation_minutes_limit: 0, period_start: null, period_end: null });
  const started = await handleCheckoutPost(new Request("https://example.test", { method: "POST", body: '{"plan":"internal_test","follow_limit":9999}' }), deps);
  assert.equal(started.status, 200);
  assert.equal((await started.json()).checkout_url, "https://polar.sh/checkout/test");
  assert.equal(checkoutCalls, 1);
});

test("the Polar adapter payload is fixed to the configured one-plan product and authenticated user", () => {
  assert.deepEqual(paidCheckoutPayload({ productId, appUrl: "https://following.example" }, userId, "a@example.test"), {
    products: [productId], external_customer_id: userId, customer_email: "a@example.test",
    allow_trial: false, allow_discount_codes: false,
    success_url: "https://following.example/?billing=success", return_url: "https://following.example/",
    metadata: { app_user_id: userId, plan_code: "paid" },
  });
});

test("checkout prevents a duplicate paid subscription while paid-through access remains", async () => {
  const response = await handleCheckoutPost(new Request("https://example.test", { method: "POST" }), {
    getUser: async () => ({ id: userId }),
    getEntitlement: async () => ({ plan_code: "paid", status: "canceled", follow_limit: 30, generation_minutes_limit: 600, period_start: "2026-10-01T00:00:00Z", period_end: "2099-11-01T00:00:00Z" }),
    createCheckout: async () => { throw new Error("must not start another checkout"); },
  });
  assert.equal(response.status, 409);
});

test("entitlement endpoint returns only public view fields and normalizes expired cancellation", async () => {
  const calls = [];
  const response = await handleEntitlementGet({
    getUser: async () => ({ id: userId }),
    getEntitlement: async () => ({ plan_code: "paid", status: "canceled", follow_limit: 30, generation_minutes_limit: 600,
      period_start: "2026-10-01T00:00:00Z", period_end: "2026-10-02T00:00:00Z", billing_customer_id: "secret-customer", billing_subscription_id: "secret-sub" }),
    getUsage: async (id, period) => { calls.push([id, period]); return { followCount: 4, generationMinutesUsed: 20 }; },
    now: () => Date.parse("2026-10-05T00:00:00Z"),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    plan_code: "none", status: "none", follow_limit: 0, follow_count: 4,
    generation_minutes_limit: 0, generation_minutes_used: 20, period_start: null, period_end: null,
  });
  assert.deepEqual(calls, [[userId, null]]);
});

test("entitlement endpoint does not present an expired active period as paid", async () => {
  const response = await handleEntitlementGet({
    getUser: async () => ({ id: userId }),
    getEntitlement: async () => ({ plan_code: "paid", status: "active", follow_limit: 30, generation_minutes_limit: 600,
      period_start: "2026-09-01T00:00:00Z", period_end: "2026-10-02T00:00:00Z" }),
    getUsage: async () => ({ followCount: 2, generationMinutesUsed: 15 }),
    now: () => Date.parse("2026-10-05T00:00:00Z"),
  });
  const view = await response.json();
  assert.equal(view.plan_code, "none");
  assert.equal(view.status, "none");
  assert.equal(view.follow_limit, 0);
  assert.equal(view.generation_minutes_limit, 0);
});

test("provider-signed subscription event maps stable external user and replays idempotently", async () => {
  const deps = webhookDeps({ apply: async (event) => { deps.calls.push(event); return deps.calls.length === 1 ? "applied" : "duplicate"; } });
  const event = { type: "subscription.active", timestamp: "2026-10-05T12:00:00.000Z", data: subscription() };
  const first = await handlePolarWebhook(signedRequest(event), deps);
  const replay = await handlePolarWebhook(signedRequest(event), deps);
  assert.equal(first.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(deps.calls.length, 2);
  assert.deepEqual(deps.calls[0], {
    eventId: "evt-1", userId, action: "active", subscriptionId: "subscription-1", customerId: "customer-1",
    periodStart: "2026-10-01T00:00:00.000Z", periodEnd: "2026-11-01T00:00:00.000Z", eventAt: "2026-10-05T12:00:00.000Z",
    followLimit: 30, generationMinutesLimit: 600,
  });
});

test("cancellation keeps paid-through dates; payment issues and revocation map to restrictive states", async () => {
  for (const [type, status, expected] of [
    ["subscription.canceled", "canceled", "canceled"],
    ["subscription.past_due", "past_due", "past_due"],
    ["subscription.revoked", "canceled", "none"],
  ]) {
    const deps = webhookDeps();
    const response = await handlePolarWebhook(signedRequest({ type, timestamp: "2026-10-05T12:00:00Z", data: subscription({ status }) }, { id: `evt-${type}` }), deps);
    assert.equal(response.status, 200);
    assert.equal(deps.calls[0].action, expected);
    assert.equal(deps.calls[0].periodEnd, "2026-11-01T00:00:00.000Z");
  }
});

test("invalid signature, unmapped user, and unexpected product never mutate entitlements", async () => {
  const event = { type: "subscription.active", timestamp: "2026-10-05T12:00:00Z", data: subscription() };
  const deps = webhookDeps();
  const badSignature = await handlePolarWebhook(signedRequest(event, { signatureSecret: "wrong" }), deps);
  assert.equal(badSignature.status, 400);
  assert.equal(deps.calls.length, 0);

  const badUser = await handlePolarWebhook(signedRequest({ ...event, data: subscription({ customer: { external_id: "user@example.test" } }) }, { id: "evt-bad-user" }), deps);
  assert.equal(badUser.status, 400);
  assert.equal(deps.calls.length, 0);

  const otherProduct = await handlePolarWebhook(signedRequest({ ...event, data: subscription({ product_id: "different-product" }) }, { id: "evt-other-product" }), deps);
  assert.equal(otherProduct.status, 200);
  assert.equal(deps.calls.length, 0);

  const wrongPrice = await handlePolarWebhook(signedRequest({ ...event, data: subscription({ amount: 499 }) }, { id: "evt-wrong-price" }), deps);
  assert.equal(wrongPrice.status, 200);
  assert.equal(deps.calls.length, 0);

  const unsupportedState = await handlePolarWebhook(signedRequest({ ...event, data: subscription({ status: "paused" }) }, { id: "evt-paused" }), deps);
  assert.equal(unsupportedState.status, 200);
  assert.equal(deps.calls.length, 0);
});
