import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { AccountPlan } from "@/components/account-plan";

export default async function AccountPage() {
  await requireAuthenticatedUser();
  return <><AccountPlan /><div className="account-plan"><p><Link href="/account/password">Set or change your login password</Link></p></div></>;
}
