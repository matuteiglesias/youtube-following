"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestPasswordUpdate } from "@/lib/auth-flow";

export async function setMyPassword(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const status = await requestPasswordUpdate(supabase, formData.get("password"));
  if (status === "weak-password") redirect("/account/password?error=weak-password");
  if (status !== "updated") redirect("/account/password?error=update-failed");
  redirect("/account/password?updated=1");
}
