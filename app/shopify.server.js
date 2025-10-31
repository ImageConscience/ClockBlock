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
      console.log(`[afterAuth] Hook called - starting metaobject definition check/create`);
      try {
        // Define the metaobject type and fields for ShopSchedulr
        const type = "schedulable_entity";

        console.log(`[afterAuth] Checking for metaobject definition: ${type}`);

        // Check if the definition already exists
        let checkResponse;
        let checkJson;
        try {
          checkResponse = await admin.graphql(
            `#graphql
            query($type: String!) {
              metaobjectDefinitionByType(type: $type) {
                id
                type
                name
                fieldDefinitions {
                  key
                  type { name }
                  name
                  required
                }
              }
            }
          `,
            {
              variables: { type },
            },
          );
          checkJson = await checkResponse.json();
          console.log(`[afterAuth] Check response:`, JSON.stringify(checkJson, null, 2));
        } catch (checkError) {
          console.error(`[afterAuth] Error checking metaobject definition:`, checkError);
          // If the query fails, assume it doesn't exist and try to create
          checkJson = { data: { metaobjectDefinitionByType: null } };
        }
        
        const exists = Boolean(checkJson?.data?.metaobjectDefinitionByType?.id);

        if (exists) {
          const def = checkJson.data.metaobjectDefinitionByType;
          console.log(`[afterAuth] Metaobject definition already exists: ${def.id}`);
          try {
            const contentField = def.fieldDefinitions?.find((f) => f.key === "content");
            const typeName = String(contentField?.type?.name || "").toLowerCase();
            if (typeName.includes("rich_text")) {
              console.log(`[afterAuth] Updating 'content' field type from rich_text_field to multi_line_text_field`);
              const updateResponse = await admin.graphql(
                `#graphql
                mutation UpdateSchedulableEntityDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
                  metaobjectDefinitionUpdate(id: $id, definition: $definition) {
                    metaobjectDefinition { id }
                    userErrors { field message }
                  }
                }
              `,
                {
                  variables: {
                    id: def.id,
                    definition: {
                      fieldDefinitions: [
                        {
                          key: "content",
                          name: "Content",
                          type: "multi_line_text_field",
                          required: false,
                        },
                      ],
                    },
                  },
                },
              );
              const updateJson = await updateResponse.json();
              console.log(`[afterAuth] Update response:`, JSON.stringify(updateJson, null, 2));
              if (updateJson?.data?.metaobjectDefinitionUpdate?.userErrors?.length) {
                console.error(
                  `[afterAuth] Failed to update definition: `,
                  updateJson.data.metaobjectDefinitionUpdate.userErrors
                    .map((e) => `${e.field}: ${e.message}`)
                    .join(", "),
                );
              }
            }
          } catch (updateError) {
            console.error(`[afterAuth] Error updating existing definition:`, updateError);
          }
          return;
        }

        console.log(`[afterAuth] Metaobject definition not found, creating...`);

        // Create the metaobject definition with required fields
        let createResponse;
        try {
          createResponse = await admin.graphql(
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
                    name: "Title",
                    key: "title",
                    type: "single_line_text_field",
                    required: false,
                  },
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
                    name: "Content",
                    key: "content",
                    type: "multi_line_text_field",
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
                capabilities: {
                  publishable: {
                    enabled: true,
                  },
                  onlineStore: {
                    enabled: true,
                  },
                },
              },
            },
          },
        );
        } catch (createError) {
          console.error(`[afterAuth] Error calling metaobjectDefinitionCreate:`, createError);
          throw createError;
        }
        
        const createJson = await createResponse.json();
        console.log(`[afterAuth] Create response:`, JSON.stringify(createJson, null, 2));

        if (createJson?.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
          const errors = createJson.data.metaobjectDefinitionCreate.userErrors
            .map((e) => `${e.field}: ${e.message}`)
            .join(", ");
          console.error(`[afterAuth] Failed to create metaobject definition: ${errors}`);
          throw new Error(`Failed to create metaobject definition: ${errors}`);
        }

        if (createJson?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id) {
          console.log(`[afterAuth] Successfully created metaobject definition: ${createJson.data.metaobjectDefinitionCreate.metaobjectDefinition.id}`);
        } else {
          console.error(`[afterAuth] Unexpected response format:`, createJson);
        }
      } catch (error) {
        console.error(`[afterAuth] Error in afterAuth hook:`, error);
        // Don't throw - we don't want to block installation
        // The metaobject can be created manually if needed
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
