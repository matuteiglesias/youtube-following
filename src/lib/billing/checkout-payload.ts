export function paidCheckoutPayload(
  config: { productId: string; appUrl: string },
  userId: string,
  email?: string | null,
) {
  return {
    products: [config.productId],
    external_customer_id: userId,
    customer_email: email ?? undefined,
    allow_trial: false,
    allow_discount_codes: false,
    success_url: `${config.appUrl}/?billing=success`,
    return_url: `${config.appUrl}/`,
    metadata: { app_user_id: userId, plan_code: "paid" },
  };
}
