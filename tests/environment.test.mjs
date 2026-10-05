import assert from "node:assert/strict";
import test from "node:test";

import { validateEnvironment } from "../scripts/validate-env.mjs";

test("environment validation accepts Cloud Run-style runtime values", () => {
  assert.deepEqual(
    validateEnvironment({ NODE_ENV: "production", PORT: "8080", APP_URL: "https://following.example", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public", SUPABASE_SERVICE_ROLE_KEY: "server", YOUTUBE_API_KEY: "youtube", MEDIA_MONITOR_SIDECAR_URL: "https://sidecar.example", MEDIA_MONITOR_ENSURE_PATH: "/ensure", MEDIA_MONITOR_INSPECT_PATH: "/inspect", MEDIA_MONITOR_SUMMARY_PATH: "/summary" }),
    { nodeEnv: "production", port: 8080 },
  );
});

test("environment validation rejects an invalid port", () => {
  assert.throws(
    () => validateEnvironment({ NODE_ENV: "production", PORT: "not-a-port" }),
    /PORT must be an integer between 1 and 65535/,
  );
});

test("environment validation rejects an unexpected NODE_ENV", () => {
  assert.throws(
    () => validateEnvironment({ NODE_ENV: "preview", PORT: "8080" }),
    /NODE_ENV must be development, test, or production/,
  );
});

test("production environment validation requires server auth and database configuration", () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: "production" }), /SUPABASE_SERVICE_ROLE_KEY is required in production/);
  assert.throws(() => validateEnvironment({ NODE_ENV: "production", APP_URL: "http://example.test", NEXT_PUBLIC_SUPABASE_URL: "x", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", SUPABASE_SERVICE_ROLE_KEY: "x" }), /APP_URL must use HTTPS/);
});
