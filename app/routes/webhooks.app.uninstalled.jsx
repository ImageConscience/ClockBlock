/* eslint-env node */

import { authenticate } from "../shopify.server";
import db from "../db.server";

const shouldLogWebhooks =
  process.env.DEBUG_WEBHOOKS === "true" || process.env.NODE_ENV !== "production";
const webhookLog = (...args) => {
  if (shouldLogWebhooks) {
    console.log(...args);
  }
};

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  webhookLog(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
