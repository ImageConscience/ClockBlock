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

    if (jsonResponse?.errors) {
      console.error("GraphQL errors in loader:", JSON.stringify(jsonResponse.errors, null, 2));
      const errorMessages = jsonResponse.errors.map((e) => e.message).join(", ");
      if (errorMessages.includes("metaobject definition") || errorMessages.includes("type")) {
        debugWarn("Metaobject definition may not exist yet. Returning empty entries.");
        return {
          entries: [],
          error: "Metaobject definition not found. Please ensure the app has been properly installed.",
        };
      }
      throw new Error(`GraphQL error: ${errorMessages}`);
    }

    const entries = jsonResponse?.data?.metaobjects?.nodes ?? [];

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
      mediaFiles =
        filesJson?.data?.files?.edges?.map((edge) => ({
          id: edge.node.id,
          url: edge.node.image?.url || "",
          alt: edge.node.alt || "",
          createdAt: edge.node.createdAt,
        })) || [];
      mediaFiles.sort((a, b) => {
        const dateA = new Date(a.createdAt || 0);
        const dateB = new Date(b.createdAt || 0);
        return dateB.getTime() - dateA.getTime();
      });
    } catch (error) {
      console.error("Error loading media files:", error);
    }

    return { entries, mediaFiles };
  } catch (error) {
    console.error("Error loading schedulable entities:", error);
    return {
      entries: [],
      error: `Failed to load entries: ${error.message}`,
    };
  }
};

