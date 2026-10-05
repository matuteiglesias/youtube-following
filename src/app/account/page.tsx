import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { AccountPlan } from "@/components/account-plan";

export default async function AccountPage() {
  await requireAuthenticatedUser();
  return <AccountPlan />;
}
