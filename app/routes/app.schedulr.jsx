import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, redirect, useNavigation, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

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
    const json = await response.json();

    console.log("Loader GraphQL response:", JSON.stringify(json, null, 2));

    // Check for GraphQL errors
    if (json?.errors) {
      console.error("GraphQL errors in loader:", JSON.stringify(json.errors, null, 2));
      // If the error is about the type not existing, return empty array
      const errorMessages = json.errors.map((e) => e.message).join(", ");
      if (errorMessages.includes("metaobject definition") || errorMessages.includes("type")) {
        console.warn("Metaobject definition may not exist yet. Returning empty entries.");
        return { entries: [], error: "Metaobject definition not found. Please ensure the app has been properly installed." };
      }
      throw new Error(`GraphQL error: ${errorMessages}`);
    }

    const entries = json?.data?.metaobjects?.nodes ?? [];
    return { entries };
  } catch (error) {
    console.error("Error loading schedulable entities:", error);
    return { 
      entries: [], 
      error: `Failed to load entries: ${error.message}` 
    };
  }
};

export const action = async ({ request }) => {
  console.log("[ACTION] Action called - starting entry creation");
  try {
    const { admin } = await authenticate.admin(request);
    console.log("[ACTION] Admin authenticated successfully");
    const formData = await request.formData();
    console.log("[ACTION] Form data received");

  const positionId = String(formData.get("position_id") || "").trim();
  const startAt = String(formData.get("start_at") || "").trim();
  const endAt = String(formData.get("end_at") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const status = String(formData.get("status") || "active").trim();

  // Query metaobject definition to check if it exists and get content field type
  let contentFieldType = null;
  let definitionExists = false;
  try {
    const defResponse = await admin.graphql(
      `#graphql
      query($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
          fieldDefinitions {
            key
            type { name }
          }
        }
      }
    `,
      { variables: { type: "schedulable_entity" } }
    );
    const defJson = await defResponse.json();
    definitionExists = Boolean(defJson?.data?.metaobjectDefinitionByType?.id);
    
    if (definitionExists) {
      const contentField = defJson?.data?.metaobjectDefinitionByType?.fieldDefinitions?.find(
        (f) => f.key === "content"
      );
      contentFieldType = contentField?.type?.name || null;
      console.log("[ACTION] Metaobject definition exists. Content field type:", contentFieldType);
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
        return {
          error: `Failed to create metaobject definition: ${errors}. Please try again or contact support.`,
          success: false,
        };
      }

      if (createDefJson?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id) {
        console.log("[ACTION] Metaobject definition created successfully");
        definitionExists = true;
        // Set contentFieldType for multi_line_text_field
        contentFieldType = "multi_line_text_field";
      } else {
        return {
          error: "Failed to create metaobject definition. Please try again or contact support.",
          success: false,
        };
      }
    } catch (createDefError) {
      console.error("[ACTION] Error creating metaobject definition:", createDefError);
      return {
        error: `Failed to create metaobject definition: ${createDefError.message}. Please try again or contact support.`,
        success: false,
      };
    }
  }

  // Convert HTML/text to Lexical JSON format for rich_text_field
  const htmlToLexicalJSON = (html) => {
    // Extract text from HTML
    const textContent = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "";
    
    // Create minimal Lexical JSON structure
    return JSON.stringify({
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
    });
  };

  // Validate required fields
  if (!positionId) {
    return {
      error: "Position ID is required.",
      success: false,
    };
  }

  // Format dates to ISO 8601 - datetime-local returns YYYY-MM-DDTHH:mm
  // We need to convert to ISO 8601 format
  const formatDateTime = (dateStr) => {
    if (!dateStr) return null;
    try {
      // datetime-local format is YYYY-MM-DDTHH:mm (no seconds or timezone)
      // We need to add seconds and timezone
      let date;
      if (dateStr.includes("T") && !dateStr.includes("Z") && !dateStr.includes("+")) {
        // datetime-local format - add seconds if not present
        const normalized = dateStr.includes(":") && dateStr.split(":").length === 2
          ? `${dateStr}:00`
          : dateStr;
        date = new Date(normalized);
      } else {
        date = new Date(dateStr);
      }
      if (isNaN(date.getTime())) {
        console.error("Invalid date:", dateStr);
        return null;
      }
      return date.toISOString();
    } catch (error) {
      console.error("Date formatting error:", error, dateStr);
      return null;
    }
  };

  console.log("Raw form data:", {
    positionId,
    startAt,
    endAt,
    title,
    description,
    content,
    status,
  });

  const formattedStartAt = startAt ? formatDateTime(startAt) : null;
  const formattedEndAt = endAt ? formatDateTime(endAt) : null;
  
  console.log("Formatted dates:", {
    formattedStartAt,
    formattedEndAt,
  });

  // Validate date formats only if dates are provided
  if (startAt && !formattedStartAt) {
    return {
      error: "Invalid Start Date format. Please ensure the date is valid.",
      success: false,
    };
  }
  if (endAt && !formattedEndAt) {
    return {
      error: "Invalid End Date format. Please ensure the date is valid.",
      success: false,
    };
  }

  const fields = [
    { key: "position_id", value: positionId },
  ];

  if (formattedStartAt) fields.push({ key: "start_at", value: formattedStartAt });
  if (formattedEndAt) fields.push({ key: "end_at", value: formattedEndAt });

  if (title) fields.push({ key: "title", value: title });
  if (description) fields.push({ key: "description", value: description });
  if (content) {
    // Format content based on field type
    if (contentFieldType && contentFieldType.toLowerCase().includes("rich_text")) {
      // Rich text field requires Lexical JSON format
      fields.push({ key: "content", value: htmlToLexicalJSON(content) });
    } else {
      // Multi-line text field or other types - send as plain text
      // Strip HTML tags for plain text fields
      const plainText = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (plainText) {
        fields.push({ key: "content", value: plainText });
      }
    }
  }

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
    return {
      error: `Failed to create entry: ${errors}`,
      success: false,
    };
  }

  const createdMetaobject = createJson?.data?.metaobjectCreate?.metaobject;
  if (!createdMetaobject?.id) {
    return {
      error: `Unknown error occurred while creating entry. Response: ${JSON.stringify(createJson)}`,
      success: false,
    };
  }

  // For fetcher.Form, we need to return success and let the component handle reload
  // Using redirect with fetcher doesn't work the same way
  console.log("[ACTION] Entry created successfully, returning success");
  return { success: true, message: "Entry created successfully!" };
  } catch (error) {
    console.error("[ACTION] Error in action:", error);
    console.error("[ACTION] Error stack:", error.stack);
    return {
      error: `Failed to create entry: ${error.message}`,
      success: false,
    };
  }
};

