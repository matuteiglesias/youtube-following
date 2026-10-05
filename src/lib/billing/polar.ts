import "server-only";
import { createPolar } from "@polar-sh/sdk/2026-10";
import { paidCheckoutPayload } from "./checkout-payload";
import { polarConfig } from "./config";

export function getPolarClient() {
  const config = polarConfig();
  if (!config) throw new Error("Billing is not configured");
  return { config, client: createPolar({ accessToken: config.accessToken, environment: config.environment }) };
}

export async function createPaidCheckout(userId: string, email?: string | null) {
  const { config, client } = getPolarClient();
  const checkout = await client.checkouts.create(paidCheckoutPayload(config, userId, email));
  if (!checkout.url || !checkout.url.startsWith("https://")) throw new Error("Billing provider returned an invalid checkout URL");
  return checkout.url;
}
