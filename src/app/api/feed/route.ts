import { listFeedRows } from "@/lib/db";
import { handleFeedGet } from "@/lib/feed-route";
import { getAuthenticatedUser } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleFeedGet(request, {
    getUser: getAuthenticatedUser,
    loadRows: listFeedRows,
  });
}
