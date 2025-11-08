import { useEffect, useRef, useState, useId } from "react";
import { useFetcher, useLoaderData, useNavigation, useRevalidator, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import PropTypes from "prop-types";
import { parseLocalDateTimeToUTC, getDefaultDateBounds } from "../utils/datetime";

export { loader, action } from "../services/clockblock.server";

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

export default function ClockBlockPage() {
  const { entries: initialEntries, mediaFiles, error: loaderError } = useLoaderData();
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
    
    if (fetcher.data?.error) {
      console.error("[CLIENT] Error in fetcher data:", fetcher.data.error);
      shopify.toast.show(fetcher.data.error, { isError: true });
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === false) {
      console.error("[CLIENT] Failed to create entry");
      shopify.toast.show("Failed to create entry", { isError: true });
      handledResponseRef.current = responseId;
    } else if (fetcher.data?.success === true) {
      debugLog("[CLIENT] Entry created successfully, reloading entries");
      shopify.toast.show(fetcher.data.message || "Entry created successfully!", { isError: false });
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
                        mediaFiles={mediaFiles || []}
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <MediaLibraryPicker
                        name="mobile_banner"
                        label="Mobile Banner"
                        mediaFiles={mediaFiles || []}
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
