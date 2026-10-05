import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabasePublicConfig, supabaseServiceKey } from "./env";

/** Server-only database client. Never import into a Client Component. */
export function createSupabaseAdminClient() {
  const { url } = supabasePublicConfig();
  return createClient(url, supabaseServiceKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
