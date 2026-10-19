"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEntitlement } from "@/lib/db";
import { activatePilotTrial } from "@/lib/pilot-access";

export async function activateFirstUserTrial() {
  const client = await createSupabaseServerClient();
  // Unlike claims-only auth, getUser verifies the session with Supabase Auth.
  const { data, error } = await client.auth.getUser();
  const user = data.user;
  if (error || !user?.email) redirect("/login");
  let status: "activated" | "already_active" | "not_eligible";
  try {
    status = await activatePilotTrial({
      userId: user.id,
      email: user.email,
      emailConfirmed: Boolean(user.email_confirmed_at),
      operatorEmail: process.env.PILOT_TRIAL_EMAIL,
      loadEntitlement: getEntitlement,
      grant: async (id) => {
        const { error: grantError } = await createSupabaseAdminClient()
          .rpc("grant_internal_test_entitlement", {
            target_user_id: id,
            requested_follow_limit: 99,
            requested_generation_minutes: 240,
          });
        if (grantError) throw new Error("pilot grant failed");
      },
    });
  } catch {
    console.error("pilot_grant_failed");
    redirect("/account?pilot=error");
  }
  redirect(status === "not_eligible"
    ? "/account?pilot=ineligible"
    : "/account?pilot=activated");
}
