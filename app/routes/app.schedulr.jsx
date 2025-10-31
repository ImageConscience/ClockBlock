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
  const desktopBanner = String(formData.get("desktop_banner") || "").trim();
  const mobileBanner = String(formData.get("mobile_banner") || "").trim();
  const targetUrl = String(formData.get("target_url") || "").trim();
  const headline = String(formData.get("headline") || "").trim();
  const buttonText = String(formData.get("button_text") || "").trim();
  const status = String(formData.get("status") || "active").trim();

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
        return {
          error: `Failed to create metaobject definition: ${errors}. Please try again or contact support.`,
          success: false,
        };
      }

      if (createDefJson?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id) {
        console.log("[ACTION] Metaobject definition created successfully");
        definitionExists = true;
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
    return {
      error: "Title is required.",
      success: false,
    };
  }
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
  if (desktopBanner) fields.push({ key: "desktop_banner", value: desktopBanner });
  if (mobileBanner) fields.push({ key: "mobile_banner", value: mobileBanner });
  if (targetUrl) fields.push({ key: "target_url", value: targetUrl });
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
        finalUrl = "/";
      } else if (urlType === "product" && productHandle) {
        finalUrl = `/products/${productHandle}`;
      } else if (urlType === "collection" && collectionHandle) {
        finalUrl = `/collections/${collectionHandle}`;
      } else if (urlType === "page" && pageHandle) {
        finalUrl = `/pages/${pageHandle}`;
      } else if (urlType === "custom") {
        finalUrl = customUrl;
      }
      hiddenInputRef.current.value = finalUrl;
    }
  }, [urlType, customUrl, productHandle, collectionHandle, pageHandle]);

  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <label style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>{label}</label>
      <select
        value={urlType}
        onChange={(e) => setUrlType(e.target.value)}
        style={{
          width: "100%",
          padding: "0.5rem",
          border: "1px solid #c9cccf",
          borderRadius: "4px",
          fontSize: "0.875rem",
          marginBottom: "0.5rem",
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
            padding: "0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.875rem",
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
            padding: "0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.875rem",
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
            padding: "0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.875rem",
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
            padding: "0.5rem",
            border: "1px solid #c9cccf",
            borderRadius: "4px",
            fontSize: "0.875rem",
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
              <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem", marginTop: 0, fontWeight: "600" }}>Create New Entry</h2>
              <fetcher.Form method="post" ref={formRef}>
          <s-stack direction="block" gap="base">
            <label htmlFor="title" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Title</label>
            <input
              type="text"
              id="title"
              name="title"
              required
              placeholder="Display title for this schedulable entry"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
            />
            <label htmlFor="position_id" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Position ID</label>
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
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
            />
             <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.5rem" }}>
              <div style={{ flex: "1" }}>
                <label
                  htmlFor="start_at"
                  style={{ display: "block", marginBottom: "0.375rem", fontWeight: "500", fontSize: "0.875rem" }}
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
                    fontSize: "0.875rem",
                  }}
                />
              </div>
              <div style={{ flex: "1" }}>
                <label
                  htmlFor="end_at"
                  style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}
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
                    fontSize: "0.875rem",
                  }}
                />
              </div>
            </div>
            <label htmlFor="description" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Description</label>
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
                fontSize: "0.875rem",
                resize: "vertical",
                marginBottom: "0.5rem",
              }}
            />
            <label htmlFor="desktop_banner" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Desktop Banner</label>
            <input
              type="file"
              id="desktop_banner"
              name="desktop_banner"
              accept="image/*"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
            />
            <label htmlFor="mobile_banner" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Mobile Banner</label>
            <input
              type="file"
              id="mobile_banner"
              name="mobile_banner"
              accept="image/*"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
            />
            <UrlPicker name="target_url" label="Target URL" />
            <label htmlFor="headline" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Headline</label>
            <input
              type="text"
              id="headline"
              name="headline"
              placeholder="Headline text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
            />
            <label htmlFor="button_text" style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}>Button Text</label>
            <input
              type="text"
              id="button_text"
              name="button_text"
              placeholder="Button text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                fontSize: "0.875rem",
                marginBottom: "0.75rem",
              }}
            />
            <label
              htmlFor="status"
              style={{ display: "block", marginBottom: "0", fontWeight: "500", fontSize: "0.875rem" }}
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
                fontSize: "0.875rem",
                marginBottom: "0.5rem",
              }}
              defaultValue="active"
            >
              <option value="active">Active (published)</option>
              <option value="draft">Draft (not published)</option>
            </select>
            <button type="submit" disabled={isLoading} style={{
              padding: "0.5rem 0.75rem",
              border: "none",
              borderRadius: "4px",
              background: isLoading ? "#e1e3e5" : "#008060",
              color: isLoading ? "#666" : "#fff",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontSize: "0.875rem",
              fontWeight: "600",
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
