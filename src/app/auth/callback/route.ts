import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth-flow";

function appOrigin() {
  const configured = process.env.APP_URL;
  if (!configured) throw new Error("Missing required environment variable: APP_URL");
  return new URL(configured).origin;
}

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=callback-failed", origin));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=callback-failed", origin));

  return NextResponse.redirect(new URL(safeNextPath(request.nextUrl.searchParams.get("next")), origin));
}
