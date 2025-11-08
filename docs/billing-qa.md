# Billing QA Checklist

> Run this sequence after flipping the Partner app to **App Store** distribution and before disabling `BILLING_TEST`. Keep the app installed on a development store until you are satisfied with the results.

## Pre-flight

- [ ] Confirm the Railway deployment has the latest code and env vars (`SHOPIFY_APP_URL`, `BILLING_*`, `BILLING_ENABLED`).
- [ ] Ensure `BILLING_TEST=true` for development stores; note the value you plan to use in production.
- [ ] Update the Partner app listing (pricing section, free-trial copy) to match the values above.

## Test cases

1. **Fresh install / re-install**
   - Install the app on a development store.
   - Expect to be redirected to the Shopify billing confirmation screen (7-day trial).
   - Accept the charge and confirm the app loads the dashboard without loops.
2. **Cancel subscription**
   - From the dev store’s *Apps > Manage subscription* screen, cancel the plan.
   - Return to the app; it should redirect to the billing confirmation screen again.
3. **Re-accept subscription**
   - Accept the charge once more (still in test mode).
   - Confirm the app behaves normally (entries load, fetchers succeed).
4. **Decline flow (optional)**
   - Repeat the install flow but decline the charge; verify the app blocks access and surfaces a clear message.

## Post-test

- [ ] Leave `BILLING_TEST=true` for development stores; document the value swap (`false`) required in production.
- [ ] Update the support docs / release notes with the plan name, amount, trial length, and expected redirect URL.
- [ ] Once approved, deploy with `BILLING_ENABLED=true` and `BILLING_TEST=false` for production.
