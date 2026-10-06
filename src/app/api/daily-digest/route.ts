import { handleDailyDigestGet } from "@/lib/daily-digest-route";
import { listDailyDigestRows } from "@/lib/db";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDailyDigestGet(request, {
    getUser: getAuthenticatedUser,
    loadRows: listDailyDigestRows,
  });
}
