import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, redirect, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

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
  const entries = json?.data?.metaobjects?.nodes ?? [];

  return { entries };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const positionId = String(formData.get("position_id") || "").trim();
  const startAt = String(formData.get("start_at") || "").trim();
  const endAt = String(formData.get("end_at") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const content = String(formData.get("content") || "").trim();
  const status = String(formData.get("status") || "active").trim();

  // Validate required fields
  if (!positionId || !startAt || !endAt) {
    return {
      error: "Position ID, Start At, and End At are required fields.",
      success: false,
    };
  }

  // Format dates to ISO 8601
  const formatDateTime = (dateStr) => {
    if (!dateStr) return null;
    // If it's already in ISO format, return as-is
    if (dateStr.includes("T")) return dateStr;
    // Otherwise try to parse and format
    try {
      return new Date(dateStr).toISOString();
    } catch {
      return dateStr;
    }
  };

  const fields = [
    { key: "position_id", value: positionId },
    { key: "start_at", value: formatDateTime(startAt) },
    { key: "end_at", value: formatDateTime(endAt) },
  ];

  if (title) fields.push({ key: "title", value: title });
  if (description) fields.push({ key: "description", value: description });
  if (content) fields.push({ key: "content", value: content });
  if (status) fields.push({ key: "status", value: status });

  const response = await admin.graphql(
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
        },
      },
    },
  );
  const json = await response.json();

  if (json?.data?.metaobjectCreate?.userErrors?.length > 0) {
    const errors = json.data.metaobjectCreate.userErrors
      .map((e) => `${e.field}: ${e.message}`)
      .join(", ");
    return {
      error: `Failed to create entry: ${errors}`,
      success: false,
    };
  }

  if (json?.data?.metaobjectCreate?.metaobject?.id) {
    return redirect("/app/schedulr");
  }

  return {
    error: "Unknown error occurred while creating entry.",
    success: false,
  };
};

function RichTextEditor({ name, label, defaultValue = "" }) {
  const [html, setHtml] = useState(defaultValue);
  const editorRef = useRef(null);
  const hiddenInputRef = useRef(null);

  useEffect(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = html;
    }
  }, [html]);

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
      </div>
      <input type="hidden" name={name} ref={hiddenInputRef} value={html} />
    </div>
  );
}

export default function SchedulrPage() {
  const { entries } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigation = useNavigation();

  useEffect(() => {
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    } else if (fetcher.data?.success === false && !fetcher.data?.error) {
      shopify.toast.show("Failed to create entry", { isError: true });
    }
  }, [fetcher.data, shopify]);

  const isLoading = navigation.state === "submitting" || fetcher.state === "submitting";

  return (
    <s-page heading="Schedulr entries">
      <s-section heading="Create entry">
        {fetcher.data?.error && (
          <s-banner tone="critical" title="Error">
            {fetcher.data.error}
          </s-banner>
        )}
        <fetcher.Form method="post">
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
            <s-date-time-field
              name="start_at"
              label="Start Date & Time"
              required
              helpText="When this content should start appearing"
            />
            <s-date-time-field
              name="end_at"
              label="End Date & Time"
              required
              helpText="When this content should stop appearing"
            />
            <RichTextEditor name="content" label="Content" />
            <s-select name="status" label="Status">
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </s-select>
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
              const startDate = fieldMap.start_at
                ? new Date(fieldMap.start_at).toLocaleString()
                : "Not set";
              const endDate = fieldMap.end_at
                ? new Date(fieldMap.end_at).toLocaleString()
                : "Not set";
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
                    {fieldMap.status && (
                      <s-badge tone={fieldMap.status === "active" ? "success" : "info"}>
                        {fieldMap.status}
                      </s-badge>
                    )}
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
