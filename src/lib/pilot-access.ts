/** One-time first-user activation. The authenticated, verified email must
 * exactly match the operator-configured address. Never offer to anonymous
 * users; never regrant an already active trial or overwrite paid entitlements.
 */
export async function activatePilotTrial(input: {
  email: string | undefined;
  emailConfirmed: boolean;
  userId: string;
  operatorEmail: string | undefined;
  loadEntitlement: (id: string) => Promise<{ plan_code: string; status: string } | null>;
  grant: (id: string) => Promise<void>;
}): Promise<"activated" | "already_active" | "not_eligible"> {
  const expected = input.operatorEmail?.trim().toLowerCase();
  if (!expected || !input.emailConfirmed
      || input.email?.trim().toLowerCase() !== expected) return "not_eligible";
  const existing = await input.loadEntitlement(input.userId);
  if (!existing) return "not_eligible";
  if (existing.plan_code === "internal_test" && existing.status === "active") return "already_active";
  if (existing.plan_code !== "none" || existing.status !== "none") return "not_eligible";
  await input.grant(input.userId);
  return "activated";
}
