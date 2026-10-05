import assert from "node:assert/strict";
import test from "node:test";

import { validateEnvironment } from "../scripts/validate-env.mjs";

test("environment validation accepts Cloud Run-style runtime values", () => {
  assert.deepEqual(
    validateEnvironment({ NODE_ENV: "production", PORT: "8080" }),
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
