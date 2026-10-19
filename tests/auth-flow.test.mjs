import assert from "node:assert/strict";
import test from "node:test";
import { endSession, magicLinkRedirect, normalizeEmail, requestMagicLink, requestPasswordSignIn, requestPasswordRegistration, requestPasswordUpdate, safeNextPath } from "../src/lib/auth-flow.ts";

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

test("password login requires a real Supabase account and never hardcodes demo credentials", async () => {
  const calls = [];
  const client = { auth: {
    signInWithPassword: async (input) => {
      calls.push(input);
      return { error: input.password === "correct-long-pass" ? null : new Error("provider rejected") };
    },
  } };
  assert.equal(await requestPasswordSignIn(client, "demo", "correct-long-pass", "pilot@example.test"), "signed-in");
  assert.deepEqual(calls.at(-1), { email: "pilot@example.test", password: "correct-long-pass" });
  assert.equal(await requestPasswordSignIn(client, "USER@EXAMPLE.COM", "wrong", undefined), "invalid-credentials");
  assert.deepEqual(calls.at(-1), { email: "user@example.com", password: "wrong" });
  assert.equal(await requestPasswordSignIn(client, "demo", "1234", undefined), "invalid-credentials");
  assert.equal(await requestPasswordSignIn(client, "bad-identity", "1234", undefined), "invalid-credentials");
  assert.equal(calls.length, 2);
});

test("password sign-up is a one-time email confirmation flow, never a shared demo bypass", async () => {
  const calls = [];
  const client = { auth: { signUp: async (input) => {
    calls.push(input);
    return { data: { session: null }, error: null };
  } } };
  assert.equal(await requestPasswordRegistration(client, "NEW@EXAMPLE.TEST", "long-secret-password", "https://myapp.test"), "check-email");
  assert.deepEqual(calls, [{ email: "new@example.test", password: "long-secret-password",
    options: { emailRedirectTo: "https://myapp.test/auth/callback?next=%2F" } }]);
  assert.equal(await requestPasswordRegistration(client, "broken", "long-secret-password", "https://myapp.test"), "invalid-email");
  assert.equal(await requestPasswordRegistration(client, "me@example.test", "1234", "https://myapp.test"), "weak-password");
  assert.equal(calls.length, 1);
});

test("setting a password on an authenticated account uses Supabase and enforces length", async () => {
  const calls = [];
  const client = { auth: { updateUser: async (value) => { calls.push(value); return { error: null }; } } };
  assert.equal(await requestPasswordUpdate(client, "1234"), "weak-password");
  assert.equal(calls.length, 0);
  assert.equal(await requestPasswordUpdate(client, "safe-new-password"), "updated");
  assert.deepEqual(calls, [{ password: "safe-new-password" }]);
});
