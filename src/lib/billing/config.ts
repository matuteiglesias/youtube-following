export type PolarEnvironment = "sandbox" | "production";

export function polarConfig(env: NodeJS.ProcessEnv = process.env) {
  const accessToken = env.POLAR_ACCESS_TOKEN;
  const webhookSecret = env.POLAR_WEBHOOK_SECRET;
  const productId = env.POLAR_PRODUCT_ID;
  const appUrl = env.APP_URL;
  const environment = env.POLAR_ENVIRONMENT ?? "sandbox";
  const followLimit = Number(env.PAID_FOLLOW_LIMIT ?? "30");
  const generationMinutesLimit = Number(env.PAID_GENERATION_MINUTES_LIMIT ?? "600");

  if (!accessToken || !webhookSecret || !productId || !appUrl) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  if (!Number.isSafeInteger(followLimit) || followLimit < 1 || followLimit > 10000
      || !Number.isSafeInteger(generationMinutesLimit) || generationMinutesLimit < 1 || generationMinutesLimit > 1000000) return null;

  let parsedAppUrl: URL;
  try {
    parsedAppUrl = new URL(appUrl);
  } catch {
    return null;
  }
  if (parsedAppUrl.protocol !== "https:" && env.NODE_ENV === "production") return null;
  if (parsedAppUrl.username || parsedAppUrl.password) return null;

  return { accessToken, webhookSecret, productId, appUrl: parsedAppUrl.origin, environment: environment as PolarEnvironment, followLimit, generationMinutesLimit };
}
