import type { BillingEntitlement, EntitlementView } from "./contracts";

type Dependencies = {
  getUser: () => Promise<{ id: string } | null>;
  getEntitlement: (userId: string) => Promise<BillingEntitlement | null>;
  getUsage: (userId: string, billingPeriod: string | null) => Promise<{ followCount: number; generationMinutesUsed: number }>;
  now?: () => number;
};

export async function handleEntitlementGet(deps: Dependencies) {
  const user = await deps.getUser();
  if (!user) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to view your plan." } }, { status: 401 });
  try {
    const entitlement = await deps.getEntitlement(user.id);
    if (!entitlement) return Response.json({ error: { code: "ENTITLEMENT_NOT_FOUND", message: "Plan status is unavailable." } }, { status: 404 });
    const expiredPaid = entitlement.plan_code === "paid" && ["active", "canceled"].includes(entitlement.status)
      && !!entitlement.period_end && Date.parse(entitlement.period_end) <= (deps.now?.() ?? Date.now());
    const effective = expiredPaid
      ? { ...entitlement, plan_code: "none" as const, status: "none" as const, follow_limit: 0, generation_minutes_limit: 0, period_start: null, period_end: null }
      : entitlement;
    const periodDay = effective.period_start ? effective.period_start.slice(0, 10) : null;
    const usage = await deps.getUsage(user.id, periodDay);
    const view: EntitlementView = {
      plan_code: effective.plan_code,
      status: effective.status,
      follow_limit: effective.follow_limit,
      follow_count: usage.followCount,
      generation_minutes_limit: effective.generation_minutes_limit,
      generation_minutes_used: usage.generationMinutesUsed,
      period_start: effective.period_start,
      period_end: effective.period_end,
    };
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: { code: "ENTITLEMENT_UNAVAILABLE", message: "Plan status is temporarily unavailable." } }, { status: 503 });
  }
}
