import { useCallback, useEffect, useRef, useState, useId } from "react";
import { useFetcher, useLoaderData, useNavigation, useRevalidator, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Redirect } from "@shopify/app-bridge/actions";
import { boundary } from "@shopify/shopify-app-react-router/server";
import PropTypes from "prop-types";
export { loader, action } from "../services/clockblock.server";

const isDevEnvironment =
  (typeof import.meta !== "undefined" && import.meta.env?.MODE !== "production") || typeof import.meta === "undefined";
const debugLog = (...args) => {
  if (isDevEnvironment) {
    console.log(...args);
  }
};

export default function ClockBlockPage() {
  const loaderData = useLoaderData();
  const initialEntries = loaderData?.entries ?? [];
  const loaderMediaFiles = loaderData?.mediaFiles ?? [];
  const mediaFiles = loaderMediaFiles;
  const loaderError = loaderData?.error ?? null;
  const redirectUrl = loaderData?.redirectUrl ?? null;
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const formRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [formStatusActive, setFormStatusActive] = useState(false);
  const handledResponseRef = useRef(null);
  const [sortConfig, setSortConfig] = useState([]); // Array of {column: string, direction: 'asc'|'desc'}
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [userTimeZone, setUserTimeZone] = useState("UTC");
  const [userTimezoneOffset, setUserTimezoneOffset] = useState(0);
  const statusInputId = useId();

  const performRedirect = useCallback(
    (url, source) => {
      if (!url) {
        return;
      }

      debugLog(`[CLIENT] Billing redirect requested from ${source}:`, url);

      if (shopify) {
        try {
          const redirect = Redirect.create(shopify);
          redirect.dispatch(Redirect.Action.REMOTE, {
            url,
            newContext: true,
          });
          return;
        } catch (error) {
          console.error("[CLIENT] Failed to dispatch App Bridge redirect:", error);
        }
      }

      if (typeof window !== "undefined") {
        if (window.top) {
          window.top.location.href = url;
        } else {
          window.location.href = url;
        }
      }
    },
    [shopify],
  );

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

    debugLog("[CLIENT] Handling new fetcher response:", fetcher.data);
    if (fetcher.data?.redirectUrl) {
      performRedirect(fetcher.data.redirectUrl, "action");
      handledResponseRef.current = responseId;
      return;
    }
    
    if (fetcher.data?.error) {
      console.error("[CLIENT] Error in fetcher data:", fetcher.data.error);
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === false) {
      console.error("[CLIENT] Failed to create entry");
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === true) {
      debugLog("[CLIENT] Entry created successfully, reloading entries");
      handledResponseRef.current = responseId;
      // Reload the entries list
      revalidator.revalidate();
      // Reset the form
      if (formRef.current) {
        formRef.current.reset();
      }
      // Reset toggle state
      setFormStatusActive(false);
      // Close the modal after successful submission
      setShowForm(false);
    }
  }, [fetcher.data, fetcher.state, performRedirect, revalidator]);

  // Clear handled response when starting a new submission
  useEffect(() => {
    if (fetcher.state === "submitting") {
      handledResponseRef.current = null;
    }
  }, [fetcher.state]);

  useEffect(() => {
    if (loaderError) {
      console.error("[CLIENT] Loader error:", loaderError);
    }
  }, [loaderError]);

  useEffect(() => {
    if (!redirectUrl) {
      return;
    }
    performRedirect(redirectUrl, "loader");
  }, [redirectUrl, performRedirect]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const resolvedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setUserTimeZone(resolvedZone || "UTC");
      setUserTimezoneOffset(new Date().getTimezoneOffset() * -1);
    }
  }, []);

  // Function to close form and reset toggle
  const handleCloseForm = () => {
    setShowForm(false);
    setFormStatusActive(false);
    if (formRef.current) {
      formRef.current.reset();
    }
  };

  const isLoading = navigation.state === "submitting" || fetcher.state === "submitting";

  return (
    <s-page heading="ClockBlock | Entries">
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
          role="presentation"
          aria-hidden="true"
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
            role="dialog"
            aria-modal="true"
            aria-label="Create new entry"
            tabIndex={-1}
            style={{
              backgroundColor: "white",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "600px",
              maxHeight: "90vh",
              overflowY: "auto",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div style={{ padding: "1.5rem", borderBottom: "1px solid #e1e3e5" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}>Create New Entry</h2>
                <button
                  type="button"
                  onClick={handleCloseForm}
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
            </div>

            {/* Modal Content */}
            <div style={{ padding: "1.5rem" }}>
              <fetcher.Form method="post" ref={formRef} encType="application/x-www-form-urlencoded">
          <s-stack direction="block" gap="base">
            {/* Hidden field to capture user's timezone offset */}
            <input
              type="hidden"
              name="timezone_offset"
              value={userTimezoneOffset}
              readOnly
            />
            <input
              type="hidden"
              name="timezone"
              value={userTimeZone}
              readOnly
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
                    <div style={{ flex: 1, minWidth: 0 }}>
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
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
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
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </div>
                  <s-url-field
                    label="Target URL"
                    name="target_url"
                    placeholder="https://example.com"
                  />
                  <div style={{ display: "flex", gap: "15px", marginBottom: "0.5rem" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MediaLibraryPicker
                        name="desktop_banner"
                        label="Desktop Banner"
                        mediaFiles={loaderMediaFiles || []}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MediaLibraryPicker
                        name="mobile_banner"
                        label="Mobile Banner"
                        mediaFiles={loaderMediaFiles || []}
                      />
                    </div>
                  </div>
                  <s-text-field
                    label="Headline"
                    name="headline"
                    placeholder="Headline text"
                  />
                  <s-text-field
                    label="Description"
                    name="description"
                    multiline={3}
                    placeholder="Short description or summary"
                  />
                  <s-text-field
                    label="Button Text"
                    name="button_text"
                    placeholder="Button text"
                  />
                  <div style={{ marginBottom: "0.5rem" }}>
                    <p style={{ marginBottom: "0.5rem", fontWeight: "500", fontSize: "0.875rem" }}>
                      Entry Status
                    </p>
                    <label
                      htmlFor={statusInputId}
                      style={{ 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "0.5rem",
                        cursor: "pointer",
                        position: "relative",
                      }}
                    >
                      <input
                        id={statusInputId}
                        type="checkbox"
                        name="status"
                        value="on"
                        checked={formStatusActive}
                        onChange={(e) => setFormStatusActive(e.target.checked)}
                        style={{
                          opacity: 0,
                          width: 0,
                          height: 0,
                          position: "absolute",
                        }}
                      />
                      <span
                        style={{
                          position: "relative",
                          cursor: "pointer",
                          width: "44px",
                          height: "24px",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            width: "1px",
                            height: "1px",
                            padding: 0,
                            margin: "-1px",
                            overflow: "hidden",
                            clip: "rect(0, 0, 0, 0)",
                            whiteSpace: "nowrap",
                            border: 0,
                          }}
                        >
                          {formStatusActive ? "Set entry to draft" : "Set entry to active"}
                        </span>
                        <span
                          style={{
                            position: "absolute",
                            cursor: "pointer",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: formStatusActive ? "#667eea" : "#c9cccf",
                            borderRadius: "24px",
                            transition: "background-color 0.2s",
                          }}
                          className="toggle-track"
                        >
                          <span
                            style={{
                              position: "absolute",
                              content: '""',
                              height: "18px",
                              width: "18px",
                              left: formStatusActive ? "22px" : "3px",
                              bottom: "3px",
                              backgroundColor: "white",
                              borderRadius: "50%",
                              transition: "left 0.2s",
                              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                            }}
                            className="toggle-thumb"
                          />
                        </span>
                      </span>
                      <span style={{ fontSize: "0.875rem", color: "#667eea", fontWeight: "500" }}>
                        Active (published)
                      </span>
                    </label>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={handleCloseForm}
                      disabled={isLoading}
                      style={{
                        padding: "0.5rem 1rem",
                        border: "1px solid #c9cccf",
                        borderRadius: "4px",
                        backgroundColor: "white",
                        cursor: isLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      Cancel
                    </button>
                    <s-button type="submit" disabled={isLoading} variant="primary">
                      {isLoading ? "Creating..." : "Create Entry"}
                    </s-button>
                  </div>
          </s-stack>
        </fetcher.Form>
            </div>
          </div>
        </div>
      )}

      <s-section>
        <h2 style={{ fontSize: "1.2rem", lineHeight: 1.1, margin: "0 0 10px 0" }}>Existing Entries</h2>
        {initialEntries.length === 0 ? (
          <s-text>No entries yet. Create your first schedulable entry above.</s-text>
        ) : (
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                {(() => {
                  // Sort handler function
                  const handleSort = (column) => {
                    setSortConfig((prev) => {
                      const existingIndex = prev.findIndex((s) => s.column === column);
                      
                      if (existingIndex >= 0) {
                        // Column already in sort - toggle direction
                        const updated = [...prev];
                        if (updated[existingIndex].direction === 'asc') {
                          updated[existingIndex] = { column, direction: 'desc' };
                        } else {
                          // Remove from sort if going from desc to nothing
                          updated.splice(existingIndex, 1);
                        }
                        return updated;
                      } else {
                        // New column - add with ascending
                        return [...prev, { column, direction: 'asc' }];
                      }
                    });
                  };
                  
                  // Get sort direction for a column
                  const getSortDirection = (column) => {
                    const sort = sortConfig.find((s) => s.column === column);
                    return sort ? sort.direction : null;
                  };
                  
                  // Get sort order (priority) for a column
                  const getSortOrder = (column) => {
                    const index = sortConfig.findIndex((s) => s.column === column);
                    return index >= 0 ? index + 1 : null;
                  };
                  
                  return (
                    <tr style={{ borderBottom: "2px solid #e1e3e5", backgroundColor: "#f6f6f7" }}>
                      <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: "600", borderRight: "1px solid #e1e3e5", width: "60px" }}>
                        Active
                      </th>
                      <th 
                        style={{ 
                          padding: "0.75rem", 
                          textAlign: "left", 
                          fontWeight: "600", 
                          borderRight: "1px solid #e1e3e5",
                          cursor: "pointer",
                          userSelect: "none",
                          position: "relative"
                        }}
                        onClick={() => handleSort('title')}
                      >
                        Title {getSortDirection('title') && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#667eea" }}>
                            {getSortDirection('title') === 'asc' ? '↑' : '↓'} {getSortOrder('title')}
                          </span>
                        )}
                      </th>
                      <th 
                        style={{ 
                          padding: "0.75rem", 
                          textAlign: "left", 
                          fontWeight: "600", 
                          borderRight: "1px solid #e1e3e5",
                          cursor: "pointer",
                          userSelect: "none"
                        }}
                        onClick={() => handleSort('position_id')}
                      >
                        Position ID {getSortDirection('position_id') && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#667eea" }}>
                            {getSortDirection('position_id') === 'asc' ? '↑' : '↓'} {getSortOrder('position_id')}
                          </span>
                        )}
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600", borderRight: "1px solid #e1e3e5" }}>
                        Desktop Banner
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: "600", borderRight: "1px solid #e1e3e5" }}>
                        Mobile Banner
                      </th>
                      <th 
                        style={{ 
                          padding: "0.75rem", 
                          textAlign: "left", 
                          fontWeight: "600", 
                          borderRight: "1px solid #e1e3e5",
                          cursor: "pointer",
                          userSelect: "none"
                        }}
                        onClick={() => handleSort('start_at')}
                      >
                        Start At {getSortDirection('start_at') && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#667eea" }}>
                            {getSortDirection('start_at') === 'asc' ? '↑' : '↓'} {getSortOrder('start_at')}
                          </span>
                        )}
                      </th>
                      <th 
                        style={{ 
                          padding: "0.75rem", 
                          textAlign: "left", 
                          fontWeight: "600", 
                          borderRight: "1px solid #e1e3e5",
                          cursor: "pointer",
                          userSelect: "none"
                        }}
                        onClick={() => handleSort('end_at')}
                      >
                        End At {getSortDirection('end_at') && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#667eea" }}>
                            {getSortDirection('end_at') === 'asc' ? '↑' : '↓'} {getSortOrder('end_at')}
                          </span>
                        )}
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: "600", borderRight: "1px solid #e1e3e5", width: "80px" }}>
                        Edit
                      </th>
                      <th style={{ padding: "0.75rem", textAlign: "center", fontWeight: "600", width: "80px" }}>
                        Delete
                      </th>
                    </tr>
                  );
                })()}
              </thead>
              <tbody>
                {(() => {
                  // Sort entries based on sortConfig
                  const sortedEntries = [...initialEntries].sort((a, b) => {
                    // Pre-compute field maps once per comparison
                    const fieldMapA = Object.fromEntries((a.fields || []).map((f) => [f.key, f.value]));
                    const fieldMapB = Object.fromEntries((b.fields || []).map((f) => [f.key, f.value]));
                    
                    // Apply all active sorts in order
                    for (const sort of sortConfig) {
                      let valueA = fieldMapA[sort.column];
                      let valueB = fieldMapB[sort.column];
                      
                      // Handle date fields
                      if (sort.column === 'start_at' || sort.column === 'end_at') {
                        valueA = valueA ? new Date(valueA).getTime() : 0;
                        valueB = valueB ? new Date(valueB).getTime() : 0;
                      } else if (typeof valueA === 'string') {
                        valueA = valueA.toLowerCase();
                      }
                      if (typeof valueB === 'string') {
                        valueB = valueB.toLowerCase();
                      }
                      
                      // Handle null/undefined
                      if (valueA == null || valueA === '') valueA = '';
                      if (valueB == null || valueB === '') valueB = '';
                      
                      // Compare
                      let comparison = 0;
                      if (valueA < valueB) {
                        comparison = -1;
                      } else if (valueA > valueB) {
                        comparison = 1;
                      }
                      
                      // Apply direction - if values differ, return the comparison
                      // Otherwise continue to next sort criterion
                      if (comparison !== 0) {
                        return sort.direction === 'asc' ? comparison : -comparison;
                      }
                    }
                    // All sorts matched - items are equal
                    return 0;
                  });
                  
                  return sortedEntries.map((e) => {
                  const fieldMap = Object.fromEntries(
                    (e.fields || []).map((f) => [f.key, f.value]),
                  );
                  const referenceMap = Object.fromEntries(
                    (e.fields || []).map((f) => [f.key, f.reference]),
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
                  
                  const desktopBanner = referenceMap.desktop_banner;
                  const mobileBanner = referenceMap.mobile_banner;
                  const desktopBannerUrl = desktopBanner?.image?.url || null;
                  const mobileBannerUrl = mobileBanner?.image?.url || null;
                  
                  // Get publishable status
                  const isActive = e.capabilities?.publishable?.status === "ACTIVE";
                  const toggleId = `${e.id}-status-toggle`;
                  
                  // Handler for toggle status
                  const handleToggleStatus = async () => {
                    const newStatus = isActive ? "DRAFT" : "ACTIVE";
                    try {
                      const response = await fetch(window.location.pathname, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          intent: "toggleStatus",
                          id: e.id,
                          status: newStatus,
                        }),
                        credentials: "include",
                      });
                      
                      const result = await response.json();
                      
                      if (result.success) {
                        revalidator.revalidate();
                      } else {
                        console.error("Failed to toggle status:", result.error);
                      }
                    } catch (err) {
                      console.error("Error toggling status:", err);
                    }
                  };
                  
                  return (
                    <tr key={e.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", textAlign: "center" }}>
                        <label 
                          htmlFor={toggleId}
                          style={{ 
                            display: "inline-flex", 
                            alignItems: "center", 
                            justifyContent: "center", 
                            cursor: "pointer",
                            position: "relative",
                            width: "44px",
                            height: "24px",
                          }}
                        >
                          <input
                            id={toggleId}
                            type="checkbox"
                            checked={isActive}
                            onChange={handleToggleStatus}
                            aria-label={isActive ? "Set entry to draft status" : "Set entry to active status"}
                            style={{
                              opacity: 0,
                              width: 0,
                              height: 0,
                              position: "absolute",
                            }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              cursor: "pointer",
                              top: 0,
                              left: 0,
                              right: 0,
                              bottom: 0,
                              backgroundColor: isActive ? "#667eea" : "#c9cccf",
                              borderRadius: "24px",
                              transition: "background-color 0.2s",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                width: "1px",
                                height: "1px",
                                padding: 0,
                                margin: "-1px",
                                overflow: "hidden",
                                clip: "rect(0, 0, 0, 0)",
                                whiteSpace: "nowrap",
                                border: 0,
                              }}
                            >
                              {isActive ? "Set entry to draft" : "Set entry to active"}
                            </span>
                            <span
                              style={{
                                position: "absolute",
                                content: '""',
                                height: "18px",
                                width: "18px",
                                left: isActive ? "22px" : "3px",
                                bottom: "3px",
                                backgroundColor: "white",
                                borderRadius: "50%",
                                transition: "left 0.2s",
                                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                              }}
                            />
                          </span>
                        </label>
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", fontWeight: "500" }}>
                        {fieldMap.title || "(untitled)"}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5" }}>
                        {fieldMap.position_id || "-"}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", fontSize: "0.8125rem", textAlign: "center" }}>
                        {desktopBannerUrl ? (
                          <img 
                            src={desktopBannerUrl} 
                            alt="Desktop banner" 
                            style={{ maxWidth: "100px", maxHeight: "60px", objectFit: "contain", border: "1px solid #e1e3e5", borderRadius: "4px" }}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", fontSize: "0.8125rem", textAlign: "center" }}>
                        {mobileBannerUrl ? (
                          <img 
                            src={mobileBannerUrl} 
                            alt="Mobile banner" 
                            style={{ maxWidth: "100px", maxHeight: "60px", objectFit: "contain", border: "1px solid #e1e3e5", borderRadius: "4px" }}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", fontSize: "0.8125rem", color: "#666" }}>
                        {startDate}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", fontSize: "0.8125rem", color: "#666" }}>
                        {endDate}
                      </td>
                      <td style={{ padding: "0.75rem", borderRight: "1px solid #e1e3e5", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEntry(e);
                            setEditModalOpen(true);
                          }}
                          style={{
                            fontSize: "0.8125rem",
                            color: "#667eea",
                            textDecoration: "underline",
                            cursor: "pointer",
                            background: "none",
                            border: "none",
                            padding: 0,
                          }}
                        >
                          Edit
                        </button>
                      </td>
                      <td style={{ padding: "0.75rem", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedEntry(e);
                            setDeleteModalOpen(true);
                          }}
                          style={{
                            fontSize: "0.8125rem",
                            color: "#d72c0d",
                            textDecoration: "underline",
                            cursor: "pointer",
                            background: "none",
                            border: "none",
                            padding: 0,
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Edit Modal */}
      {editModalOpen && selectedEntry && (
        <EditEntryModal
          entry={selectedEntry}
          mediaFiles={mediaFiles}
          userTimeZone={userTimeZone}
          userTimezoneOffset={userTimezoneOffset}
          onClose={() => {
            setEditModalOpen(false);
            setSelectedEntry(null);
          }}
          onSuccess={() => {
            setEditModalOpen(false);
            setSelectedEntry(null);
            revalidator.revalidate();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && selectedEntry && (
        <DeleteEntryModal
          entry={selectedEntry}
          onClose={() => {
            setDeleteModalOpen(false);
            setSelectedEntry(null);
          }}
          onSuccess={() => {
            setDeleteModalOpen(false);
            setSelectedEntry(null);
            revalidator.revalidate();
          }}
        />
      )}
    </s-page>
  );
}

// Edit Entry Modal Component
function EditEntryModal({ entry, mediaFiles, onClose, onSuccess, userTimeZone, userTimezoneOffset }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const baseId = useId();
  const titleInputId = `${baseId}-title`;
  const positionInputId = `${baseId}-position`;
  const startInputId = `${baseId}-start`;
  const endInputId = `${baseId}-end`;
  const headlineInputId = `${baseId}-headline`;
  const descriptionInputId = `${baseId}-description`;
  const targetUrlInputId = `${baseId}-target-url`;
  const buttonTextInputId = `${baseId}-button-text`;
  
  const fieldMap = Object.fromEntries(
    (entry.fields || []).map((f) => [f.key, f.value]),
  );
  
  // Parse dates for datetime-local inputs
  const getDateTimeLocal = (isoDate) => {
    if (!isoDate) return "";
    try {
      const date = new Date(isoDate);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    } catch (e) {
      return "";
    }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    
    const formData = new FormData(e.target);
    const updateData = {
      id: entry.id,
      title: formData.get("title"),
      positionId: formData.get("position_id"),
      headline: formData.get("headline") || "",
      description: formData.get("description") || "",
      startAt: formData.get("start_at") || null,
      endAt: formData.get("end_at") || null,
      desktopBanner: formData.get("desktop_banner") || "",
      mobileBanner: formData.get("mobile_banner") || "",
      targetUrl: formData.get("target_url") || "",
      buttonText: formData.get("button_text") || "",
      timezone: formData.get("timezone") || "",
      timezoneOffset: formData.get("timezone_offset") || "",
    };
    
    try {
      const response = await fetch(window.location.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "update",
          ...updateData,
        }),
        credentials: "include",
      });
      
      const result = await response.json();
      
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error || "Failed to update entry");
        setIsSubmitting(false);
      }
    } catch (err) {
      setError(err.message || "Failed to update entry");
      setIsSubmitting(false);
    }
  };
  
  return (
    <div
      role="presentation"
      aria-hidden="true"
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
        role="dialog"
        aria-modal="true"
        aria-label="Edit entry"
        tabIndex={-1}
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          width: "100%",
          maxWidth: "600px",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div style={{ padding: "1.5rem", borderBottom: "1px solid #e1e3e5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}>Edit Entry</h2>
            <button
              type="button"
              onClick={onClose}
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
        </div>
        <form onSubmit={handleSubmit} style={{ padding: "1.5rem" }}>
          {error && (
            <div style={{ padding: "0.75rem", marginBottom: "1rem", backgroundColor: "#fee", color: "#d72c0d", borderRadius: "4px" }}>
              {error}
            </div>
          )}
          <input type="hidden" name="timezone" value={userTimeZone ?? "UTC"} readOnly />
          <input type="hidden" name="timezone_offset" value={userTimezoneOffset ?? 0} readOnly />
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={titleInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Title <span style={{ color: "#d72c0d" }}>*</span>
            </label>
            <input
              type="text"
              id={titleInputId}
              name="title"
              defaultValue={fieldMap.title || ""}
              required
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={positionInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Position ID <span style={{ color: "#d72c0d" }}>*</span>
            </label>
            <input
              type="text"
              id={positionInputId}
              name="position_id"
              defaultValue={fieldMap.position_id || ""}
              required
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: "15px", marginBottom: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor={startInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
                Start Date & Time
              </label>
              <input
                type="datetime-local"
                id={startInputId}
                name="start_at"
                defaultValue={getDateTimeLocal(fieldMap.start_at)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <label htmlFor={endInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
                End Date & Time
              </label>
              <input
                type="datetime-local"
                id={endInputId}
                name="end_at"
                defaultValue={getDateTimeLocal(fieldMap.end_at)}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: "15px", marginBottom: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MediaLibraryPicker
                name="desktop_banner"
                label="Desktop Banner"
                mediaFiles={mediaFiles}
                defaultValue={fieldMap.desktop_banner || ""}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <MediaLibraryPicker
                name="mobile_banner"
                label="Mobile Banner"
                mediaFiles={mediaFiles}
                defaultValue={fieldMap.mobile_banner || ""}
              />
            </div>
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={headlineInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Headline
            </label>
            <input
              type="text"
              id={headlineInputId}
              name="headline"
              defaultValue={fieldMap.headline || ""}
              placeholder="Headline text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={descriptionInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Description
            </label>
            <input
              type="text"
              id={descriptionInputId}
              name="description"
              defaultValue={fieldMap.description || ""}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={targetUrlInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Target URL
            </label>
            <input
              type="text"
              id={targetUrlInputId}
              name="target_url"
              defaultValue={fieldMap.target_url || ""}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor={buttonTextInputId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
              Button Text
            </label>
            <input
              type="text"
              id={buttonTextInputId}
              name="button_text"
              defaultValue={fieldMap.button_text || ""}
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                backgroundColor: "white",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                padding: "0.5rem 1rem",
                border: "none",
                borderRadius: "4px",
                backgroundColor: "#667eea",
                color: "white",
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? "Updating..." : "Update Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Delete Confirmation Modal Component
function DeleteEntryModal({ entry, onClose, onSuccess }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  
  const fieldMap = Object.fromEntries(
    (entry.fields || []).map((f) => [f.key, f.value]),
  );
  
  const handleDelete = async () => {
    setIsDeleting(true);
    setError("");
    
    try {
      const response = await fetch(window.location.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "delete",
          id: entry.id,
        }),
        credentials: "include",
      });
      
      const result = await response.json();
      
      if (result.success) {
        onSuccess();
      } else {
        setError(result.error || "Failed to delete entry");
        setIsDeleting(false);
      }
    } catch (err) {
      setError(err.message || "Failed to delete entry");
      setIsDeleting(false);
    }
  };
  
  return (
    <div
      role="presentation"
      aria-hidden="true"
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
        role="dialog"
        aria-modal="true"
        aria-label="Delete entry confirmation"
        tabIndex={-1}
        style={{
          backgroundColor: "white",
          borderRadius: "8px",
          width: "100%",
          maxWidth: "500px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
        }}
      >
        <div style={{ padding: "1.5rem", borderBottom: "1px solid #e1e3e5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: "600" }}>Delete Entry</h2>
            <button
              type="button"
              onClick={onClose}
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
        </div>
        <div style={{ padding: "1.5rem" }}>
          {error && (
            <div style={{ padding: "0.75rem", marginBottom: "1rem", backgroundColor: "#fee", color: "#d72c0d", borderRadius: "4px" }}>
              {error}
            </div>
          )}
          <p style={{ margin: "0 0 1rem 0" }}>
            Are you sure you want to delete <strong>{fieldMap.title || "(untitled)"}</strong>? This action cannot be undone.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                backgroundColor: "white",
                cursor: isDeleting ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              style={{
                padding: "0.5rem 1rem",
                border: "none",
                borderRadius: "4px",
                backgroundColor: "#d72c0d",
                color: "white",
                cursor: isDeleting ? "not-allowed" : "pointer",
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const triggerId = useId();

  const selectedFile = localMediaFiles.find((f) => f.id === selectedFileId);

  useEffect(() => {
    setLocalMediaFiles(mediaFiles);
  }, [mediaFiles]);

  const handleSelectFile = (fileId) => {
    setSelectedFileId(fileId);
    setShowPicker(false);
    setSearchTerm("");
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = fileId;
    }
  };

  const filteredFiles = localMediaFiles.filter((file) =>
    (file.alt || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (file.url || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    debugLog("[MediaLibraryPicker] File selected:", file?.name, "Size:", file?.size, "Type:", file?.type);

    if (!file) {
      debugLog("[MediaLibraryPicker] No file selected");
      return;
    }

    if (!file.type.startsWith("image/")) {
      debugLog("[MediaLibraryPicker] Invalid file type:", file.type);
      setUploadError("Please upload an image file");
      return;
    }

    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    setIsUploading(true);
    setUploadError("");
    setUploadSuccess(false);
    setUploadProgress(0);

    progressIntervalRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + 10;
      });
    }, 500);

    try {
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);
      debugLog("[MediaLibraryPicker] FormData created, submitting...");
      debugLog("[MediaLibraryPicker] Submitting FormData with file:", file.name, "Size:", file.size, "Type:", file.type);

      const uploadStartTime = Date.now();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Upload timeout: Request took longer than 60 seconds")), 60000);
      });
      const fetchPromise = fetch(window.location.pathname, {
        method: "POST",
        body: uploadFormData,
        credentials: "include",
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);
      const uploadDuration = Date.now() - uploadStartTime;

      debugLog("[MediaLibraryPicker] Upload response received after", uploadDuration, "ms, status:", response.status);

      const contentType = response.headers.get("content-type") || "";
      debugLog("[MediaLibraryPicker] Response content-type:", contentType);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MediaLibraryPicker] Upload failed with status:", response.status);
        console.error("[MediaLibraryPicker] Response content-type:", contentType);
        console.error("[MediaLibraryPicker] Error response (first 500 chars):", errorText.substring(0, 500));
        if (contentType.includes("text/html")) {
          throw new Error(`Server returned HTML error page (${response.status}). The request may not have reached the action handler.`);
        }
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      if (!contentType.includes("application/json")) {
        const responseText = await response.text();
        console.error("[MediaLibraryPicker] Expected JSON but got:", contentType);
        console.error("[MediaLibraryPicker] Response (first 500 chars):", responseText.substring(0, 500));
        throw new Error(`Server returned ${contentType} instead of JSON. Response may be an error page.`);
      }

      const result = await response.json();
      debugLog("[MediaLibraryPicker] Upload response data:", result);

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      setUploadProgress(100);
      setIsUploading(false);

      setTimeout(() => {
        if (result && typeof result === "object" && result.success && result.file) {
          const newFile = {
            id: result.file.id,
            url: result.file.url,
            alt: result.file.alt || "Uploaded image",
            createdAt: result.file.createdAt || new Date().toISOString(),
          };
          debugLog("[MediaLibraryPicker] Upload successful, file:", newFile);
          setLocalMediaFiles((prev) => [newFile, ...prev]);
          setSelectedFileId(newFile.id);
          if (hiddenInputRef.current) {
            hiddenInputRef.current.value = newFile.id;
          }
          setUploadError("");
          setUploadSuccess(true);
          revalidator.revalidate();

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

  useEffect(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = selectedFileId;
    }
  }, [selectedFileId]);

  return (
    <>
      <div style={{ marginBottom: "0.5rem" }}>
        <label htmlFor={triggerId} style={{ display: "block", marginBottom: "0.5rem", fontWeight: "500" }}>
          {label}
        </label>
        <button
          type="button"
          id={triggerId}
          onClick={() => {
            setShowPicker(true);
            setUploadError("");
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
        <input type="hidden" ref={hiddenInputRef} name={name} value={selectedFileId} />
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

      {showPicker && (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Close ${label} picker`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShowPicker(false);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setShowPicker(false);
              return;
            }
            if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
              event.preventDefault();
              setShowPicker(false);
            }
          }}
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
            role="dialog"
            aria-modal="true"
            aria-label={`Select ${label}`}
            tabIndex={-1}
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
                  <button
                    type="button"
                    key={file.id}
                    onClick={() => handleSelectFile(file.id)}
                    aria-pressed={selectedFileId === file.id}
                    style={{
                      cursor: "pointer",
                      border: selectedFileId === file.id ? "2px solid #008060" : "1px solid #c9cccf",
                      borderRadius: "4px",
                      padding: "0.5rem",
                      backgroundColor: selectedFileId === file.id ? "#f0f9f6" : "white",
                      textAlign: "left",
                      width: "100%",
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
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const mediaFileShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  url: PropTypes.string,
  alt: PropTypes.string,
  image: PropTypes.shape({
    url: PropTypes.string,
    width: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }),
});

MediaLibraryPicker.propTypes = {
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  mediaFiles: PropTypes.arrayOf(mediaFileShape),
  defaultValue: PropTypes.string,
};

EditEntryModal.propTypes = {
  entry: PropTypes.shape({
    id: PropTypes.string.isRequired,
    fields: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string,
        value: PropTypes.string,
        reference: PropTypes.object,
      }),
    ),
  }).isRequired,
  mediaFiles: PropTypes.arrayOf(mediaFileShape),
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
  userTimeZone: PropTypes.string,
  userTimezoneOffset: PropTypes.number,
};

DeleteEntryModal.propTypes = {
  entry: PropTypes.shape({
    id: PropTypes.string.isRequired,
    fields: PropTypes.arrayOf(
      PropTypes.shape({
        key: PropTypes.string,
        value: PropTypes.string,
      }),
    ),
  }).isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func.isRequired,
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// Add error boundary to catch and handle errors properly
export function ErrorBoundary() {
  const error = useRouteError();
  console.error("[ErrorBoundary] Error caught:", error);
  
  // Use Shopify's default error boundary
  return boundary.error(error);
}