export const action = async ({ request }) => {
  try {
    debugLog("[ACTION] ========== ACTION CALLED ==========");
    debugLog("[ACTION] Request URL:", request.url);
    debugLog("[ACTION] Request method:", request.method);
    debugLog("[ACTION] Content-Type:", request.headers.get("content-type"));
    debugLog("[ACTION] Accept header:", request.headers.get("accept"));
    debugLog("[ACTION] X-Requested-With:", request.headers.get("x-requested-with"));

    const { admin } = await authenticate.admin(request);

    const confirmationUrl = await ensureActiveSubscription(admin);
    if (confirmationUrl) {
      return createAppBridgeRedirect(confirmationUrl);
    }

    const acceptHeader = request.headers.get("accept") || "";
    const isFetcherRequest =
      acceptHeader.includes("*/*") || acceptHeader.includes("application/json") || !acceptHeader.includes("text/html");
    debugLog("[ACTION] Is fetcher request:", isFetcherRequest);

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json();

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
          { variables: { id: body.id } },
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
              metaobject {
                id
                handle
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
                fields,
              },
            },
          },
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
          },
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

    const formDataKeys = [];
    for (const [key, value] of formData.entries()) {
      formDataKeys.push(key);
      debugLog(
        "[ACTION] FormData key:",
        key,
        "value type:",
        value instanceof File ? "File" : typeof value,
        value instanceof File ? `(${value.name}, ${value.size} bytes)` : "",
      );
    }
    debugLog("[ACTION] All formData keys:", formDataKeys);

    const file = formData.get("file");
    const hasTitle = formData.get("title");

    debugLog(
      "[ACTION] File present:",
      !!file,
      "Has title:",
      !!hasTitle,
      "File type:",
      file instanceof File ? file.type : typeof file,
    );

    if (file && !hasTitle) {
      debugLog("[ACTION] Detected file upload request - using official Shopify staged upload method");
      try {
        debugLog("[ACTION] Admin authenticated successfully for file upload");

        if (!file) {
          return json({ error: "No file provided", success: false });
        }

        if (typeof file === "string") {
          return json({
            error: "File upload failed: File object not received.",
            success: false,
          });
        }

        const isFileLike =
          file instanceof File ||
          file instanceof Blob ||
          (typeof file === "object" &&
            file !== null &&
            (typeof file.arrayBuffer === "function" || typeof file.stream === "function"));

        if (!isFileLike) {
          return json({ error: `Invalid file format. Received: ${typeof file}`, success: false });
        }

        const fileName = file.name || `upload-${Date.now()}.jpg`;
        const fileType = file.type || "image/jpeg";
        const fileSize = file.size || 0;

        debugLog("[ACTION] File:", fileName, "Type:", fileType, "Size:", fileSize, "bytes");

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
          },
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
        if (!stagedTarget || !stagedTarget.url) {
          console.error("[ACTION] Invalid staged upload response:", JSON.stringify(stagedUploadJson, null, 2));
          return json({ error: "Failed to create staged upload target", success: false });
        }

        debugLog("[ACTION] Staged upload created. Upload URL:", stagedTarget.url);
        debugLog("[ACTION] Resource URL:", stagedTarget.resourceUrl);
        debugLog("[ACTION] Parameters:", stagedTarget.parameters?.length || 0, "parameters");

        debugLog("[ACTION] Step 2: Uploading file to Google Cloud Storage...");
        const FormData = (await import("form-data")).default;
        const uploadFormData = new FormData();

        if (Array.isArray(stagedTarget.parameters)) {
          for (const param of stagedTarget.parameters) {
            uploadFormData.append(param.name, param.value);
            debugLog(
              "[ACTION] Added parameter:",
              param.name,
              "=",
              param.value.substring(0, 50) + (param.value.length > 50 ? "..." : ""),
            );
          }
        }

        uploadFormData.append("file", fileBuffer, {
          filename: fileName,
          contentType: fileType,
        });

        debugLog("[ACTION] Uploading to:", stagedTarget.url);
        debugLog("[ACTION] File buffer size:", fileBuffer.length, "bytes");

        const uploadHeaders = uploadFormData.getHeaders();
        debugLog("[ACTION] Upload headers:", Object.keys(uploadHeaders));

        const { request: undiciRequest } = await import("undici");
        const uploadResponse = await undiciRequest(stagedTarget.url, {
          method: "POST",
          headers: uploadHeaders,
          body: uploadFormData,
        });

        if (uploadResponse.statusCode >= 400) {
          const responseBody = await uploadResponse.body.text();
          console.error("[ACTION] GCS upload failed:", uploadResponse.statusCode);
          console.error("[ACTION] Response body:", responseBody);
          return json({
            error: `Cloud storage upload failed: ${uploadResponse.statusCode}`,
            details: responseBody.substring(0, 200),
            success: false,
          });
        }

        const responseBody = await uploadResponse.body.text();
        debugLog("[ACTION] GCS upload response:", uploadResponse.statusCode, responseBody.substring(0, 200));

        debugLog("[ACTION] File uploaded successfully to GCS");

        debugLog("[ACTION] Step 3: Creating file record in Shopify...");
        const fileCreateResponse = await admin.graphql(
          `#graphql
          mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
              files {
                ... on MediaImage {
                  id
                  fileStatus
                  alt
                  image {
                    url
                    altText
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
                  contentType: "IMAGE",
                  originalSource: stagedTarget.resourceUrl,
                  alt: file.name || "",
                },
              ],
            },
          },
        );

        const fileCreateJson = await fileCreateResponse.json();
        debugLog("[ACTION] File create response received");
        debugLog("[ACTION] File create response:", JSON.stringify(fileCreateJson, null, 2));

        if (fileCreateJson?.errors) {
          const errors = fileCreateJson.errors.map((e) => e.message).join(", ");
          console.error("[ACTION] GraphQL errors creating file:", errors);
          return json({ error: `Failed to register file: ${errors}`, success: false });
        }

        if (fileCreateJson?.data?.fileCreate?.userErrors?.length > 0) {
          const errors = fileCreateJson.data.fileCreate.userErrors
            .map((e) => e.message)
            .join(", ");
          console.error("[ACTION] User errors creating file:", errors);
          return json({ error: `Failed to register file: ${errors}`, success: false });
        }

        const uploadedFile = fileCreateJson?.data?.fileCreate?.files?.[0];
        if (!uploadedFile?.id) {
          console.error("[ACTION] No file ID returned in response");
          return json({ error: "File registration failed", success: false });
        }

        debugLog("[ACTION] File uploaded successfully, ID:", uploadedFile.id);
        debugLog("[ACTION] File status:", uploadedFile.fileStatus);
        debugLog("[ACTION] File alt:", uploadedFile.alt);
        debugLog("[ACTION] File image URL:", uploadedFile.image?.url);

        let fileUrl = uploadedFile.image?.url;
        let fileAlt = uploadedFile.alt || file.name;

        if (!fileUrl && uploadedFile.fileStatus !== "READY") {
          debugLog("[ACTION] File is still processing, waiting for URL...");
          for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setTimeout(resolve, 1000));

            const checkResponse = await admin.graphql(
              `#graphql
              query ($id: ID!) {
                file(id: $id) {
                  ... on MediaImage {
                    id
                    alt
                    image {
                      url
                    }
                  }
                }
              }
            `,
              { variables: { id: uploadedFile.id } },
            );
            const checkJson = await checkResponse.json();
            const fileNode = checkJson?.data?.file;
            if (fileNode?.image?.url) {
              fileUrl = fileNode.image.url;
              fileAlt = fileNode.alt || fileName;
              debugLog("[ACTION] File URL now available:", fileUrl);
              break;
            }

            debugLog("[ACTION] Still processing, attempt", i + 1, "of 5");
          }
        }

        const successResponse = json(
          {
            success: true,
            file: {
              id: uploadedFile.id,
              url: fileUrl || uploadedFile.image?.url || stagedTarget.resourceUrl,
              alt: fileAlt,
              createdAt: new Date().toISOString(),
            },
          },
          { status: 200 },
        );

        debugLog("[ACTION] Returning success response:", JSON.stringify({ success: true, file: { id: uploadedFile.id } }));
        debugLog("[ACTION] Response Content-Type:", successResponse.headers.get("content-type"));
        debugLog("[ACTION] Response status:", successResponse.status);

        return successResponse;
      } catch (error) {
        console.error("[ACTION] Error uploading file:", error);
        console.error("[ACTION] Error message:", error.message);
        console.error("[ACTION] Error stack:", error.stack);
        return json({ error: error.message || "File upload failed", success: false });
      }
    }

    debugLog("[ACTION] Action called - starting entry creation");
    debugLog("[ACTION] Admin authenticated successfully");
    debugLog("[ACTION] Form data received");

    const positionId = String(formData.get("position_id") || "").trim();
    const title = String(formData.get("title") || "").trim();
    const headline = String(formData.get("headline") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const startAt = String(formData.get("start_at") || "").trim();
    const endAt = String(formData.get("end_at") || "").trim();
    const targetUrl = String(formData.get("target_url") || "").trim();
    const buttonText = String(formData.get("button_text") || "").trim();
    const status = formData.get("status") ? "ACTIVE" : "DRAFT";
    const desktopBanner = String(formData.get("desktop_banner") || "").trim();
    const mobileBanner = String(formData.get("mobile_banner") || "").trim();
    const userTimeZone = String(formData.get("timezone") || "").trim() || null;
    const userTimezoneOffsetRaw = formData.get("timezone_offset");
    const userTimezoneOffset =
      userTimezoneOffsetRaw !== null && userTimezoneOffsetRaw !== undefined && userTimezoneOffsetRaw !== "" && !Number.isNaN(Number(userTimezoneOffsetRaw))
        ? Number(userTimezoneOffsetRaw)
        : undefined;

    if (!title) {
      return json({ error: "Title is required", success: false }, { status: 400 });
    }
    if (!positionId) {
      return json({ error: "Position ID is required", success: false }, { status: 400 });
    }

    debugLog("Raw form data:", {
      positionId,
      title,
      headline,
      description,
      startAt,
      endAt,
      targetUrl,
      buttonText,
      status,
      desktopBanner,
      mobileBanner,
      userTimeZone,
      userTimezoneOffset,
    });

    const defaults = getDefaultDateBounds(userTimeZone, userTimezoneOffset);
    const formattedStartAt = startAt ? parseLocalDateTimeToUTC(startAt, userTimeZone, userTimezoneOffset) : defaults.start;
    const formattedEndAt = endAt ? parseLocalDateTimeToUTC(endAt, userTimeZone, userTimezoneOffset) : defaults.end;

    if (!formattedStartAt || !formattedEndAt) {
      return json({ error: "Invalid date/time values", success: false }, { status: 400 });
    }

    debugLog("Creating metaobject with fields:", JSON.stringify({
      positionId,
      formattedStartAt,
      formattedEndAt,
      status,
    }, null, 2));

    try {
      const definitionResponse = await admin.graphql(
        `#graphql
        query ($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            id
            type
          }
        }
      `,
        { variables: { type: "schedulable_entity" } },
      );
      const definitionJson = await definitionResponse.json();
      const definitionExists = Boolean(definitionJson?.data?.metaobjectDefinitionByType?.id);

      if (!definitionExists) {
        const createDefResponse = await admin.graphql(
          `#graphql
          mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionInput!) {
            metaobjectDefinitionCreate(definition: $definition) {
              metaobjectDefinition { id type }
              userErrors { field message }
            }
          }
        `,
          {
            variables: {
              definition: {
                name: "Schedulable Entity",
                type: "schedulable_entity",
                access: {
                  storefront: "PUBLIC",
                },
                fields: [
                  { name: "Title", key: "title", type: "single_line_text_field" },
                  { name: "Position ID", key: "position_id", type: "single_line_text_field" },
                  { name: "Headline", key: "headline", type: "single_line_text_field" },
                  { name: "Description", key: "description", type: "multi_line_text_field" },
                  { name: "Start At", key: "start_at", type: "date_time" },
                  { name: "End At", key: "end_at", type: "date_time" },
                  { name: "Target URL", key: "target_url", type: "url" },
                  { name: "Button Text", key: "button_text", type: "single_line_text_field" },
                  {
                    name: "Desktop Banner",
                    key: "desktop_banner",
                    type: "file_reference",
                    validations: [{ name: "file_type", value: "image" }],
                  },
                  {
                    name: "Mobile Banner",
                    key: "mobile_banner",
                    type: "file_reference",
                    validations: [{ name: "file_type", value: "image" }],
                  },
                ],
              },
            },
          },
        );
        const createDefJson = await createDefResponse.json();
        if (createDefJson?.data?.metaobjectDefinitionCreate?.userErrors?.length) {
          const errors = createDefJson.data.metaobjectDefinitionCreate.userErrors
            .map((e) => e.message)
            .join(", ");
          return json({ error: `Failed to ensure metaobject definition: ${errors}`, success: false });
        }
      }
    } catch (error) {
      console.error("[ACTION] Error ensuring metaobject definition:", error);
      return json({ error: error.message || "Failed to ensure metaobject definition", success: false });
    }

    const fields = [
      { key: "title", value: title },
      { key: "position_id", value: positionId },
      { key: "headline", value: headline },
      { key: "description", value: description },
      { key: "start_at", value: formattedStartAt },
      { key: "end_at", value: formattedEndAt },
      { key: "target_url", value: targetUrl },
      { key: "button_text", value: buttonText },
    ];

    if (desktopBanner) {
      fields.push({ key: "desktop_banner", value: desktopBanner });
    }
    if (mobileBanner) {
      fields.push({ key: "mobile_banner", value: mobileBanner });
    }

    const createResponse = await admin.graphql(
      `#graphql
      mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
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
          metaobject: {
            type: "schedulable_entity",
            fields,
            capabilities: {
              publishable: {
                status,
              },
            },
          },
        },
      },
    );

    const createJson = await createResponse.json();

    if (createJson?.errors) {
      const errors = createJson.errors.map((e) => e.message).join(", ");
      console.error("[ACTION] GraphQL errors creating entry:", errors);
      return json({ error: `Failed to create entry: ${errors}`, success: false });
    }

    if (createJson?.data?.metaobjectCreate?.userErrors?.length > 0) {
      const errors = createJson.data.metaobjectCreate.userErrors
        .map((e) => e.message)
        .join(", ");
      console.error("[ACTION] User errors creating entry:", errors);
      return json({ error: `Failed to create entry: ${errors}`, success: false });
    }

    const createdMetaobject = createJson?.data?.metaobjectCreate?.metaobject;
    if (!createdMetaobject?.id) {
      return json({
        error: `Unknown error occurred while creating entry. Response: ${JSON.stringify(createJson)}`,
        success: false,
      });
    }

    debugLog("[ACTION] Entry created successfully, returning success");
    return json({ success: true, message: "Entry created successfully!" });
  } catch (error) {
    console.error("[ACTION] ========== ERROR IN ACTION ==========");
    console.error("[ACTION] Error message:", error.message);
    console.error("[ACTION] Error name:", error.name);
    console.error("[ACTION] Error stack:", error.stack);
    console.error("[ACTION] Full error:", error);

    return json({
      error: `Failed to process request: ${error.message || "Unknown error"}`,
      success: false,
    });
  }
};
