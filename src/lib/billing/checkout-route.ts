import type { BillingEntitlement } from "./contracts";

type User = { id: string; email?: string | null };
type Dependencies = {
  getUser: () => Promise<User | null>;
  getEntitlement: (userId: string) => Promise<BillingEntitlement | null>;
  createCheckout: (userId: string, email?: string | null) => Promise<string>;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleCheckoutPost(_request: Request, deps: Dependencies) {
  const user = await deps.getUser();
  if (!user) return json({ error: { code: "UNAUTHENTICATED", message: "Sign in to manage your plan." } }, 401);

  try {
    const entitlement = await deps.getEntitlement(user.id);
    if (entitlement?.plan_code === "paid" && (!entitlement.period_end || Date.parse(entitlement.period_end) > Date.now())) {
      return json({ error: { code: "SUBSCRIPTION_EXISTS", message: "A subscription is already active for this account." } }, 409);
    }
    const checkoutUrl = await deps.createCheckout(user.id, user.email);
    return json({ checkout_url: checkoutUrl });
  } catch {
    return json({ error: { code: "BILLING_UNAVAILABLE", message: "Checkout is temporarily unavailable. Try again shortly." } }, 503);
  }
}
