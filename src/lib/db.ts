import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getMyProfile() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("user_id,created_at,updated_at").maybeSingle();
  if (error) throw new Error("Could not load profile");
  return data;
}

export async function getMyEntitlement() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("entitlements")
    .select("plan_code,status,follow_limit,generation_minutes_limit,period_start,period_end")
    .maybeSingle();
  if (error) throw new Error("Could not load entitlement");
  return data;
}
