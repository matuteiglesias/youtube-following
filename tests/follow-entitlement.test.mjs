import assert from "node:assert/strict";
import test from "node:test";
import { followEntitlementGate } from "../src/lib/follow-entitlement.ts";

const now = Date.parse("2026-10-19T11:00:00Z");
const later = "2026-11-01T00:00:00Z";
const before = "2026-10-01T00:00:00Z";

test("an unentitled pilot account cannot follow, even though channel resolution succeeds", () => {
  assert.equal(followEntitlementGate(null, now), "access_not_enabled");
  assert.equal(followEntitlementGate({ follow_limit: 0, status: "none", period_end: null }, now), "access_not_enabled");
  assert.equal(followEntitlementGate({ follow_limit: 0, status: "active", period_end: later }, now), "access_not_enabled");
});

test("active and paid-through plans can follow while inactive/expired plans cannot", () => {
  assert.equal(followEntitlementGate({ follow_limit: 4, status: "active", period_end: later }, now), null);
  assert.equal(followEntitlementGate({ follow_limit: 4, status: "canceled", period_end: later }, now), null);
  assert.equal(followEntitlementGate({ follow_limit: 4, status: "canceled", period_end: before }, now), "access_expired");
  assert.equal(followEntitlementGate({ follow_limit: 4, status: "past_due", period_end: later }, now), "access_expired");
  assert.equal(followEntitlementGate({ follow_limit: 4, status: "active", period_end: null }, now), "access_expired");
});
