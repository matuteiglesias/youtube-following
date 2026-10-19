/**
 * Free channel following is an independent capability, not a paid entitlement.
 * The Postgres create_follow_with_limit RPC enforces the same minimum of 99,
 * serialized on the user's entitlement row to prevent concurrent overshoot.
 */
export const DEFAULT_FOLLOW_LIMIT = 99;

export function effectiveFollowLimit(legacyPaidLimit: number): number {
  return Math.max(DEFAULT_FOLLOW_LIMIT,
    Number.isSafeInteger(legacyPaidLimit) && legacyPaidLimit >= 0 ? legacyPaidLimit : 0);
}
