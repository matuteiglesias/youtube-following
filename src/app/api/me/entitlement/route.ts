import { handleEntitlementGet } from "@/lib/billing/entitlement-route";
import { getEntitlement, getEntitlementUsage } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return handleEntitlementGet({ getUser: getAuthenticatedUser, getEntitlement, getUsage: getEntitlementUsage });
}
