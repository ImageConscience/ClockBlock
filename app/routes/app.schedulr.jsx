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
  if (content) fields.push({ key: "content", value: content });

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

  useEffect(() => {
    console.log("[CLIENT] Fetcher data changed:", fetcher.data);
    console.log("[CLIENT] Fetcher state:", fetcher.state);
    if (fetcher.data?.error) {
      console.error("[CLIENT] Error in fetcher data:", fetcher.data.error);
      shopify.toast.show(fetcher.data.error, { isError: true });
    } else if (fetcher.data?.success === false && !fetcher.data?.error) {
      console.error("[CLIENT] Failed to create entry");
      shopify.toast.show("Failed to create entry", { isError: true });
    } else if (fetcher.data?.success === true) {
      console.log("[CLIENT] Entry created successfully, reloading entries");
      shopify.toast.show(fetcher.data.message || "Entry created successfully!", { isError: false });
      // Reload the entries list
      revalidator.revalidate();
      // Reset the form
      if (formRef.current) {
        formRef.current.reset();
      }
    }
    if (loaderError) {
      console.error("[CLIENT] Loader error:", loaderError);
      shopify.toast.show(loaderError, { isError: true });
    }
  }, [fetcher.data, loaderError, shopify, revalidator]);

  const isLoading = navigation.state === "submitting" || fetcher.state === "submitting";

  const handleSubmit = (e) => {
    console.log("[CLIENT] Form submit event triggered");
    const formData = new FormData(e.target);
    console.log("[CLIENT] Form data:", Object.fromEntries(formData.entries()));
  };

  return (
    <s-page heading="Schedulr entries">
      {(loaderError || fetcher.data?.error) && (
        <s-banner tone="critical" title="Error">
          {loaderError || fetcher.data?.error}
        </s-banner>
      )}
      <s-section heading="Create entry">
        <fetcher.Form method="post" ref={formRef} onSubmit={handleSubmit}>
          <s-stack direction="block" gap="base">
            <s-text-field
              name="title"
              label="Title"
              helpText="Display title for this schedulable entry"
            />
            <s-text-field
              name="position_id"
              label="Position ID"
              required
              helpText="Unique identifier for where this content should appear (e.g., homepage_banner)"
            />
            <s-text-field
              name="description"
              label="Description"
              multiline={3}
              helpText="Short description or summary"
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
            <s-button submit loading={isLoading}>
              Create Entry
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Existing entries">
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
                  {fieldMap.content && (
                    <div
                      style={{
                        marginTop: "0.75rem",
                        padding: "0.75rem",
                        borderTop: "1px solid #e1e3e5",
                        paddingTop: "0.75rem",
                      }}
                      dangerouslySetInnerHTML={{ __html: fieldMap.content }}
                    />
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
