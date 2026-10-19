import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.PILOT_DEMO_EMAIL;
const password = process.env.PILOT_DEMO_PASSWORD;

// Provision a single bounded internal test account, never a hardcoded auth bypass.
if (email !== "pilot-demo@youtube-following.test" || !url || !serviceKey
    || !password || password.length < 18) {
  throw new Error("Missing or unsafe pilot provisioning configuration");
}
const client = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { pilot_account: true },
});
if (error || !data?.user?.id) {
  throw new Error("Cannot create pilot user: " + (error?.code || "unknown_error"));
}
const { error: entitlementError } = await client.rpc("grant_internal_test_entitlement", {
  target_user_id: data.user.id,
  requested_follow_limit: 4,
  requested_generation_minutes: 240,
});
if (entitlementError) {
  throw new Error("Pilot user created, but internal entitlement grant failed: " + entitlementError.code);
}
console.log("Provisioned password-protected pilot account; test entitlement: 4 follows / 240 minutes.");
