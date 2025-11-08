const BILLING_ENABLED = process.env.BILLING_ENABLED !== "false";
const PLAN_NAME = process.env.BILLING_PLAN_NAME || "ClockBlock Pro";
const RAW_AMOUNT = process.env.BILLING_PRICE ?? "9.99";
const AMOUNT = Number.parseFloat(RAW_AMOUNT);
const CURRENCY_CODE = (process.env.BILLING_CURRENCY || "USD").toUpperCase();
const INTERVAL = (process.env.BILLING_INTERVAL || "EVERY_30_DAYS").toUpperCase();
const TRIAL_DAYS = Number.parseInt(process.env.BILLING_TRIAL_DAYS ?? "7", 10);
const TEST_MODE = process.env.BILLING_TEST === "true" || process.env.NODE_ENV !== "production";
const APP_BASE_URL = process.env.BILLING_RETURN_URL || process.env.SHOPIFY_APP_URL;
const RETURN_URL = APP_BASE_URL ? new URL("/app/clockblock", APP_BASE_URL).toString() : null;

const CHECK_SUBSCRIPTION_QUERY = `#graphql
  query CheckClockBlockSubscription {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                interval
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_SUBSCRIPTION_MUTATION = `#graphql
  mutation CreateClockBlockSubscription(
    $name: String!
    $trialDays: Int
    $amount: Decimal!
    $currencyCode: CurrencyCode!
    $interval: AppPricingInterval!
    $returnUrl: URL!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      trialDays: $trialDays
      returnUrl: $returnUrl
      test: $test
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              interval: $interval
              price: { amount: $amount, currencyCode: $currencyCode }
            }
          }
        }
      ]
    ) {
      appSubscription {
        id
        name
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

const isBillingConfigured =
  BILLING_ENABLED &&
  Number.isFinite(AMOUNT) &&
  AMOUNT > 0 &&
  typeof PLAN_NAME === "string" &&
  PLAN_NAME.length > 0 &&
  RETURN_URL;

const APP_BRIDGE_REDIRECT_HEADER = "X-Shopify-App-Bridge-Redirect";
const APP_BRIDGE_REDIRECT_URL_HEADER = "X-Shopify-App-Bridge-Redirect-Url";

export function createAppBridgeRedirect(confirmationUrl) {
  return new Response(JSON.stringify({ redirectUrl: confirmationUrl }), {
    status: 200,
    headers: {
      [APP_BRIDGE_REDIRECT_HEADER]: "1",
      [APP_BRIDGE_REDIRECT_URL_HEADER]: confirmationUrl,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function ensureActiveSubscription(admin) {
  console.log("[billing] ensureActiveSubscription called");
  if (!isBillingConfigured) {
    if (BILLING_ENABLED) {
      console.warn(
        "[billing] Billing is enabled but configuration is incomplete. Skipping billing enforcement.",
      );
    }
    return null;
  }

  try {
    const response = await admin.graphql(CHECK_SUBSCRIPTION_QUERY);
    const json = await response.json();

    console.log(
      "[billing] Active subscription check result:",
      JSON.stringify(json?.data?.currentAppInstallation?.activeSubscriptions || [], null, 2),
    );

    if (json?.errors?.length) {
      const message = json.errors.map((error) => error.message).join(", ");
      throw new Error(`[billing] Failed to check active subscriptions: ${message}`);
    }

    const activeSubscriptions =
      json?.data?.currentAppInstallation?.activeSubscriptions?.filter(Boolean) ?? [];

    const hasActive = activeSubscriptions.some((subscription) => {
      if (subscription.name !== PLAN_NAME) {
        return false;
      }
      if (subscription.status !== "ACTIVE") {
        return false;
      }
      const pricingDetails =
        subscription.lineItems?.[0]?.plan?.pricingDetails?.price ?? null;
      if (!pricingDetails) {
        return true;
      }

      const amountMatches = Number.parseFloat(pricingDetails.amount) === AMOUNT;
      const currencyMatches = pricingDetails.currencyCode === CURRENCY_CODE;
      return amountMatches && currencyMatches;
    });

    if (hasActive) {
      return null;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Apps without a public distribution cannot use the Billing API")
    ) {
      console.warn("[billing] App is not public yet; disabling billing enforcement.");
      return null;
    }
    console.error("[billing] Error while checking subscription:", error);
    throw error;
  }

  try {
    const creationResponse = await admin.graphql(CREATE_SUBSCRIPTION_MUTATION, {
      variables: {
        name: PLAN_NAME,
        trialDays: Number.isFinite(TRIAL_DAYS) && TRIAL_DAYS > 0 ? TRIAL_DAYS : null,
        amount: AMOUNT.toFixed(2),
        currencyCode: CURRENCY_CODE,
        interval: INTERVAL,
        returnUrl: RETURN_URL,
        test: TEST_MODE,
      },
    });
    const creationJson = await creationResponse.json();
    console.log("[billing] Subscription creation response:", JSON.stringify(creationJson, null, 2));

    if (creationJson?.errors?.length) {
      const message = creationJson.errors.map((error) => error.message).join(", ");
      throw new Error(`[billing] Failed to create subscription: ${message}`);
    }

    const userErrors =
      creationJson?.data?.appSubscriptionCreate?.userErrors?.filter(Boolean) ?? [];
    if (userErrors.length > 0) {
      const message = userErrors.map((error) => error.message).join(", ");
      if (
        message.includes("Apps without a public distribution cannot use the Billing API")
      ) {
        console.warn("[billing] App is not yet public; skipping billing enforcement.");
        return null;
      }
      throw new Error(`[billing] Subscription creation returned user errors: ${message}`);
    }

    const confirmationUrl = creationJson?.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
      throw new Error("[billing] Missing confirmation URL from appSubscriptionCreate.");
    }

    console.log("[billing] Returning confirmation URL:", confirmationUrl);
    return confirmationUrl;
  } catch (error) {
    console.error("[billing] Error while creating subscription:", error);
    if (
      error instanceof Error &&
      error.message.includes("Apps without a public distribution cannot use the Billing API")
    ) {
      console.warn("[billing] App is not public yet; skipping billing enforcement.");
      return null;
    }
    throw error;
  }
}

