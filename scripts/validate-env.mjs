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

  if (env.NODE_ENV === "production") {
    for (const name of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "YOUTUBE_API_KEY", "MEDIA_MONITOR_SIDECAR_URL", "MEDIA_MONITOR_ENSURE_PATH", "MEDIA_MONITOR_INSPECT_PATH", "MEDIA_MONITOR_SUMMARY_PATH"]) {
      if (!env[name]) errors.push(`${name} is required in production`);
    }
    if (env.APP_URL) {
      try {
        const appUrl = new URL(env.APP_URL);
        if (appUrl.protocol !== "https:") errors.push("APP_URL must use HTTPS in production");
      } catch {
        errors.push("APP_URL must be an absolute HTTPS URL in production");
      }
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
