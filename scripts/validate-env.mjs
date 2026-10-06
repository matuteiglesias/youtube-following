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
    for (const name of ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MEDIA_MONITOR_SIDECAR_URL", "MEDIA_MONITOR_ENSURE_PATH", "MEDIA_MONITOR_INSPECT_PATH", "MEDIA_MONITOR_SUMMARY_PATH", "CHANNEL_SYNC_SCHEDULER_AUDIENCE", "CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL", "POLAR_ACCESS_TOKEN", "POLAR_PRODUCT_ID", "POLAR_WEBHOOK_SECRET"]) {
      if (!env[name]) errors.push(`${name} is required in production`);
    }
    if (env.POLAR_ENVIRONMENT && !["sandbox", "production"].includes(env.POLAR_ENVIRONMENT)) {
      errors.push("POLAR_ENVIRONMENT must be sandbox or production");
    }
    if (!env.POLAR_ENVIRONMENT) errors.push("POLAR_ENVIRONMENT is required in production");
    for (const [name, maximum] of [["PAID_FOLLOW_LIMIT", 10000], ["PAID_GENERATION_MINUTES_LIMIT", 1000000]]) {
      if (env[name] !== undefined && (!/^\d+$/.test(env[name]) || Number(env[name]) < 1 || Number(env[name]) > maximum)) {
        errors.push(`${name} must be an integer between 1 and ${maximum}`);
      }
    }
    if (env.APP_URL) {
      try {
        const appUrl = new URL(env.APP_URL);
        if (appUrl.protocol !== "https:") errors.push("APP_URL must use HTTPS in production");
      } catch {
        errors.push("APP_URL must be an absolute HTTPS URL in production");
      }
    }
    if (env.CHANNEL_SYNC_SCHEDULER_AUDIENCE) {
      try {
        const audience = new URL(env.CHANNEL_SYNC_SCHEDULER_AUDIENCE);
        if (audience.protocol !== "https:") errors.push("CHANNEL_SYNC_SCHEDULER_AUDIENCE must use HTTPS in production");
      } catch {
        errors.push("CHANNEL_SYNC_SCHEDULER_AUDIENCE must be an absolute HTTPS URL in production");
      }
    }
    if (env.CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL
      && !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(env.CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL)) {
      errors.push("CHANNEL_SYNC_SCHEDULER_SERVICE_ACCOUNT_EMAIL must be a service-account email");
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
