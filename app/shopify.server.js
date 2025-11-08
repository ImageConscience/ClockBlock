import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const isDevEnvironment = process.env.NODE_ENV !== "production";
const shouldDebugAfterAuth =
  process.env.DEBUG_AFTER_AUTH === "true" || isDevEnvironment;
const afterAuthInfo = (...args) => {
  if (shouldDebugAfterAuth) {
    console.log(...args);
  }
};
const afterAuthWarn = (...args) => {
  if (shouldDebugAfterAuth) {
    console.warn(...args);
  }
};
const afterAuthError = (...args) => {
  console.error(...args);
};

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January26,
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
      afterAuthInfo(
        `[afterAuth] Hook called - starting metaobject definition check/create`,
      );
      try {
        // Define the metaobject type and fields for ClockBlock
        const type = "schedulable_entity";

        afterAuthInfo(
          `[afterAuth] Checking for metaobject definition: ${type}`,
        );

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
          afterAuthInfo(
            `[afterAuth] Check response:`,
            JSON.stringify(checkJson, null, 2),
          );
        } catch (checkError) {
          afterAuthWarn(
            `[afterAuth] Error checking metaobject definition:`,
            checkError,
          );
          // If the query fails, assume it doesn't exist and try to create
          checkJson = { data: { metaobjectDefinitionByType: null } };
        }
        
        const exists = Boolean(checkJson?.data?.metaobjectDefinitionByType?.id);

        if (exists) {
          const def = checkJson.data.metaobjectDefinitionByType;
          afterAuthInfo(
            `[afterAuth] Metaobject definition already exists: ${def.id}`,
          );
          try {
            // Check if we need to update capabilities (onlineStore and renderable)
            afterAuthInfo(
              `[afterAuth] Attempting to enable onlineStore and renderable capabilities if not already enabled`,
            );
            const updateResponse = await admin.graphql(
              `#graphql
              mutation UpdateSchedulableEntityDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
                metaobjectDefinitionUpdate(id: $id, definition: $definition) {
                  metaobjectDefinition { 
                    id 
                    capabilities {
                      publishable { enabled }
                      onlineStore { enabled }
                      renderable { enabled }
                    }
                  }
                  userErrors { field message }
                }
              }
            `,
              {
                variables: {
                  id: def.id,
                  definition: {
                    capabilities: {
                      onlineStore: {
                        enabled: true,
                        data: {
                          urlHandle: "schedulable-entity",
                        },
                      },
                      renderable: {
                        enabled: true,
                        data: {
                          metaTitleKey: "title",
                          metaDescriptionKey: "description",
                        },
                      },
                    },
                  },
                },
              },
            );
            const updateJson = await updateResponse.json();
            afterAuthInfo(
              `[afterAuth] Update capabilities response:`,
              JSON.stringify(updateJson, null, 2),
            );
            if (updateJson?.data?.metaobjectDefinitionUpdate?.userErrors?.length) {
              afterAuthWarn(
                `[afterAuth] Could not update capabilities: `,
                updateJson.data.metaobjectDefinitionUpdate.userErrors
                  .map((e) => `${e.field}: ${e.message}`)
                  .join(", "),
              );
            } else {
              afterAuthInfo(
                `[afterAuth] Successfully updated onlineStore and renderable capabilities`,
              );
            }
            
          } catch (updateError) {
            afterAuthWarn(
              `[afterAuth] Error updating existing definition:`,
              updateError,
            );
          }
          return;
        }

        afterAuthInfo(`[afterAuth] Metaobject definition not found, creating...`);

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
                    required: true,
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
                    name: "Description",
                    key: "description",
                    type: "single_line_text_field",
                    required: false,
                  },
                  {
                    name: "Desktop Banner",
                    key: "desktop_banner",
                    type: "file_reference",
                    required: false,
                  },
                  {
                    name: "Mobile Banner",
                    key: "mobile_banner",
                    type: "file_reference",
                    required: false,
                  },
                  {
                    name: "Target URL",
                    key: "target_url",
                    type: "url",
                    required: false,
                  },
                  {
                    name: "Headline",
                    key: "headline",
                    type: "single_line_text_field",
                    required: false,
                  },
                  {
                    name: "Button Text",
                    key: "button_text",
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
                    data: {
                      urlHandle: "schedulable-entity",
                    },
                  },
                  renderable: {
                    enabled: true,
                    data: {
                      metaTitleKey: "title",
                      metaDescriptionKey: "description",
                    },
                  },
                },
              },
            },
          },
        );
        } catch (createError) {
          afterAuthWarn(
            `[afterAuth] Error calling metaobjectDefinitionCreate:`,
            createError,
          );
          throw createError;
        }
        
        const createJson = await createResponse.json();
        afterAuthInfo(
          `[afterAuth] Create response:`,
          JSON.stringify(createJson, null, 2),
        );

        if (createJson?.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
          const errors = createJson.data.metaobjectDefinitionCreate.userErrors
            .map((e) => `${e.field}: ${e.message}`)
            .join(", ");
          afterAuthWarn(
            `[afterAuth] Failed to create metaobject definition: ${errors}`,
          );
          throw new Error(`Failed to create metaobject definition: ${errors}`);
        }

        if (createJson?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id) {
          afterAuthInfo(
            `[afterAuth] Successfully created metaobject definition: ${createJson.data.metaobjectDefinitionCreate.metaobjectDefinition.id}`,
          );
        } else {
          afterAuthWarn(`[afterAuth] Unexpected response format:`, createJson);
        }
      } catch (error) {
        afterAuthError(`[afterAuth] Error in afterAuth hook:`, error);
        // Don't throw - we don't want to block installation
        // The metaobject can be created manually if needed
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.January26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
