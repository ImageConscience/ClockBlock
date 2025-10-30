import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    // Run after the shop installs or reauthenticates; ensure our metaobject definition exists
    afterAuth: async ({ admin }) => {
      // Define the metaobject type and fields for ShopSchedulr
      const type = "schedulable_entity";

      // Check if the definition already exists
      const checkResponse = await admin.graphql(
        `#graphql
        query($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
          }
        }
      `,
        {
          variables: { type },
        },
      );
      const checkJson = await checkResponse.json();
      const exists = Boolean(checkJson?.data?.metaobjectDefinitionByType?.id);

      if (!exists) {
        // Create the metaobject definition with required fields
        await admin.graphql(
          `#graphql
          mutation CreateSchedulableEntityDefinition($definition: MetaobjectDefinitionCreateInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              metaobjectDefinition { id type name }
              userErrors { field message }
            }
          }
        `,
          {
            variables: {
              definition: {
                type,
                name: "Schedulable Entity",
                fieldDefinitions: [
                  {
                    name: "Position ID",
                    key: "position_id",
                    type: "single_line_text_field",
                    required: true,
                  },
                  {
                    name: "Start At",
                    key: "start_at",
                    type: "date_time",
                    required: false,
                  },
                  {
                    name: "End At",
                    key: "end_at",
                    type: "date_time",
                    required: false,
                  },
                  {
                    name: "Title",
                    key: "title",
                    type: "single_line_text_field",
                    required: false,
                  },
                  {
                    name: "Content",
                    key: "content",
                    type: "rich_text",
                    required: false,
                  },
                  {
                    name: "Description",
                    key: "description",
                    type: "single_line_text_field",
                    required: false,
                  },
                ],
                access: { storefront: "PUBLIC_READ" },
              },
            },
          },
        );
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
