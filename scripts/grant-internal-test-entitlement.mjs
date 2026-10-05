import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV === "production") throw new Error("Internal test entitlements are disabled in production");
if (process.env.ENABLE_INTERNAL_TEST_ENTITLEMENTS !== "1") {
  throw new Error("Set ENABLE_INTERNAL_TEST_ENTITLEMENTS=1 to grant a development test entitlement");
}
const userId = process.argv[2] ?? "";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("Usage: node scripts/grant-internal-test-entitlement.mjs <auth-user-uuid>");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase URL and service role key must be set in the server environment");
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const { error } = await supabase.rpc("grant_internal_test_entitlement", { target_user_id: userId });
if (error) throw new Error("Could not grant internal test entitlement");
process.stdout.write("Internal test entitlement granted.\n");
