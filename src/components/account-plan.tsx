"use client";

import { useEffect, useState } from "react";

type Entitlement = {
  plan_code: "paid" | "internal_test" | "none";
  status: "active" | "past_due" | "canceled" | "none";
  follow_limit: number;
  follow_count: number;
  generation_minutes_limit: number;
  generation_minutes_used: number;
  period_start: string | null;
  period_end: string | null;
};

const ACCOUNT_UNAVAILABLE = "Account details are temporarily unavailable. Try again shortly.";
const CHECKOUT_UNAVAILABLE = "Checkout is temporarily unavailable. Your account hasn’t been changed.";

export function EntitlementSummary({ entitlement }: { entitlement: Entitlement }) {
  return <div className="entitlement-card" aria-label="Current entitlement">
    <h2>{entitlement.plan_code === "paid" ? "Paid plan" : entitlement.plan_code === "internal_test" ? "Internal test plan" : "No active plan"}</h2>
    <p>Status: {entitlement.status.replaceAll("_", " ")}</p>
    <p>Channels: {entitlement.follow_count} / {entitlement.follow_limit}</p>
    <p>New summaries: {entitlement.generation_minutes_used} / {entitlement.generation_minutes_limit} minutes this period</p>
    {entitlement.period_end ? <p>Current period ends {new Date(entitlement.period_end).toLocaleDateString()}</p> : null}
  </div>;
}

export function AccountPlan() {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/me/entitlement", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as Entitlement;
      if (active) setEntitlement(data);
    }).catch(() => {
      if (active) setError(ACCOUNT_UNAVAILABLE);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function startCheckout() {
    setCheckoutBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = await response.json() as { checkout_url?: unknown };
      if (!response.ok || typeof body.checkout_url !== "string" || !/^https:\/\//.test(body.checkout_url)) throw new Error("unavailable");
      window.location.assign(body.checkout_url);
    } catch {
      setError(CHECKOUT_UNAVAILABLE);
      setCheckoutBusy(false);
    }
  }

  return <section className="account-plan" aria-labelledby="account-heading">
    <p className="placeholder__label">Account</p>
    <h1 id="account-heading">Plan and limits</h1>
    {loading ? <p role="status">Loading account details…</p> : null}
    {error ? <p className="feed-error" role="alert">{error}</p> : null}
    {entitlement ? <EntitlementSummary entitlement={entitlement} /> : null}
    <div className="pricing-card">
      <h2>YouTube Following · $3.99/month</h2>
      <p>Follow up to 30 channels and generate up to 600 minutes of new summaries per month. Cached summaries don’t use your allowance.</p>
      <button type="button" onClick={startCheckout} disabled={checkoutBusy || entitlement?.plan_code === "paid" && entitlement.status === "active"}>
        {checkoutBusy ? "Opening checkout…" : entitlement?.plan_code === "paid" && entitlement.status === "active" ? "Plan active" : "Choose this plan"}
      </button>
    </div>
  </section>;
}
