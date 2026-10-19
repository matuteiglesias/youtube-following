import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { AccountPlan } from "@/components/account-plan";
import { activateFirstUserTrial } from "./pilot/actions";
import { getEntitlement } from "@/lib/db";

export default async function AccountPage() {
  const user = await requireAuthenticatedUser();
  const entitlement = await getEntitlement(user.id);
  const trialActive = entitlement?.plan_code === "internal_test" && entitlement.status === "active";
  const isPilotOwner = !!process.env.PILOT_TRIAL_EMAIL
    && typeof user.email === "string"
    && user.email.trim().toLowerCase() === process.env.PILOT_TRIAL_EMAIL.trim().toLowerCase();
  return <><AccountPlan />
    {isPilotOwner ? <section className="account-plan" aria-label="First-user trial">
      <h2>First-user summary trial</h2>
      <p>Activate 240 minutes of new AI summaries for this account, once. Existing
        cached summaries remain free to read. This does not enable recurring billing.</p>
      {trialActive ? <p role="status">Your first-user trial is active. Select a completed public video in the Feed to generate a summary.</p>
        : <form action={activateFirstUserTrial}><button type="submit">Activate trial</button></form>}
    </section> : null}
    <div className="account-plan"><p><Link href="/account/password">Set or change your login password</Link></p></div>
  </>;
}
