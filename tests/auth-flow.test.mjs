import assert from "node:assert/strict";
import test from "node:test";
import { endSession, magicLinkRedirect, normalizeEmail, requestMagicLink, safeNextPath } from "../src/lib/auth-flow.ts";

test("magic-link request normalizes email and pins callback to configured app origin", async () => {
  const calls = [];
  const client = { auth: { signInWithOtp: async (input) => { calls.push(input); return { error: null }; }, signOut: async () => ({ error: null }) } };
  assert.equal(await requestMagicLink(client, "  Person@Example.com ", "https://app.example.test/base"), "sent");
  assert.deepEqual(calls, [{
    email: "person@example.com",
    options: { emailRedirectTo: "https://app.example.test/auth/callback?next=%2F", shouldCreateUser: true },
  }]);
  assert.equal(await requestMagicLink(client, "not-an-email", "https://app.example.test"), "invalid-email");
  assert.equal(calls.length, 1);
  assert.throws(() => magicLinkRedirect("http://app.example.test"), /HTTPS/);
  assert.equal(normalizeEmail(undefined), null);
});

test("magic-link provider failures and sign-out failures remain visible to the UI", async () => {
  const failedClient = { auth: { signInWithOtp: async () => ({ error: new Error("private provider detail") }), signOut: async () => ({ error: new Error("offline") }) } };
  assert.equal(await requestMagicLink(failedClient, "user@example.test", "http://localhost:3000"), "failed");
  assert.equal(await endSession(failedClient), false);
  assert.equal(await endSession({ auth: { signOut: async () => ({ error: null }) } }), true);
});

test("callback accepts only known same-origin destinations", () => {
  assert.equal(safeNextPath("/"), "/");
  assert.equal(safeNextPath("/following"), "/following");
  for (const target of ["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "/unknown/path"]) {
    assert.equal(safeNextPath(target), "/");
  }
});
