import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, redirect, useNavigation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
// createRequire no longer needed - removed form-data package

// Helper to return JSON response (React Router v7 compatible)
const json = (data, init = {}) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...init.headers,
  });
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    statusText: init.statusText,
    headers,
  });
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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
            }
            updatedAt
          }
        }
      }
    `,
      { variables: { first: 50 } },
    );
    const jsonResponse = await response.json();

    console.log("Loader GraphQL response:", JSON.stringify(jsonResponse, null, 2));

    // Check for GraphQL errors
    if (jsonResponse?.errors) {
      console.error("GraphQL errors in loader:", JSON.stringify(jsonResponse.errors, null, 2));
      // If the error is about the type not existing, return empty array
      const errorMessages = jsonResponse.errors.map((e) => e.message).join(", ");
      if (errorMessages.includes("metaobject definition") || errorMessages.includes("type")) {
        console.warn("Metaobject definition may not exist yet. Returning empty entries.");
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
      })) || [];
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
    console.log("[ACTION] ========== ACTION CALLED ==========");
    console.log("[ACTION] Request URL:", request.url);
    console.log("[ACTION] Request method:", request.method);
    console.log("[ACTION] Content-Type:", request.headers.get("content-type"));
    
    const formData = await request.formData();
    console.log("[ACTION] FormData received, checking contents...");
    
    // Log all formData keys to debug
    const formDataKeys = [];
    for (const [key, value] of formData.entries()) {
      formDataKeys.push(key);
      console.log("[ACTION] FormData key:", key, "value type:", value instanceof File ? "File" : typeof value, value instanceof File ? `(${value.name}, ${value.size} bytes)` : "");
    }
    console.log("[ACTION] All formData keys:", formDataKeys);
    
    // Check if this is a file upload request (has file but no title/position_id)
    const file = formData.get("file");
    const hasTitle = formData.get("title");
    
    console.log("[ACTION] File present:", !!file, "Has title:", !!hasTitle, "File type:", file instanceof File ? file.type : typeof file);
    
    if (file && !hasTitle) {
    console.log("[ACTION] Detected file upload request");
    // This is a file upload request - use staged uploads with axios
    // axios handles multipart/form-data correctly for Google Cloud Storage signatures
    try {
      console.log("[ACTION] File upload request received - using staged uploads with axios");
      
      const { admin } = await authenticate.admin(request);
      console.log("[ACTION] Admin authenticated successfully for file upload");
      
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
      
      console.log("[ACTION] File:", fileName, "Type:", fileType, "Size:", fileSize, "bytes");
      
      // Convert file to Buffer
      let arrayBuffer;
      if (typeof file.arrayBuffer === "function") {
        arrayBuffer = await file.arrayBuffer();
      } else if (typeof file.stream === "function") {
        const stream = file.stream();
        const chunks = [];
        const reader = stream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
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
      
      // Step 1: Create staged upload target
      const resourceType = fileType.startsWith("image/") ? "IMAGE" : "IMAGE";
      const stagedResponse = await admin.graphql(
        `#graphql
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets {
              resourceUrl
              url
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
                resource: resourceType,
                filename: fileName,
                mimeType: fileType,
                fileSize: fileSize.toString(),
              },
            ],
          },
        }
      );
      
      const stagedJson = await stagedResponse.json();
      console.log("[ACTION] Staged upload response received");
      
      if (stagedJson?.errors) {
        const errors = stagedJson.errors.map((e) => e.message).join(", ");
        console.error("[ACTION] GraphQL errors creating staged upload:", errors);
        return json({ error: `Failed to create staged upload: ${errors}`, success: false });
      }
      
      if (stagedJson?.data?.stagedUploadsCreate?.userErrors?.length > 0) {
        const errors = stagedJson.data.stagedUploadsCreate.userErrors.map((e) => e.message).join(", ");
        console.error("[ACTION] User errors creating staged upload:", errors);
        return json({ error: `Failed to create staged upload: ${errors}`, success: false });
      }
      
      const stagedTarget = stagedJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
      if (!stagedTarget?.url || !stagedTarget?.resourceUrl) {
        console.error("[ACTION] No staged upload target returned");
        return json({ error: "Failed to create staged upload target", success: false });
      }
      
      console.log("[ACTION] Staged upload target created, uploading file...");
      
      // Step 2: Upload file to staged URL
      // Manually construct multipart/form-data to ensure exact format for signature verification
      const boundary = `----formdata-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      const parts = [];
      
      // Add all parameters first (in order)
      for (const param of stagedTarget.parameters) {
        parts.push(`--${boundary}\r\n`);
        parts.push(`Content-Disposition: form-data; name="${param.name}"\r\n\r\n`);
        parts.push(`${param.value}\r\n`);
      }
      
      // File must be appended last (critical for signature verification)
      parts.push(`--${boundary}\r\n`);
      parts.push(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`);
      parts.push(`Content-Type: ${fileType}\r\n\r\n`);
      
      // Convert parts to buffers
      const textBuffers = parts.map(part => Buffer.from(part, 'utf8'));
      const finalBoundary = Buffer.from(`--${boundary}--\r\n`, 'utf8');
      
      // Concatenate all buffers
      const multipartBuffer = Buffer.concat([
        ...textBuffers,
        fileBuffer,
        Buffer.from('\r\n', 'utf8'),
        finalBoundary,
      ]);
      
      const contentType = `multipart/form-data; boundary=${boundary}`;
      
      console.log("[ACTION] Uploading to staged URL:", stagedTarget.url);
      console.log("[ACTION] Multipart buffer size:", multipartBuffer.length, "bytes");
      
      // Use Node's native fetch with the manually constructed multipart buffer
      const uploadResponse = await fetch(stagedTarget.url, {
        method: 'POST',
        body: multipartBuffer,
        headers: {
          'Content-Type': contentType,
          'Content-Length': multipartBuffer.length.toString(),
          // Don't add any other headers - they break signature verification
        },
      });
            
            console.log("[ACTION] Staged upload response status:", uploadResponse.status);
            
            if (!uploadResponse.ok && uploadResponse.status !== 200 && uploadResponse.status !== 204) {
              const errorText = await uploadResponse.text();
              console.error("[ACTION] Failed to upload file to staged URL, status:", uploadResponse.status);
              console.error("[ACTION] Error response:", errorText);
              resolve(json({ 
                error: `Failed to upload file: HTTP ${uploadResponse.status}`, 
                success: false 
              }));
              return;
            }
            
            console.log("[ACTION] File uploaded to staged URL successfully");
            
            // Wait a moment for Shopify to process the staged upload
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Step 3: Create file record using resourceUrl
            console.log("[ACTION] Creating file record using resourceUrl");
            const fileCreateResponse = await admin.graphql(
              `#graphql
              mutation fileCreate($files: [FileCreateInput!]!) {
                fileCreate(files: $files) {
                  files {
                    id
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
                      filename: fileName,
                    },
                  ],
                },
              }
            );
            
            const fileCreateJson = await fileCreateResponse.json();
            console.log("[ACTION] File create response received");
            
            if (fileCreateJson?.errors) {
              const errors = fileCreateJson.errors.map((e) => e.message).join(", ");
              console.error("[ACTION] GraphQL errors creating file:", errors);
              resolve(json({ error: `Failed to create file: ${errors}`, success: false }));
              return;
            }
            
            if (fileCreateJson?.data?.fileCreate?.userErrors?.length > 0) {
              const errors = fileCreateJson.data.fileCreate.userErrors.map((e) => e.message).join(", ");
              console.error("[ACTION] User errors creating file:", errors);
              resolve(json({ error: `Failed to create file: ${errors}`, success: false }));
              return;
            }
            
            const uploadedFile = fileCreateJson?.data?.fileCreate?.files?.[0];
            if (!uploadedFile?.id) {
              console.error("[ACTION] No file ID returned in response");
              resolve(json({ error: "File uploaded but no ID returned", success: false }));
              return;
            }
            
            console.log("[ACTION] File uploaded successfully, ID:", uploadedFile.id);
            
            resolve(json({
              success: true,
              file: {
                id: uploadedFile.id,
                url: uploadedFile.image?.url || "",
                alt: uploadedFile.alt || fileName || "Uploaded image",
              },
            }));
          } catch (err) {
            console.error("[ACTION] Error in upload process:", err);
            resolve(json({ error: `Failed to upload file: ${err.message}`, success: false }));
          }
        });
        
        formDataToUpload.on('error', (err) => {
          console.error("[ACTION] Form data stream error:", err);
          reject(json({ error: `Failed to prepare upload: ${err.message}`, success: false }));
        });
        
        // Trigger form-data to start emitting
        formDataToUpload.resume();
      });
    } catch (error) {
      console.error("[ACTION] Error uploading file:", error);
      console.error("[ACTION] Error message:", error.message);
      console.error("[ACTION] Error stack:", error.stack);
      return json({
        error: `Failed to upload file: ${error.message}`,
        success: false,
      });
    }
    // If we handled the file upload, return early (don't continue to entry creation)
    // This return should never be reached if file upload succeeded or failed (both return above)
    // But adding it as a safety net
    return json({ error: "File upload handled", success: false });
  }
  
  // Entry creation logic (only reached if not a file upload)
  console.log("[ACTION] Action called - starting entry creation");
    const { admin } = await authenticate.admin(request);
    console.log("[ACTION] Admin authenticated successfully");
    console.log("[ACTION] Form data received");

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
    const status = String(formData.get("status") || "active").trim();
    // Get user's timezone offset in minutes (negative means ahead of UTC, positive means behind)
    const userTimezoneOffset = parseInt(formData.get("timezone_offset") || "0", 10);

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
        console.log("[ACTION] Metaobject definition exists.");
      } else {
        console.log("[ACTION] Metaobject definition does not exist. Creating it...");
      }
    } catch (defError) {
      console.error("[ACTION] Could not query metaobject definition:", defError);
      definitionExists = false;
    }

    // If definition doesn't exist, create it
    if (!definitionExists) {
    try {
      console.log("[ACTION] Creating metaobject definition...");
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
      console.log("[ACTION] Create definition response:", JSON.stringify(createDefJson, null, 2));

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
        console.log("[ACTION] Metaobject definition created successfully");
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

  // Convert HTML to Lexical JSON format for rich_text_field
  // Shopify's rich_text_field expects a Lexical editor state JSON
  // The format should match Lexical's serialized state structure
  const htmlToLexicalJSON = (html) => {
    if (!html || !html.trim()) {
      // Return empty Lexical state
      return JSON.stringify({
        root: {
          children: [],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      });
    }
    
    // Try to preserve HTML structure by converting to Lexical nodes
    // For now, let's try a simpler approach - just pass the HTML directly
    // Shopify might accept HTML strings for rich_text_field
    
    // Actually, let's try the correct Lexical format without the nested root
    // Shopify might expect the Lexical state directly without wrapping
    const textContent = html.replace(/<[^>]*>/g, "").trim() || "";
    
    if (!textContent) {
      return JSON.stringify({
        root: {
          children: [],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      });
    }
    
    // Create proper Lexical JSON structure
    // Shopify expects the root object directly, not wrapped
    const lexicalState = {
      root: {
        children: [
          {
            children: [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: textContent,
                type: "text",
                version: 1,
              },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "paragraph",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    };
    
    return JSON.stringify(lexicalState);
  };

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

    // Format dates to ISO 8601 - datetime-local returns YYYY-MM-DDTHH:mm in user's local time
    // We need to preserve the user's local timezone when converting to ISO 8601
    const formatDateTime = (dateStr) => {
    if (!dateStr) return null;
    try {
      // datetime-local format is YYYY-MM-DDTHH:mm (no seconds or timezone)
      // Parse the date components directly to preserve the exact time the user entered
      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
      if (!match) {
        // Fallback to Date parsing if format doesn't match
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          console.error("Invalid date:", dateStr);
          return null;
        }
        const offset = userTimezoneOffset;
        const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
        const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
        const offsetSign = offset >= 0 ? '+' : '-';
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
      }
      
      // Extract date components (user entered these in their local timezone)
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hours = match[4];
      const minutes = match[5];
      const seconds = match[6] || "00";
      
      // Use user's timezone offset
      const offset = userTimezoneOffset;
      const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
      const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
      const offsetSign = offset >= 0 ? '+' : '-';
      
      return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
    } catch (error) {
      console.error("Date formatting error:", error, dateStr);
      return null;
    }
  };

    // Helper function to create default date in user's local timezone
    const createLocalDate = (year, month, day, hours, minutes, seconds = 0) => {
    // Format date components with user's timezone offset
    const offset = userTimezoneOffset;
    const offsetHours = Math.floor(Math.abs(offset) / 60).toString().padStart(2, '0');
    const offsetMinutes = (Math.abs(offset) % 60).toString().padStart(2, '0');
    const offsetSign = offset >= 0 ? '+' : '-';
    const y = year.toString().padStart(4, '0');
    const m = month.toString().padStart(2, '0');
    const d = day.toString().padStart(2, '0');
    const h = hours.toString().padStart(2, '0');
    const min = minutes.toString().padStart(2, '0');
    const s = seconds.toString().padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}:${s}${offsetSign}${offsetHours}:${offsetMinutes}`;
  };

    console.log("Raw form data:", {
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

    // Set default dates if not provided (in user's local timezone)
    // Default start: Jan 1, 2000 at 12:00 AM
    // Default end: Dec 31, 2100 at 11:59 PM
    const defaultStartDateISO = createLocalDate(2000, 1, 1, 0, 0, 0);
    const defaultEndDateISO = createLocalDate(2100, 12, 31, 23, 59, 59);
    
    const formattedStartAt = startAt ? formatDateTime(startAt) : defaultStartDateISO;
    const formattedEndAt = endAt ? formatDateTime(endAt) : defaultEndDateISO;
    
    console.log("Formatted dates:", {
      formattedStartAt,
      formattedEndAt,
    });

    // Validate date formats
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

    console.log("Creating metaobject with fields:", JSON.stringify(fields, null, 2));
    console.log("Metaobject publish status:", publishStatus);

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

    console.log("Metaobject create response:", JSON.stringify(createJson, null, 2));

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
    console.log("[ACTION] Entry created successfully, returning success");
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

function MediaLibraryPicker({ name, label, mediaFiles = [], defaultValue = "" }) {
  const [selectedFileId, setSelectedFileId] = useState(defaultValue);
  const [showPicker, setShowPicker] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [localMediaFiles, setLocalMediaFiles] = useState(mediaFiles);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const hiddenInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const revalidator = useRevalidator();
  // Removed uploadFetcher - now using direct fetch() for file uploads

  const selectedFile = localMediaFiles.find((f) => f.id === selectedFileId);
  
  // Update local files when mediaFiles prop changes
  useEffect(() => {
    setLocalMediaFiles(mediaFiles);
  }, [mediaFiles]);

  const handleSelectFile = (fileId, fileUrl, fileAlt) => {
    setSelectedFileId(fileId);
    setShowPicker(false);
    setSearchTerm("");
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = fileId;
    }
  };

  const filteredFiles = localMediaFiles.filter((file) =>
    (file.alt || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (file.url || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    console.log("[MediaLibraryPicker] File selected:", file?.name, "Size:", file?.size, "Type:", file?.type);
    
    if (!file) {
      console.log("[MediaLibraryPicker] No file selected");
      return;
    }
    
    if (!file.type.startsWith("image/")) {
      console.log("[MediaLibraryPicker] Invalid file type:", file.type);
      setUploadError("Please upload an image file");
      return;
    }
    
    // Clear any existing progress interval
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    
    setIsUploading(true);
    setUploadError("");
    setUploadSuccess(false);
    setUploadProgress(0);
    
    // Simulate progress (we can't get real progress from fetcher, but we can show it's working)
    progressIntervalRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) return prev; // Don't go to 100% until we get response
        return prev + 10;
      });
    }, 500);
    
    try {
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);
      console.log("[MediaLibraryPicker] FormData created, submitting...");
      console.log("[MediaLibraryPicker] Submitting FormData with file:", file.name, "Size:", file.size, "Type:", file.type);
      
      // Use direct fetch() instead of fetcher.submit() because React Router's fetcher
      // doesn't properly serialize File objects in FormData - it converts them to strings
      console.log("[MediaLibraryPicker] Starting fetch request to:", window.location.pathname);
      const uploadStartTime = Date.now();
      
      // Create a timeout promise (60 seconds for large file uploads)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Upload timeout: Request took longer than 60 seconds")), 60000);
      });
      
      // Race between fetch and timeout
      const fetchPromise = fetch(window.location.pathname, {
        method: "POST",
        body: uploadFormData,
        credentials: "include", // Include session cookies for authentication
        // Don't set Content-Type header - browser will set it with boundary for multipart/form-data
      });
      
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      const uploadDuration = Date.now() - uploadStartTime;
      
      console.log("[MediaLibraryPicker] Upload response received after", uploadDuration, "ms, status:", response.status);
      
      // Check content type to ensure we got JSON, not HTML
      const contentType = response.headers.get("content-type") || "";
      console.log("[MediaLibraryPicker] Response content-type:", contentType);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MediaLibraryPicker] Upload failed with status:", response.status);
        console.error("[MediaLibraryPicker] Response content-type:", contentType);
        console.error("[MediaLibraryPicker] Error response (first 500 chars):", errorText.substring(0, 500));
        
        // If we got HTML instead of JSON, it's likely an error page
        if (contentType.includes("text/html")) {
          throw new Error(`Server returned HTML error page (${response.status}). The request may not have reached the action handler.`);
        }
        
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }
      
      // Verify we got JSON before parsing
      if (!contentType.includes("application/json")) {
        const responseText = await response.text();
        console.error("[MediaLibraryPicker] Expected JSON but got:", contentType);
        console.error("[MediaLibraryPicker] Response (first 500 chars):", responseText.substring(0, 500));
        throw new Error(`Server returned ${contentType} instead of JSON. Response may be an error page.`);
      }
      
      const result = await response.json();
      console.log("[MediaLibraryPicker] Upload response data:", result);
      
      // Clean up progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setUploadProgress(100);
      setIsUploading(false);
      
      // Small delay to show 100% progress
      setTimeout(() => {
        if (result && typeof result === "object" && result.success && result.file) {
          // Add the new file to the local list
          const newFile = {
            id: result.file.id,
            url: result.file.url,
            alt: result.file.alt || "Uploaded image",
          };
          console.log("[MediaLibraryPicker] Upload successful, file:", newFile);
          setLocalMediaFiles((prev) => [newFile, ...prev]);
          // Automatically select the newly uploaded file
          setSelectedFileId(newFile.id);
          if (hiddenInputRef.current) {
            hiddenInputRef.current.value = newFile.id;
          }
          setUploadError("");
          setUploadSuccess(true);
          // Reload media files from server
          revalidator.revalidate();
          
          // Close picker after successful upload
          setTimeout(() => {
            setShowPicker(false);
            setUploadSuccess(false);
            setUploadProgress(0);
          }, 1500);
        } else {
          const errorMessage = result?.error || result?.message || "Failed to upload file";
          console.error("[MediaLibraryPicker] Upload error:", errorMessage);
          console.error("[MediaLibraryPicker] Full result:", JSON.stringify(result, null, 2));
          setUploadError(errorMessage);
          setUploadProgress(0);
        }
        
        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }, 300);
    } catch (error) {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      console.error("[MediaLibraryPicker] Error uploading file:", error);
      console.error("[MediaLibraryPicker] Error name:", error.name);
      console.error("[MediaLibraryPicker] Error message:", error.message);
      console.error("[MediaLibraryPicker] Error stack:", error.stack);
      
      let errorMessage = "Failed to upload file. Please try again.";
      if (error.message?.includes("timeout")) {
        errorMessage = "Upload timed out. The file may be too large or the server is taking too long to process it.";
      } else if (error.message?.includes("Failed to fetch") || error.message?.includes("NetworkError")) {
        errorMessage = "Network error. Please check your connection and try again.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setUploadError(errorMessage);
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Note: File upload now uses direct fetch() instead of fetcher, so this useEffect is no longer needed
  // Keeping it for now in case we want to revert, but it won't be triggered

  // Sync hidden input when selectedFileId changes
  useEffect(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = selectedFileId;
    }
  }, [selectedFileId]);

  return (
    <>
      <div style={{ marginBottom: "0.5rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
          {label}
        </label>
        <button
          type="button"
          onClick={() => {
            setShowPicker(true);
            setUploadError(""); // Clear any previous error when opening modal
            setUploadSuccess(false);
            setUploadProgress(0);
          }}
          style={{
            width: "100%",
            padding: "0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.875rem",
            backgroundColor: "#f6f6f7",
            cursor: "pointer",
            textAlign: "left",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{selectedFile ? `Selected: ${selectedFile.alt || "Image"}` : `Select ${label} from media library`}</span>
          <span style={{ color: "#666", fontSize: "0.75rem" }}>Browse →</span>
        </button>
        <input
          type="hidden"
          ref={hiddenInputRef}
          name={name}
          value={selectedFileId}
        />
        {selectedFile && selectedFile.url && (
          <div style={{ marginTop: "0.5rem" }}>
            <img
              src={selectedFile.url}
              alt={selectedFile.alt || ""}
              style={{
                maxWidth: "200px",
                maxHeight: "150px",
                objectFit: "contain",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                padding: "0.25rem",
              }}
            />
            <button
              type="button"
              onClick={() => {
                setSelectedFileId("");
                if (hiddenInputRef.current) {
                  hiddenInputRef.current.value = "";
                }
              }}
              style={{
                marginTop: "0.25rem",
                padding: "0.25rem 0.5rem",
                fontSize: "0.75rem",
                color: "#d72c0d",
                border: "none",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Media Library Picker Modal */}
      {showPicker && (
        <div
          onClick={() => setShowPicker(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "white",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "800px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid #e1e3e5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}>Select {label}</h2>
                <button
                  type="button"
                  onClick={() => setShowPicker(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "1.5rem",
                    cursor: "pointer",
                    color: "#666",
                  }}
                >
                  ×
                </button>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <input
                  type="text"
                  placeholder="Search images..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "0.5rem",
                    border: "1px solid #c9cccf",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  style={{ display: "none" }}
                  disabled={isUploading}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  style={{
                    padding: "0.5rem 1rem",
                    border: "1px solid #008060",
                    borderRadius: "4px",
                    fontSize: "0.875rem",
                    backgroundColor: "#008060",
                    color: "white",
                    cursor: isUploading ? "not-allowed" : "pointer",
                    opacity: isUploading ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {isUploading ? "Uploading..." : "Upload Image"}
                </button>
              </div>
              {/* Upload Progress */}
              {isUploading && (
                <div style={{ marginBottom: "0.5rem" }}>
                  <div
                    style={{
                      padding: "0.5rem",
                      backgroundColor: "#f0f9f6",
                      border: "1px solid #008060",
                      borderRadius: "4px",
                      fontSize: "0.875rem",
                      marginBottom: "0.25rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                      <span style={{ color: "#008060", fontWeight: "500" }}>Uploading... {uploadProgress}%</span>
                    </div>
                    <div
                      style={{
                        width: "100%",
                        height: "6px",
                        backgroundColor: "#e1e3e5",
                        borderRadius: "3px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${uploadProgress}%`,
                          height: "100%",
                          backgroundColor: "#008060",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
              
              {/* Success Message */}
              {uploadSuccess && (
                <div
                  style={{
                    padding: "0.5rem",
                    backgroundColor: "#d4edda",
                    border: "1px solid #c3e6cb",
                    borderRadius: "4px",
                    color: "#155724",
                    fontSize: "0.875rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  ✓ File uploaded successfully!
                </div>
              )}
              
              {/* Error Message */}
              {uploadError && (
                <div
                  style={{
                    padding: "0.5rem",
                    backgroundColor: "#fee",
                    border: "1px solid #fcc",
                    borderRadius: "4px",
                    color: "#c00",
                    fontSize: "0.875rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  ✗ {uploadError}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "1.5rem",
                overflowY: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: "1rem",
              }}
            >
              {filteredFiles.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem", color: "#666" }}>
                  {localMediaFiles.length === 0 ? "No images found in media library" : "No images match your search"}
                </div>
              ) : (
                filteredFiles.map((file) => (
                  <div
                    key={file.id}
                    onClick={() => handleSelectFile(file.id, file.url, file.alt)}
                    style={{
                      cursor: "pointer",
                      border: selectedFileId === file.id ? "2px solid #008060" : "1px solid #c9cccf",
                      borderRadius: "4px",
                      padding: "0.5rem",
                      backgroundColor: selectedFileId === file.id ? "#f0f9f6" : "white",
                    }}
                  >
                    <img
                      src={file.url}
                      alt={file.alt || ""}
                      style={{
                        width: "100%",
                        aspectRatio: "1",
                        objectFit: "cover",
                        borderRadius: "4px",
                        marginBottom: "0.5rem",
                      }}
                    />
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#666",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {file.alt || "Untitled"}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function UrlPicker({ name, label, defaultValue = "" }) {
  const [urlType, setUrlType] = useState(() => {
    if (!defaultValue) return "custom";
    if (defaultValue.startsWith("/products/")) return "product";
    if (defaultValue.startsWith("/collections/")) return "collection";
    if (defaultValue.startsWith("/pages/")) return "page";
    if (defaultValue === "/" || defaultValue === "") return "home";
    return "custom";
  });
  const [customUrl, setCustomUrl] = useState(() => {
    if (defaultValue && !defaultValue.startsWith("/products/") && !defaultValue.startsWith("/collections/") && !defaultValue.startsWith("/pages/") && defaultValue !== "/") {
      return defaultValue;
    }
    return "";
  });
  const [productHandle, setProductHandle] = useState("");
  const [collectionHandle, setCollectionHandle] = useState("");
  const [pageHandle, setPageHandle] = useState("");
  const hiddenInputRef = useRef(null);

  useEffect(() => {
    if (hiddenInputRef.current) {
      let finalUrl = "";
      if (urlType === "home") {
        // For home page, use root path - will be converted to full URL in action
        finalUrl = "/";
      } else if (urlType === "product" && productHandle) {
        // Convert to relative URL - will be converted to full URL in action
        finalUrl = `/products/${productHandle}`;
      } else if (urlType === "collection" && collectionHandle) {
        finalUrl = `/collections/${collectionHandle}`;
      } else if (urlType === "page" && pageHandle) {
        finalUrl = `/pages/${pageHandle}`;
      } else if (urlType === "custom") {
        finalUrl = customUrl;
        // Ensure custom URLs have a scheme
        if (finalUrl && !/^(https?|mailto|sms|tel):/i.test(finalUrl)) {
          if (!finalUrl.startsWith("/")) {
            finalUrl = `https://${finalUrl}`;
          } else {
            // Relative URLs need to be converted - for now, add https prefix
            finalUrl = `https://example.com${finalUrl}`;
          }
        }
      }
      hiddenInputRef.current.value = finalUrl;
    }
  }, [urlType, customUrl, productHandle, collectionHandle, pageHandle]);

  return (
    <div style={{ marginBottom: "0.375rem" }}>
      <label style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.8125rem" }}>{label}</label>
      <select
        value={urlType}
        onChange={(e) => setUrlType(e.target.value)}
        style={{
          width: "100%",
          padding: "0.375rem 0.5rem",
          border: "1px solid #c9cccf",
          borderRadius: "4px",
          fontSize: "0.8125rem",
          marginBottom: "0.375rem",
        }}
      >
        <option value="home">Home</option>
        <option value="product">Product</option>
        <option value="collection">Collection</option>
        <option value="page">Page</option>
        <option value="custom">Custom URL</option>
      </select>
      {urlType === "product" && (
        <input
          type="text"
          placeholder="Product handle (e.g., my-product)"
          value={productHandle}
          onChange={(e) => setProductHandle(e.target.value)}
          style={{
            width: "100%",
            padding: "0.375rem 0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.8125rem",
          }}
        />
      )}
      {urlType === "collection" && (
        <input
          type="text"
          placeholder="Collection handle (e.g., my-collection)"
          value={collectionHandle}
          onChange={(e) => setCollectionHandle(e.target.value)}
          style={{
            width: "100%",
            padding: "0.375rem 0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.8125rem",
          }}
        />
      )}
      {urlType === "page" && (
        <input
          type="text"
          placeholder="Page handle (e.g., about-us)"
          value={pageHandle}
          onChange={(e) => setPageHandle(e.target.value)}
          style={{
            width: "100%",
            padding: "0.375rem 0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.8125rem",
          }}
        />
      )}
      {urlType === "custom" && (
        <input
          type="url"
          placeholder="https://example.com or /path"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          style={{
            width: "100%",
            padding: "0.375rem 0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.8125rem",
          }}
        />
      )}
      <input type="hidden" name={name} ref={hiddenInputRef} />
    </div>
  );
}

// RichTextEditor removed - content field no longer used
/*function RichTextEditor({ name, label, defaultValue = "" }) {
  const [html, setHtml] = useState(defaultValue);
  const [isCodeView, setIsCodeView] = useState(false);
  const [codeText, setCodeText] = useState(defaultValue);
  const editorRef = useRef(null);
  const hiddenInputRef = useRef(null);

  useEffect(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = isCodeView ? codeText : html;
    }
  }, [html, codeText, isCodeView]);

  useEffect(() => {
    if (!isCodeView && editorRef.current) {
      editorRef.current.innerHTML = html;
    }
  }, [isCodeView, html]);

  const applyFormat = (command, value = null) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    updateContent();
  };

  const updateContent = () => {
    if (editorRef.current) {
      setHtml(editorRef.current.innerHTML);
    }
  };

  const toggleView = () => {
    if (isCodeView) {
      // Switching from code to visual - parse HTML
      setHtml(codeText);
    } else {
      // Switching from visual to code - get HTML
      if (editorRef.current) {
        const currentHtml = editorRef.current.innerHTML;
        setCodeText(currentHtml);
      }
    }
    setIsCodeView(!isCodeView);
  };

  return (
    <div style={{ marginBottom: "1rem" }}>
      <label
        style={{
          display: "block",
          marginBottom: "0.5rem",
          fontWeight: "500",
        }}
      >
        {label}
      </label>
      <div
        style={{
          border: "1px solid #c9cccf",
          borderRadius: "4px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            borderBottom: "1px solid #c9cccf",
            padding: "0.5rem",
            backgroundColor: "#f6f6f7",
            display: "flex",
            gap: "0.5rem",
          }}
        >
          <button
            type="button"
            onClick={() => applyFormat("bold")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            onClick={() => applyFormat("italic")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            <em>I</em>
          </button>
          <button
            type="button"
            onClick={() => applyFormat("underline")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            U
          </button>
          <div style={{ width: "1px", backgroundColor: "#c9cccf", margin: "0 0.25rem" }} />
          <button
            type="button"
            onClick={toggleView}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: isCodeView ? "#e1e3e5" : "white",
              cursor: "pointer",
              marginLeft: "auto",
            }}
          >
            {isCodeView ? "Visual" : "Code"}
          </button>
          <div style={{ width: "1px", backgroundColor: "#c9cccf", margin: "0 0.25rem" }} />
          <button
            type="button"
            onClick={() => applyFormat("formatBlock", "<h2>")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => applyFormat("formatBlock", "<h3>")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            H3
          </button>
          <button
            type="button"
            onClick={() => applyFormat("insertUnorderedList")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            •
          </button>
          <button
            type="button"
            onClick={() => applyFormat("insertOrderedList")}
            style={{
              padding: "0.25rem 0.5rem",
              border: "1px solid #c9cccf",
              borderRadius: "3px",
              backgroundColor: "white",
              cursor: "pointer",
            }}
          >
            1.
          </button>
        </div>
        {isCodeView ? (
          <textarea
            value={codeText}
            onChange={(e) => {
              setCodeText(e.target.value);
              if (hiddenInputRef.current) {
                hiddenInputRef.current.value = e.target.value;
              }
            }}
            style={{
              width: "100%",
              minHeight: "150px",
              padding: "0.75rem",
              border: "none",
              outline: "none",
              backgroundColor: "white",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              resize: "vertical",
            }}
          />
        ) : (
          <div
            ref={editorRef}
            contentEditable
            onInput={updateContent}
            dangerouslySetInnerHTML={{ __html: html }}
            style={{
              minHeight: "150px",
              padding: "0.75rem",
              outline: "none",
              backgroundColor: "white",
            }}
          />
        )}
      </div>
      <input type="hidden" name={name} ref={hiddenInputRef} value={html} />
    </div>
  );
}*/

export default function SchedulrPage() {
  const { entries, mediaFiles, error: loaderError } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const formRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const handledResponseRef = useRef(null);

  useEffect(() => {
    // Skip if no fetcher data
    if (!fetcher.data) {
      return;
    }

    // Only process when fetcher is idle (not submitting)
    if (fetcher.state !== "idle") {
      return;
    }

    // Create a unique identifier for this response
    const responseId = JSON.stringify(fetcher.data);
    
    // Skip if we've already handled this exact response
    if (handledResponseRef.current === responseId) {
      return;
    }

    console.log("[CLIENT] Handling new fetcher response:", fetcher.data);
    
    if (fetcher.data?.error) {
      console.error("[CLIENT] Error in fetcher data:", fetcher.data.error);
      shopify.toast.show(fetcher.data.error, { isError: true });
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === false) {
      console.error("[CLIENT] Failed to create entry");
      shopify.toast.show("Failed to create entry", { isError: true });
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === true) {
      console.log("[CLIENT] Entry created successfully, reloading entries");
      shopify.toast.show(fetcher.data.message || "Entry created successfully!", { isError: false });
      handledResponseRef.current = responseId;
      // Reload the entries list
      revalidator.revalidate();
      // Reset the form
      if (formRef.current) {
        formRef.current.reset();
      }
      // Close the modal after successful submission
      setShowForm(false);
    }
  }, [fetcher.data, fetcher.state, shopify, revalidator]);

  // Clear handled response when starting a new submission
  useEffect(() => {
    if (fetcher.state === "submitting") {
      handledResponseRef.current = null;
    }
  }, [fetcher.state]);

  useEffect(() => {
    if (loaderError) {
      console.error("[CLIENT] Loader error:", loaderError);
      shopify.toast.show(loaderError, { isError: true });
    }
  }, [loaderError, shopify]);

  const isLoading = navigation.state === "submitting" || fetcher.state === "submitting";

  return (
    <s-page heading="ShopSchedulr | Entries">
      {(loaderError || fetcher.data?.error) && (
        <s-banner tone="critical" title="Error">
          {loaderError || fetcher.data?.error}
        </s-banner>
      )}
      <s-section>
        <h2 style={{ fontSize: "1.2rem", lineHeight: 1.1, margin: "0 0 10px 0" }}>Create Entry</h2>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem 0.75rem",
            border: "none",
            borderRadius: "4px",
            background: "#008060",
            color: "#fff",
            cursor: "pointer",
            fontSize: "0.875rem",
            fontWeight: "600",
          }}
        >
          New Entry
        </button>
      </s-section>

      {/* Modal Overlay */}
      {showForm && (
        <div
          onClick={() => setShowForm(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "white",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "600px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
              position: "relative",
            }}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                position: "absolute",
                top: "1rem",
                right: "1rem",
                background: "transparent",
                border: "none",
                fontSize: "1.5rem",
                cursor: "pointer",
                width: "32px",
                height: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "4px",
                color: "#666",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f0f0f0";
                e.currentTarget.style.color = "#000";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.color = "#666";
              }}
            >
              ×
            </button>

            {/* Modal Content */}
            <div style={{ padding: "1.25rem" }}>
              <s-heading size="large" style={{ marginBottom: "1rem", marginTop: 0 }}>Create New Entry</s-heading>
              <fetcher.Form method="post" ref={formRef} encType="application/x-www-form-urlencoded">
          <s-stack direction="block" gap="base">
            {/* Hidden field to capture user's timezone offset */}
            <input
              type="hidden"
              name="timezone_offset"
              defaultValue={new Date().getTimezoneOffset() * -1}
            />
            <s-text-field
              label="Title"
              name="title"
              required
              placeholder="Display title for this schedulable entry"
            />
            <s-text-field
              label="Position ID"
              name="position_id"
              required
              placeholder="e.g., homepage_banner"
            />
                  <div style={{ display: "flex", gap: "15px", marginBottom: "0.5rem" }}>
                    <div style={{ flex: 1 }}>
                      <label htmlFor="start_at" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.8125rem" }}>
                        Start Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        id="start_at"
                        name="start_at"
                        style={{
                          width: "100%",
                          padding: "0.375rem 0.5rem",
                          border: "1px solid #c9cccf",
                          borderRadius: "4px",
                          fontSize: "0.8125rem",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label htmlFor="end_at" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.8125rem" }}>
                        End Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        id="end_at"
                        name="end_at"
                        style={{
                          width: "100%",
                          padding: "0.375rem 0.5rem",
                          border: "1px solid #c9cccf",
                          borderRadius: "4px",
                          fontSize: "0.8125rem",
                        }}
                      />
                    </div>
                  </div>
                  <s-text-field
                    label="Description"
                    name="description"
                    multiline={3}
                    placeholder="Short description or summary"
                  />
                  <s-url-field
                    label="Target URL"
                    name="target_url"
                    placeholder="https://example.com"
                  />
                  <MediaLibraryPicker
                    name="desktop_banner"
                    label="Desktop Banner"
                    mediaFiles={mediaFiles || []}
                  />
                  <MediaLibraryPicker
                    name="mobile_banner"
                    label="Mobile Banner"
                    mediaFiles={mediaFiles || []}
                  />
                  <s-text-field
                    label="Headline"
                    name="headline"
                    placeholder="Headline text"
                  />
                  <s-text-field
                    label="Button Text"
                    name="button_text"
                    placeholder="Button text"
                  />
                  <s-select
                    label="Entry Status"
                    name="status"
                    defaultValue="active"
                  >
                    <option value="active">Active (published)</option>
                    <option value="draft">Draft (not published)</option>
                  </s-select>
                  <s-button type="submit" disabled={isLoading} variant="primary">
                    {isLoading ? "Creating..." : "Create Entry"}
                  </s-button>
          </s-stack>
        </fetcher.Form>
            </div>
          </div>
        </div>
      )}

      <s-section>
        <h2 style={{ fontSize: "1.2rem", lineHeight: 1.1, margin: "0 0 10px 0" }}>Existing Entries</h2>
        {entries.length === 0 ? (
          <s-text>No entries yet. Create your first schedulable entry above.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {entries.map((e) => {
              const fieldMap = Object.fromEntries(
                (e.fields || []).map((f) => [f.key, f.value]),
              );
              let startDate = "Not set";
              let endDate = "Not set";
              try {
                if (fieldMap.start_at) {
                  const start = new Date(fieldMap.start_at);
                  if (!isNaN(start.getTime())) {
                    startDate = start.toLocaleString();
                  }
                }
              } catch (e) {
                console.error("Error parsing start date:", e);
              }
              try {
                if (fieldMap.end_at) {
                  const end = new Date(fieldMap.end_at);
                  if (!isNaN(end.getTime())) {
                    endDate = end.toLocaleString();
                  }
                }
              } catch (e) {
                console.error("Error parsing end date:", e);
              }
              return (
                <s-box key={e.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-heading>{fieldMap.title || "(untitled)"}</s-heading>
                  {fieldMap.description && (
                    <s-text variant="subdued" style={{ marginTop: "0.5rem" }}>
                      {fieldMap.description}
                    </s-text>
                  )}
                  <s-stack direction="inline" gap="base" style={{ marginTop: "0.75rem" }}>
                    <s-text variant="subdued">Position: {fieldMap.position_id}</s-text>
                  </s-stack>
                  <s-text style={{ marginTop: "0.5rem" }}>
                    {startDate} → {endDate}
                  </s-text>
                  {fieldMap.headline && (
                    <s-text style={{ marginTop: "0.5rem", fontWeight: "600" }}>
                      {fieldMap.headline}
                    </s-text>
                  )}
                  {fieldMap.target_url && (
                    <s-text variant="subdued" style={{ marginTop: "0.5rem" }}>
                      Target: {fieldMap.target_url}
                    </s-text>
                  )}
                  {fieldMap.button_text && (
                    <s-text variant="subdued" style={{ marginTop: "0.5rem" }}>
                      Button: {fieldMap.button_text}
                    </s-text>
                  )}
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
