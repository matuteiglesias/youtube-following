import { handleCheckoutPost } from "@/lib/billing/checkout-route";
import { createPaidCheckout } from "@/lib/billing/polar";
import { getEntitlement } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleCheckoutPost(request, { getUser: getAuthenticatedUser, getEntitlement, createCheckout: createPaidCheckout });
}
