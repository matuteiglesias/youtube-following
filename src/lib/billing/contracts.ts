export type EntitlementView = {
  plan_code: "paid" | "internal_test" | "none";
  status: "active" | "past_due" | "canceled" | "none";
  follow_limit: number;
  follow_count: number;
  generation_minutes_limit: number;
  generation_minutes_used: number;
  period_start: string | null;
  period_end: string | null;
};

export type BillingEntitlement = Pick<EntitlementView,
  "plan_code" | "status" | "follow_limit" | "generation_minutes_limit" | "period_start" | "period_end"
> & {
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
};
