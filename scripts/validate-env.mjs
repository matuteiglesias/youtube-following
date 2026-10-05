const validNodeEnvironments = new Set(["development", "test", "production"]);

export function validateEnvironment(env = process.env) {
  const errors = [];

  if (env.NODE_ENV && !validNodeEnvironments.has(env.NODE_ENV)) {
    errors.push("NODE_ENV must be development, test, or production");
  }

  if (env.PORT !== undefined && env.PORT !== "") {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push("PORT must be an integer between 1 and 65535");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment: ${errors.join("; ")}`);
  }

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port: env.PORT ? Number(env.PORT) : 3000,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  validateEnvironment();
}
