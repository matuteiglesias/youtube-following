import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FOLLOW_LIMIT, effectiveFollowLimit } from "../src/lib/follow-entitlement.ts";

test("following has a free minimum of 99 channels irrespective of summary plan", () => {
  assert.equal(DEFAULT_FOLLOW_LIMIT, 99);
  assert.equal(effectiveFollowLimit(0), 99);
  assert.equal(effectiveFollowLimit(30), 99);
  assert.equal(effectiveFollowLimit(99), 99);
  assert.equal(effectiveFollowLimit(130), 130);
  assert.equal(effectiveFollowLimit(Number.NaN), 99);
});
