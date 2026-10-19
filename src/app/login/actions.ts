"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { endSession, requestMagicLink, requestPasswordSignIn, requestPasswordRegistration } from "@/lib/auth-flow";

export async function sendMagicLink(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const status = await requestMagicLink(supabase, formData.get("email"), process.env.APP_URL ?? "");
  if (status === "invalid-email") redirect("/login?error=invalid-email");
  if (status === "failed") redirect("/login?error=send-failed");
  redirect("/login?sent=1");
}

export async function signInWithPassword(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const status = await requestPasswordSignIn(
    supabase,
    formData.get("identifier"),
    formData.get("password"),
    process.env.PILOT_DEMO_EMAIL,
  );
  if (status !== "signed-in") redirect("/login?error=invalid-credentials");
  redirect("/");
}

export async function createPasswordAccount(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const status = await requestPasswordRegistration(
    supabase, formData.get("email"), formData.get("password"), process.env.APP_URL ?? "",
  );
  if (status === "invalid-email") redirect("/login?error=invalid-email");
  if (status === "weak-password") redirect("/login?error=weak-password");
  if (status === "failed") redirect("/login?error=signup-failed");
  if (status === "check-email") redirect("/login?registered=1");
  redirect("/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  if (!(await endSession(supabase))) redirect("/?error=signout-failed");
  redirect("/login?signed-out=1");
}