function RichTextEditor({ name, label, defaultValue = "" }) {
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
}

export default function SchedulrPage() {
  const { entries, error: loaderError } = useLoaderData();
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
      // Don't close the modal - let user create another entry
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
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            background: "#fff",
            cursor: "pointer",
            fontSize: "1rem",
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
            <div style={{ padding: "2rem" }}>
              <h2 style={{ fontSize: "1.5rem", marginBottom: "1.5rem", marginTop: 0 }}>Create New Entry</h2>
              <fetcher.Form method="post" ref={formRef}>
          <s-stack direction="block" gap="base">
            <label htmlFor="title" style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>Title</label>
            <input
              type="text"
              id="title"
              name="title"
              placeholder="Display title for this schedulable entry"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
            />
            <label htmlFor="position_id" style={{ display: "block", marginTop: "1rem", marginBottom: "0.5rem", fontWeight: "500" }}>Position ID</label>
            <input
              type="text"
              id="position_id"
              name="position_id"
              required
              placeholder="e.g., homepage_banner"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
            />
            <label htmlFor="description" style={{ display: "block", marginTop: "1rem", marginBottom: "0.5rem", fontWeight: "500" }}>Description</label>
            <textarea
              id="description"
              name="description"
              rows={3}
              placeholder="Short description or summary"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
                resize: "vertical",
              }}
            />
            <label
              htmlFor="start_at"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}
            >
              Start Date & Time
            </label>
            <input
              type="datetime-local"
              id="start_at"
              name="start_at"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
            />
            <label
              htmlFor="end_at"
              style={{
                display: "block",
                marginTop: "1rem",
                marginBottom: "0.5rem",
                fontWeight: "500",
              }}
            >
              End Date & Time
            </label>
            <input
              type="datetime-local"
              id="end_at"
              name="end_at"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
            />
            <RichTextEditor name="content" label="Content" />
            <label
              htmlFor="status"
              style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}
            >
              Entry Status
            </label>
            <select
              id="status"
              name="status"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "1rem",
              }}
              defaultValue="active"
            >
              <option value="active">Active (published)</option>
              <option value="draft">Draft (not published)</option>
            </select>
            <button type="submit" disabled={isLoading} style={{
              padding: "0.5rem 0.75rem",
              border: "1px solid #c9cccf",
              borderRadius: "4px",
              background: isLoading ? "#e1e3e5" : "#fff",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontSize: "1rem",
            }}>
              {isLoading ? "Creating..." : "Create Entry"}
            </button>
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
                  {fieldMap.content && (() => {
                    let html = fieldMap.content;
                    try {
                      const parsed = JSON.parse(fieldMap.content);
                      if (parsed && typeof parsed === "object" && parsed.html) {
                        html = parsed.html;
                      }
                    } catch (_) {}
                    return (
                      <div
                        style={{
                          marginTop: "0.75rem",
                          padding: "0.75rem",
                          borderTop: "1px solid #e1e3e5",
                          paddingTop: "0.75rem",
                        }}
                        dangerouslySetInnerHTML={{ __html: html }}
                      />
                    );
                  })()}
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
