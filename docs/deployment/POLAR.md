# Polar configuration

D7 expects one Polar product configured as a recurring **USD 3.99 monthly** subscription (399 USD cents, one-month interval). Configure the product with no trial. The application disables trial and checkout discount-code entry, and accepts only the configured product with that exact recurring price/interval; a misconfigured product cannot grant paid access.

Create a least-privilege Polar access token that can create checkout sessions. Configure a webhook endpoint at:

```text
https://<app-host>/api/webhooks/polar
```

Subscribe to the subscription lifecycle events `subscription.created`, `subscription.updated`, `subscription.active`, `subscription.cycled`, `subscription.canceled`, `subscription.uncanceled`, `subscription.past_due`, and `subscription.revoked`. The checkout uses the authenticated Supabase user UUID as Polar's external customer ID; webhook processing requires that ID to be present on the subscription's customer record.

Set these server-side environment variables:

| Variable | Meaning |
| --- | --- |
| `POLAR_ENVIRONMENT` | `sandbox` for provider-supported test deliveries or `production` for live billing. Required in production. |
| `POLAR_ACCESS_TOKEN` | Server-only access token used to create checkouts. |
| `POLAR_PRODUCT_ID` | ID of the one recurring monthly product. |
| `POLAR_WEBHOOK_SECRET` | Signing secret for the configured webhook endpoint. |
| `PAID_FOLLOW_LIMIT` | Server-configured paid follow limit; defaults to `30`. |
| `PAID_GENERATION_MINUTES_LIMIT` | Server-configured paid monthly generation limit; defaults to `600`. |

The access token, product ID, and webhook secret must not use `NEXT_PUBLIC_` names. Keep sandbox credentials/product separate from production values. The webhook accepts only a signature verified by Polar's SDK and only subscriptions for the configured product. Checkout/provider errors are returned as bounded product errors; upstream details are not sent to the browser.
