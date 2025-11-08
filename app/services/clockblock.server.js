import { Buffer } from "buffer";
import { authenticate } from "../shopify.server";
import {
  createAppBridgeRedirect,
  ensureActiveSubscription,
} from "../utils/billing.server";
import { parseLocalDateTimeToUTC, getDefaultDateBounds } from "../utils/datetime";
import { json } from "../utils/responses.server";

const isDevEnvironment = process.env.NODE_ENV !== "production";
const debugLog = (...args) => {
  if (isDevEnvironment) {
    console.log(...args);
  }
};
const debugWarn = (...args) => {
  if (isDevEnvironment) {
    console.warn(...args);
  }
};
// createRequire no longer needed - removed form-data package

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const confirmationUrl = await ensureActiveSubscription(admin);
  if (confirmationUrl) {
    throw createAppBridgeRedirect(confirmationUrl);
  }

  try {
    const response = await admin.graphql(
      `#graphql
      query ListSchedulableEntities($first: Int!) {
        metaobjects(type: "schedulable_entity", first: $first) {
          nodes {
            id
            handle
            fields {
              key
              value
              reference {
                ... on MediaImage {
                  id
                  image {
                    url
                  }
                }
              }
            }
            capabilities {
              publishable {
                status
              }
            }
            updatedAt
          }
        }
      }
    `,
      { variables: { first: 50 } },
    );
    const jsonResponse = await response.json();

    debugLog("Loader GraphQL response:", JSON.stringify(jsonResponse, null, 2));

    // Check for GraphQL errors
    if (jsonResponse?.errors) {
      console.error("GraphQL errors in loader:", JSON.stringify(jsonResponse.errors, null, 2));
      // If the error is about the type not existing, return empty array
      const errorMessages = jsonResponse.errors.map((e) => e.message).join(", ");
      if (errorMessages.includes("metaobject definition") || errorMessages.includes("type")) {
        debugWarn("Metaobject definition may not exist yet. Returning empty entries.");
        return { entries: [], error: "Metaobject definition not found. Please ensure the app has been properly installed." };
      }
      throw new Error(`GraphQL error: ${errorMessages}`);
    }

    const entries = jsonResponse?.data?.metaobjects?.nodes ?? [];
    
    // Fetch media files for picker
    let mediaFiles = [];
    try {
      const filesResponse = await admin.graphql(
        `#graphql
        query GetMediaFiles($first: Int!) {
          files(first: $first, query: "media_type:image") {
            edges {
              node {
                id
                createdAt
                ... on MediaImage {
                  alt
                  image {
                    url
                    width
                    height
                  }
                }
              }
            }
          }
        }
      `,
        { variables: { first: 250 } },
      );
      const filesJson = await filesResponse.json();
      mediaFiles = filesJson?.data?.files?.edges?.map((edge) => ({
        id: edge.node.id,
        url: edge.node.image?.url || "",
        alt: edge.node.alt || "",
        createdAt: edge.node.createdAt,
      })) || [];
      // Sort by newest first (already sorted by GraphQL query, but ensure it here too)
      mediaFiles.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime(); // Newest first
      });
    } catch (error) {
      console.error("Error loading media files:", error);
    }
    
    return { entries, mediaFiles };
  } catch (error) {
    console.error("Error loading schedulable entities:", error);
    return { 
      entries: [], 
      error: `Failed to load entries: ${error.message}` 
    };
  }
};

