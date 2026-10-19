/** Keep this gate aligned with the service-role create_follow_with_limit RPC.
 * The RPC remains the authoritative enforcement point.
 */
export type FollowEntitlement = {
  follow_limit: number;
  status: string;
  period_end: string | null;
};
export type FollowEntitlementGate = "access_not_enabled" | "access_expired" | null;

export function followEntitlementGate(
  entitlement: FollowEntitlement | null,
  now = Date.now(),
): FollowEntitlementGate {
  if (!entitlement || entitlement.follow_limit <= 0 || entitlement.status === "none") {
    return "access_not_enabled";
  }
  const end = entitlement.period_end ? Date.parse(entitlement.period_end) : NaN;
  if (!["active", "canceled"].includes(entitlement.status)
    || !Number.isFinite(end) || end <= now) return "access_expired";
  return null;
}
