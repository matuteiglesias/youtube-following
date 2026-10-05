import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { FollowingPlaceholder } from "@/components/following-placeholder";

export default async function FollowingPage() {
  await requireAuthenticatedUser();
  return <FollowingPlaceholder />;
}