export const action = async ({ request }) => {
  // Wrap everything in try-catch to ensure we always return JSON
  try {
    debugLog("[ACTION] ========== ACTION CALLED ==========");
    debugLog("[ACTION] Request URL:", request.url);
    debugLog("[ACTION] Request method:", request.method);
    debugLog("[ACTION] Content-Type:", request.headers.get("content-type"));
    debugLog("[ACTION] Accept header:", request.headers.get("accept"));
    debugLog("[ACTION] X-Requested-With:", request.headers.get("x-requested-with"));
    
    // Check if this is a fetcher request (from useFetcher)
    // Fetcher requests typically have Accept: */* or similar, not text/html
    const acceptHeader = request.headers.get("accept") || "";
    const isFetcherRequest = acceptHeader.includes("*/*") || acceptHeader.includes("application/json") || !acceptHeader.includes("text/html");
    debugLog("[ACTION] Is fetcher request:", isFetcherRequest);
    
    // Check if this is a JSON request (for update/delete)
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { admin } = await authenticate.admin(request);
      const confirmationUrl = await ensureActiveSubscription(admin);
      if (confirmationUrl) {
        return createAppBridgeRedirect(confirmationUrl);
      }
      
      if (body.intent === "delete") {
        debugLog("[ACTION] Processing delete request for entry:", body.id);
        const deleteResponse = await admin.graphql(
          `#graphql
          mutation DeleteSchedulableEntity($id: ID!) {
            metaobjectDelete(id: $id) {
              deletedId
              userErrors {
                field
                message
              }
            }
          }
        `,
          { variables: { id: body.id } }
        );
        
        const deleteJson = await deleteResponse.json();
        
        if (deleteJson?.errors) {
          const errors = deleteJson.errors.map((e) => e.message).join(", ");
          console.error("[ACTION] GraphQL errors deleting entry:", errors);
          return json({ error: `Failed to delete entry: ${errors}`, success: false });
        }
        
        if (deleteJson?.data?.metaobjectDelete?.userErrors?.length > 0) {
          const errors = deleteJson.data.metaobjectDelete.userErrors
            .map((e) => e.message)
            .join(", ");
          console.error("[ACTION] User errors deleting entry:", errors);
          return json({ error: `Failed to delete entry: ${errors}`, success: false });
        }
        
        debugLog("[ACTION] Entry deleted successfully");
        return json({ success: true, message: "Entry deleted successfully!" });
      }
      
      if (body.intent === "update") {
        debugLog("[ACTION] Processing update request for entry:", body.id);
        
        const fields = [];
        const userTimeZone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null;
        const rawOffset = body.timezoneOffset ?? body.timezone_offset;
        const userTimezoneOffsetForUpdate =
          rawOffset !== undefined && rawOffset !== null && rawOffset !== "" && !Number.isNaN(Number(rawOffset))
            ? Number(rawOffset)
            : undefined;

        if (body.title) fields.push({ key: "title", value: body.title });
        if (body.positionId) fields.push({ key: "position_id", value: body.positionId });
        if (body.headline !== undefined) fields.push({ key: "headline", value: body.headline || "" });
        if (body.description !== undefined) fields.push({ key: "description", value: body.description || "" });

        if (body.startAt !== undefined) {
          if (body.startAt) {
            const formattedStart = parseLocalDateTimeToUTC(body.startAt, userTimeZone, userTimezoneOffsetForUpdate);
            if (!formattedStart) {
              return json({ error: "Invalid Start Date format. Please ensure the date is valid.", success: false });
            }
            fields.push({ key: "start_at", value: formattedStart });
          } else {
            const defaults = getDefaultDateBounds(userTimeZone, userTimezoneOffsetForUpdate);
            fields.push({ key: "start_at", value: defaults.start });
          }
        }

        if (body.endAt !== undefined) {
          if (body.endAt) {
            const formattedEnd = parseLocalDateTimeToUTC(body.endAt, userTimeZone, userTimezoneOffsetForUpdate);
            if (!formattedEnd) {
              return json({ error: "Invalid End Date format. Please ensure the date is valid.", success: false });
            }
            fields.push({ key: "end_at", value: formattedEnd });
          } else {
            const defaults = getDefaultDateBounds(userTimeZone, userTimezoneOffsetForUpdate);
            fields.push({ key: "end_at", value: defaults.end });
          }
        }

        if (body.desktopBanner) fields.push({ key: "desktop_banner", value: body.desktopBanner });
        if (body.mobileBanner) fields.push({ key: "mobile_banner", value: body.mobileBanner });
        if (body.targetUrl !== undefined) fields.push({ key: "target_url", value: body.targetUrl || "" });
        if (body.buttonText !== undefined) fields.push({ key: "button_text", value: body.buttonText || "" });
        
        const updateResponse = await admin.graphql(
          `#graphql
          mutation UpdateSchedulableEntity($id: ID!, $metaobject: MetaobjectUpdateInput!) {
            metaobjectUpdate(id: $id, metaobject: $metaobject) {
              metaobject { id handle }
              userErrors {
                field
                message
              }
            }
          }
        `,
          {
            variables: {
              id: body.id,
              metaobject: {
                fields,
              },
            },
          }
        );
        
        const updateJson = await updateResponse.json();
        
        if (updateJson?.errors) {
          const errors = updateJson.errors.map((e) => e.message).join(", ");
          console.error("[ACTION] GraphQL errors updating entry:", errors);
          return json({ error: `Failed to update entry: ${errors}`, success: false });
        }
        
        if (updateJson?.data?.metaobjectUpdate?.userErrors?.length > 0) {
          const errors = updateJson.data.metaobjectUpdate.userErrors
            .map((e) => e.message)
            .join(", ");
          console.error("[ACTION] User errors updating entry:", errors);
          return json({ error: `Failed to update entry: ${errors}`, success: false });
        }
        
        debugLog("[ACTION] Entry updated successfully");
        return json({ success: true, message: "Entry updated successfully!" });
      }
      
      if (body.intent === "toggleStatus") {
        debugLog("[ACTION] Processing toggle status request for entry:", body.id, "to status:", body.status);
        
        const toggleResponse = await admin.graphql(
          `#graphql
          mutation ToggleEntryStatus($id: ID!, $metaobject: MetaobjectUpdateInput!) {
            metaobjectUpdate(id: $id, metaobject: $metaobject) {
              metaobject { 
                id 
                handle
                capabilities {
                  publishable {
                    status
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
          {
            variables: {
              id: body.id,
              metaobject: {
                capabilities: {
                  publishable: {
                    status: body.status,
                  },
                },
              },
            },
          }
        );
        
        const toggleJson = await toggleResponse.json();
        
        if (toggleJson?.errors) {
          const errors = toggleJson.errors.map((e) => e.message).join(", ");
          console.error("[ACTION] GraphQL errors toggling status:", errors);
          return json({ error: `Failed to toggle status: ${errors}`, success: false });
        }
        
        if (toggleJson?.data?.metaobjectUpdate?.userErrors?.length > 0) {
          const errors = toggleJson.data.metaobjectUpdate.userErrors
            .map((e) => e.message)
            .join(", ");
          console.error("[ACTION] User errors toggling status:", errors);
          return json({ error: `Failed to toggle status: ${errors}`, success: false });
        }
        
        debugLog("[ACTION] Status toggled successfully");
        return json({ success: true, message: "Status updated successfully!" });
      }
    }
    
    const formData = await request.formData();
    debugLog("[ACTION] FormData received, checking contents...");
    
    // Log all formData keys to debug
    const formDataKeys = [];
    for (const [key, value] of formData.entries()) {
      formDataKeys.push(key);
      debugLog("[ACTION] FormData key:", key, "value type:", value instanceof File ? "File" : typeof value, value instanceof File ? `(${value.name}, ${value.size} bytes)` : "");
    }
    debugLog("[ACTION] All formData keys:", formDataKeys);
    
    // Check if this is a file upload request (has file but no title/position_id)
    const file = formData.get("file");
    const hasTitle = formData.get("title");
    
    debugLog("[ACTION] File present:", !!file, "Has title:", !!hasTitle, "File type:", file instanceof File ? file.type : typeof file);
    
    const { admin } = await authenticate.admin(request);
    const formBillingRedirect = await ensureActiveSubscription(admin);
    if (formBillingRedirect) {
      return createAppBridgeRedirect(formBillingRedirect);
    }
    
    if (file && !hasTitle) {
    debugLog("[ACTION] Detected file upload request - using official Shopify staged upload method");
    try {
      debugLog("[ACTION] Admin authenticated successfully for file upload");
      
      if (!file) {
        return json({ error: "No file provided", success: false });
      }
      
      // Validate file
      if (typeof file === "string") {
        return json({ 
          error: "File upload failed: File object not received.", 
          success: false 
        });
      }
      
      const isFileLike = file instanceof File || 
                        file instanceof Blob || 
                        (typeof file === "object" && file !== null && 
                         (typeof file.arrayBuffer === "function" ||
                          typeof file.stream === "function"));
      
      if (!isFileLike) {
        return json({ error: `Invalid file format. Received: ${typeof file}`, success: false });
      }
      
      const fileName = file.name || `upload-${Date.now()}.jpg`;
      const fileType = file.type || "image/jpeg";
      const fileSize = file.size || 0;
      
      debugLog("[ACTION] File:", fileName, "Type:", fileType, "Size:", fileSize, "bytes");
      
      // Convert file to Buffer for upload
      let arrayBuffer;
      if (typeof file.arrayBuffer === "function") {
        arrayBuffer = await file.arrayBuffer();
      } else if (typeof file.stream === "function") {
        const stream = file.stream();
        const chunks = [];
        const reader = stream.getReader();
        let readerDone = false;
        while (!readerDone) {
          const { done, value } = await reader.read();
          readerDone = done;
          if (!done && value) {
            chunks.push(value);
          }
        }
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        arrayBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          arrayBuffer.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        return json({ error: "File object doesn't support reading", success: false });
      }
      const fileBuffer = Buffer.from(arrayBuffer);
      
      // Step 1: Create staged upload target using official Shopify method
      debugLog("[ACTION] Step 1: Creating staged upload target...");
      const stagedUploadResponse = await admin.graphql(
        `#graphql
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              url
              resourceUrl
              parameters {
                name
                value
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            input: [
              {
                filename: fileName,
                mimeType: fileType,
                resource: "IMAGE",
                httpMethod: "POST",
              },
            ],
          },
        }
      );
      
      const stagedUploadJson = await stagedUploadResponse.json();
      debugLog("[ACTION] Staged upload response received");
      
      if (stagedUploadJson?.errors) {
        const errors = stagedUploadJson.errors.map((e) => e.message).join(", ");
        console.error("[ACTION] GraphQL errors creating staged upload:", errors);
        return json({ error: `Failed to create staged upload: ${errors}`, success: false });
      }
      
      if (stagedUploadJson?.data?.stagedUploadsCreate?.userErrors?.length > 0) {
        const errors = stagedUploadJson.data.stagedUploadsCreate.userErrors
          .map((e) => e.message)
          .join(", ");
        console.error("[ACTION] User errors creating staged upload:", errors);
        return json({ error: `Failed to create staged upload: ${errors}`, success: false });
      }
      
      const stagedTarget = stagedUploadJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!stagedTarget?.url || !stagedTarget?.resourceUrl) {
        console.error("[ACTION] Invalid staged upload response:", JSON.stringify(stagedUploadJson, null, 2));
        return json({ error: "Failed to create staged upload: Invalid response", success: false });
      }
      
      debugLog("[ACTION] Staged upload created. Upload URL:", stagedTarget.url);
      debugLog("[ACTION] Resource URL:", stagedTarget.resourceUrl);
      debugLog("[ACTION] Parameters:", stagedTarget.parameters?.length || 0, "parameters");
      
      // Step 2: Upload file to GCS using multipart/form-data
      debugLog("[ACTION] Step 2: Uploading file to Google Cloud Storage...");
      const FormData = (await import("form-data")).default;
      const formData = new FormData();
      
      // Add all parameters first (important for signature verification)
      if (stagedTarget.parameters) {
        for (const param of stagedTarget.parameters) {
          formData.append(param.name, param.value);
          debugLog("[ACTION] Added parameter:", param.name, "=", param.value.substring(0, 50) + (param.value.length > 50 ? "..." : ""));
        }
      }
      
      // Add file last (required for multipart/form-data)
      formData.append("file", fileBuffer, {
        filename: fileName,
        contentType: fileType,
      });
      
      debugLog("[ACTION] Uploading to:", stagedTarget.url);
      debugLog("[ACTION] File buffer size:", fileBuffer.length, "bytes");
      
      // Use undici.request with proper form-data stream handling
      const undici = await import("undici");
      
      // Get headers with boundary
      const uploadHeaders = formData.getHeaders();
      debugLog("[ACTION] Upload headers:", Object.keys(uploadHeaders));
      
      // Make request - undici handles form-data streams natively
      const uploadResponse = await undici.request(stagedTarget.url, {
        method: "POST",
        body: formData,
        headers: uploadHeaders,
      });
      
      const responseBody = await uploadResponse.body.text();
      
      if (uploadResponse.statusCode < 200 || uploadResponse.statusCode >= 300) {
        console.error("[ACTION] GCS upload failed:", uploadResponse.statusCode);
        console.error("[ACTION] Response body:", responseBody);
        return json({ 
          error: `Failed to upload file to storage: ${uploadResponse.statusCode} ${responseBody}`, 
          success: false 
        });
      }
      
      debugLog("[ACTION] GCS upload response:", uploadResponse.statusCode, responseBody.substring(0, 200));
      
      debugLog("[ACTION] File uploaded successfully to GCS");
      
      // Step 3: Create file record in Shopify using resourceUrl
      debugLog("[ACTION] Step 3: Creating file record in Shopify...");
      const fileCreateResponse = await admin.graphql(
        `#graphql
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) {
            files {
              id
              fileStatus
              ... on MediaImage {
                alt
                image {
                  url
                  width
                  height
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
        {
          variables: {
            files: [
              {
                originalSource: stagedTarget.resourceUrl,
                alt: fileName, // Set the alt text to the filename
                contentType: "IMAGE",
              },
            ],
          },
        }
      );
      
      const fileCreateJson = await fileCreateResponse.json();
      debugLog("[ACTION] File create response received");
      debugLog("[ACTION] File create response:", JSON.stringify(fileCreateJson, null, 2));
      
      if (fileCreateJson?.errors) {
        const errors = fileCreateJson.errors.map((e) => e.message).join(", ");
        console.error("[ACTION] GraphQL errors creating file:", errors);
        return json({ error: `Failed to create file: ${errors}`, success: false });
      }
      
      if (fileCreateJson?.data?.fileCreate?.userErrors?.length > 0) {
        const errors = fileCreateJson.data.fileCreate.userErrors.map((e) => e.message).join(", ");
        console.error("[ACTION] User errors creating file:", errors);
        return json({ error: `Failed to create file: ${errors}`, success: false });
      }
      
      const uploadedFile = fileCreateJson?.data?.fileCreate?.files?.[0];
      if (!uploadedFile?.id) {
        console.error("[ACTION] No file ID returned in response");
        return json({ error: "File uploaded but no ID returned", success: false });
      }
      
      debugLog("[ACTION] File uploaded successfully, ID:", uploadedFile.id);
      debugLog("[ACTION] File status:", uploadedFile.fileStatus);
      debugLog("[ACTION] File alt:", uploadedFile.alt);
      debugLog("[ACTION] File image URL:", uploadedFile.image?.url);
      
      // If the file is still processing and URL is not available, poll for it
      let fileUrl = uploadedFile.image?.url || "";
      let fileAlt = uploadedFile.alt || fileName;
      
      if (!fileUrl && uploadedFile.fileStatus !== "READY") {
        debugLog("[ACTION] File is still processing, waiting for URL...");
        // Poll up to 5 times with 1 second delay
        for (let i = 0; i < 5; i++) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const checkResponse = await admin.graphql(
            `#graphql
            query getFile($id: ID!) {
              node(id: $id) {
                ... on MediaImage {
                  id
                  fileStatus
                  alt
                  image {
                    url
                    width
                    height
                  }
                }
              }
            }
          `,
            { variables: { id: uploadedFile.id } }
          );
          
          const checkJson = await checkResponse.json();
          const fileNode = checkJson?.data?.node;
          
          if (fileNode?.image?.url) {
            fileUrl = fileNode.image.url;
            fileAlt = fileNode.alt || fileName;
            debugLog("[ACTION] File URL now available:", fileUrl);
            break;
          }
          
          debugLog("[ACTION] Still processing, attempt", i + 1, "of 5");
        }
      }
      
      const successResponse = json({
        success: true,
        file: {
          id: uploadedFile.id,
          url: fileUrl,
          alt: fileAlt,
        },
      });
      
      debugLog("[ACTION] Returning success response:", JSON.stringify({
        success: true,
        file: {
          id: uploadedFile.id,
          url: uploadedFile.image?.url || "",
        },
      }));
      debugLog("[ACTION] Response Content-Type:", successResponse.headers.get("content-type"));
      debugLog("[ACTION] Response status:", successResponse.status);
      
      // Ensure we return the response directly - don't let React Router wrap it
      return successResponse;
      
    } catch (error) {
      console.error("[ACTION] Error uploading file:", error);
      console.error("[ACTION] Error message:", error.message);
      console.error("[ACTION] Error stack:", error.stack);
      return json({
        error: `Failed to upload file: ${error.message}`,
        success: false,
      });
    }
  }
  
  // Entry creation logic (only reached if not a file upload)
  debugLog("[ACTION] Action called - starting entry creation");
    debugLog("[ACTION] Admin authenticated successfully");
    debugLog("[ACTION] Form data received");

    const positionId = String(formData.get("position_id") || "").trim();
    const startAt = String(formData.get("start_at") || "").trim();
    const endAt = String(formData.get("end_at") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const desktopBannerFileId = String(formData.get("desktop_banner") || "").trim() || null;
    const mobileBannerFileId = String(formData.get("mobile_banner") || "").trim() || null;
    const targetUrl = String(formData.get("target_url") || "").trim();
    const headline = String(formData.get("headline") || "").trim();
    const buttonText = String(formData.get("button_text") || "").trim();
    // Convert checkbox value (on/undefined) to status (active/draft)
    const statusCheckbox = formData.get("status");
    const status = statusCheckbox === "on" ? "active" : "draft";
    // Get user's timezone offset in minutes (negative means ahead of UTC, positive means behind)
    let userTimezoneOffset = parseInt(formData.get("timezone_offset") || "0", 10);
    if (Number.isNaN(userTimezoneOffset)) {
      userTimezoneOffset = 0;
    }

    // Query metaobject definition to check if it exists
    let definitionExists = false;
    try {
    const defResponse = await admin.graphql(
      `#graphql
      query($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
        }
      }
    `,
      { variables: { type: "schedulable_entity" } }
    );
      const defJson = await defResponse.json();
      definitionExists = Boolean(defJson?.data?.metaobjectDefinitionByType?.id);
      
      if (definitionExists) {
        debugLog("[ACTION] Metaobject definition exists.");
      } else {
        debugLog("[ACTION] Metaobject definition does not exist. Creating it...");
      }
    } catch (defError) {
      console.error("[ACTION] Could not query metaobject definition:", defError);
      definitionExists = false;
    }

    // If definition doesn't exist, create it
    if (!definitionExists) {
    try {
      debugLog("[ACTION] Creating metaobject definition...");
      const createDefResponse = await admin.graphql(
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
              type: "schedulable_entity",
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
        }
      );
      const createDefJson = await createDefResponse.json();
      debugLog("[ACTION] Create definition response:", JSON.stringify(createDefJson, null, 2));

      if (createDefJson?.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
        const errors = createDefJson.data.metaobjectDefinitionCreate.userErrors
          .map((e) => `${e.field}: ${e.message}`)
          .join(", ");
        return json({
          error: `Failed to create metaobject definition: ${errors}. Please try again or contact support.`,
          success: false,
        });
      }

      if (createDefJson?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id) {
        debugLog("[ACTION] Metaobject definition created successfully");
        definitionExists = true;
      } else {
        return json({
          error: "Failed to create metaobject definition. Please try again or contact support.",
          success: false,
        });
      }
    } catch (createDefError) {
      console.error("[ACTION] Error creating metaobject definition:", createDefError);
      return json({
        error: `Failed to create metaobject definition: ${createDefError.message}. Please try again or contact support.`,
        success: false,
      });
    }
  }

    // Validate required fields
    if (!title) {
      return json({
        error: "Title is required.",
        success: false,
      });
    }
    if (!positionId) {
      return json({
        error: "Position ID is required.",
        success: false,
      });
    }

    debugLog("Raw form data:", {
      positionId,
      startAt,
      endAt,
      title,
      description,
      desktopBannerFileId,
      mobileBannerFileId,
      targetUrl,
      headline,
      buttonText,
      status,
    });

    const userTimeZone = String(formData.get("timezone") || "").trim() || null;

    const defaultBounds = getDefaultDateBounds(userTimeZone, userTimezoneOffset);
    const formattedStartAt = startAt ? parseLocalDateTimeToUTC(startAt, userTimeZone, userTimezoneOffset) : defaultBounds.start;
    const formattedEndAt = endAt ? parseLocalDateTimeToUTC(endAt, userTimeZone, userTimezoneOffset) : defaultBounds.end;

    if (startAt && !formattedStartAt) {
      return json({
        error: "Invalid Start Date format. Please ensure the date is valid.",
        success: false,
      });
    }
    if (endAt && !formattedEndAt) {
      return json({
        error: "Invalid End Date format. Please ensure the date is valid.",
        success: false,
      });
    }

    const fields = [
      { key: "position_id", value: positionId },
    ];

    // Always include start_at and end_at (using defaults if not provided)
    fields.push({ key: "start_at", value: formattedStartAt });
    fields.push({ key: "end_at", value: formattedEndAt });

    if (title) fields.push({ key: "title", value: title });
    if (description) fields.push({ key: "description", value: description });
    // s-media-picker returns file reference IDs directly
    if (desktopBannerFileId && desktopBannerFileId !== "") {
      fields.push({ key: "desktop_banner", value: desktopBannerFileId });
    }
    if (mobileBannerFileId && mobileBannerFileId !== "") {
      fields.push({ key: "mobile_banner", value: mobileBannerFileId });
    }
    
    // Validate and format URL - ensure it has a proper scheme
    if (targetUrl) {
    let formattedUrl = targetUrl.trim();
    // Shopify URL fields require a scheme (http, https, mailto, sms, tel)
    // Relative URLs (starting with /) need to be converted to full URLs
    if (formattedUrl && !/^(https?|mailto|sms|tel):/i.test(formattedUrl)) {
      if (formattedUrl.startsWith("/")) {
        // Get shop domain from admin session
        const shopResponse = await admin.graphql(`#graphql query { shop { myshopifyDomain } }`);
        const shopJson = await shopResponse.json();
        const shopDomain = shopJson?.data?.shop?.myshopifyDomain || "example.myshopify.com";
        formattedUrl = `https://${shopDomain}${formattedUrl}`;
      } else {
        formattedUrl = `https://${formattedUrl}`;
      }
    }
    // Only add if URL is valid and not empty
      if (formattedUrl && formattedUrl !== "https://") {
        fields.push({ key: "target_url", value: formattedUrl });
      }
    }
    
    if (headline) fields.push({ key: "headline", value: headline });
    if (buttonText) fields.push({ key: "button_text", value: buttonText });

    // Convert status to Shopify metaobject publish status
    const publishStatus = status === "draft" ? "DRAFT" : "ACTIVE";

    debugLog("Creating metaobject with fields:", JSON.stringify(fields, null, 2));
    debugLog("Metaobject publish status:", publishStatus);

    // Create the metaobject with publishable capability
    const createResponse = await admin.graphql(
    `#graphql
    mutation CreateSchedulableEntity($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }
  `,
    {
      variables: {
        metaobject: {
          type: "schedulable_entity",
          handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
          fields,
          capabilities: {
            publishable: {
              status: status === "draft" ? "DRAFT" : "ACTIVE",
            },
          },
        },
        },
      },
    );
    const createJson = await createResponse.json();

    debugLog("Metaobject create response:", JSON.stringify(createJson, null, 2));

    if (createJson?.data?.metaobjectCreate?.userErrors?.length > 0) {
      const errors = createJson.data.metaobjectCreate.userErrors
        .map((e) => `${e.field}: ${e.message}`)
        .join(", ");
      return json({
        error: `Failed to create entry: ${errors}`,
        success: false,
      });
    }

    const createdMetaobject = createJson?.data?.metaobjectCreate?.metaobject;
    if (!createdMetaobject?.id) {
      return json({
        error: `Unknown error occurred while creating entry. Response: ${JSON.stringify(createJson)}`,
        success: false,
      });
    }

    // For fetcher.Form, we need to return success and let the component handle reload
    // Using redirect with fetcher doesn't work the same way
    debugLog("[ACTION] Entry created successfully, returning success");
    return json({ success: true, message: "Entry created successfully!" });
  } catch (error) {
    console.error("[ACTION] ========== ERROR IN ACTION ==========");
    console.error("[ACTION] Error message:", error.message);
    console.error("[ACTION] Error name:", error.name);
    console.error("[ACTION] Error stack:", error.stack);
    console.error("[ACTION] Full error:", error);
    
    // Always return JSON, never throw
    return json({
      error: `Failed to process request: ${error.message || "Unknown error"}`,
      success: false,
    });
  }
};
