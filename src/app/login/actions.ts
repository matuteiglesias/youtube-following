"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { endSession, requestMagicLink } from "@/lib/auth-flow";

export async function sendMagicLink(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const status = await requestMagicLink(supabase, formData.get("email"), process.env.APP_URL ?? "");
  if (status === "invalid-email") redirect("/login?error=invalid-email");
  if (status === "failed") redirect("/login?error=send-failed");
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  if (!(await endSession(supabase))) redirect("/?error=signout-failed");
  redirect("/login?signed-out=1");
}
