import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import {
  SchedulerIdentityError,
  verifySchedulerIdentityToken,
  verifySchedulerRequest,
} from "../src/lib/scheduler-identity.ts";

const audience = "https://youtube-following-xyz.run.app/api/internal/sync-channels";
const email = "youtube-following-scheduler@example-project.iam.gserviceaccount.com";
const now = 1_791_329_600;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function token(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: audience,
    exp: now + 3600,
    iat: now,
    email,
    email_verified: true,
    sub: "1234567890",
    ...overrides,
  })).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

test("Scheduler OIDC verifier accepts the exact audience and service-account identity", () => {
  const payload = verifySchedulerIdentityToken(token(), {
    audience,
    serviceAccountEmail: email,
    jwks: [jwk],
    nowSeconds: now,
  });
  assert.equal(payload.email, email);
  assert.equal(payload.aud, audience);
});

test("Scheduler OIDC verifier rejects wrong audience, identity, expiry, and signatures", () => {
  const cases = [
    token({ aud: "https://wrong.example" }),
    token({ email: "other@example-project.iam.gserviceaccount.com" }),
    token({ exp: now - 301 }),
  ];
  for (const value of cases) {
    assert.throws(
      () => verifySchedulerIdentityToken(value, {
        audience,
        serviceAccountEmail: email,
        jwks: [jwk],
        nowSeconds: now,
      }),
      SchedulerIdentityError,
    );
  }

  const parts = token().split(".");
  const badSignature = `${parts[0]}.${parts[1]}.${Buffer.from("bad").toString("base64url")}`;
  assert.throws(
    () => verifySchedulerIdentityToken(badSignature, {
      audience,
      serviceAccountEmail: email,
      jwks: [jwk],
      nowSeconds: now,
    }),
    SchedulerIdentityError,
  );
});

test("Scheduler request verification rejects missing bearer auth before network access", async () => {
  let fetched = false;
  await assert.rejects(
    verifySchedulerRequest(null, {
      audience,
      serviceAccountEmail: email,
      fetcher: async () => {
        fetched = true;
        return new Response();
      },
      nowMs: now * 1000,
    }),
    (error) => error instanceof SchedulerIdentityError && error.code === "missing_token",
  );
  assert.equal(fetched, false);
});
