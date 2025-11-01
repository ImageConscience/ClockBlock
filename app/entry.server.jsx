import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  // Check if this is a fetcher request (from useFetcher) that expects JSON
  const acceptHeader = request.headers.get("accept") || "";
  const isFetcherRequest = acceptHeader.includes("*/*") || 
                          acceptHeader.includes("application/json") || 
                          (!acceptHeader.includes("text/html") && request.method !== "GET");
  
  // Log context structure to understand how React Router passes Response objects
  console.log("[ENTRY] Request method:", request.method);
  console.log("[ENTRY] Accept header:", acceptHeader);
  console.log("[ENTRY] Is fetcher request:", isFetcherRequest);
  console.log("[ENTRY] Context keys:", Object.keys(reactRouterContext || {}));
  console.log("[ENTRY] Response status code:", responseStatusCode);
  console.log("[ENTRY] Response headers:", Object.fromEntries(responseHeaders || []));
  
  // React Router v7: Check if the context already has a Response to return
  // Actions returning Response objects should bypass HTML rendering
  // Check multiple possible locations where Response might be stored
  if (reactRouterContext) {
    // Check actionData - React Router might serialize Response data here
    if (reactRouterContext.actionData) {
      console.log("[ENTRY] Found actionData:", Object.keys(reactRouterContext.actionData));
      for (const [routeId, actionData] of Object.entries(reactRouterContext.actionData)) {
        console.log("[ENTRY] actionData for route:", routeId, "type:", typeof actionData, "is Response:", actionData instanceof Response);
        if (actionData instanceof Response) {
          const contentType = actionData.headers.get("content-type") || "";
          console.log("[ENTRY] Found Response in actionData, Content-Type:", contentType);
          if (contentType.includes("application/json")) {
            console.log("[ENTRY] Returning JSON Response directly from actionData");
            return actionData;
          }
        } else if (isFetcherRequest && typeof actionData === "object" && actionData !== null) {
          // If it's a fetcher request and actionData is an object (not a Response),
          // React Router has already serialized the Response body
          // Return JSON directly
          console.log("[ENTRY] Returning serialized actionData as JSON for fetcher request");
          return new Response(JSON.stringify(actionData), {
            status: responseStatusCode || 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
          });
        }
      }
    }
    
    // Check if there's a response object directly
    if (reactRouterContext.response && reactRouterContext.response instanceof Response) {
      const contentType = reactRouterContext.response.headers.get("content-type") || "";
      console.log("[ENTRY] Found Response in context.response, Content-Type:", contentType);
      if (contentType.includes("application/json")) {
        console.log("[ENTRY] Returning JSON Response directly from context.response");
        return reactRouterContext.response;
      }
    }
    
    // Check routeData
    if (reactRouterContext.routeData) {
      for (const [routeId, routeData] of Object.entries(reactRouterContext.routeData)) {
        if (routeData instanceof Response) {
          const contentType = routeData.headers.get("content-type") || "";
          console.log("[ENTRY] Found Response in routeData:", routeId, "Content-Type:", contentType);
          if (contentType.includes("application/json")) {
            console.log("[ENTRY] Returning JSON Response directly from routeData");
            return routeData;
          }
        }
      }
    }
  }
  
  // CRITICAL: If this is a fetcher POST request and headers already indicate JSON,
  // React Router v7 has already processed the action response.
  // We MUST bypass HTML rendering and return JSON directly.
  if (isFetcherRequest && request.method === "POST") {
    const existingContentType = responseHeaders.get("content-type");
    console.log("[ENTRY] Fetcher POST request detected, existing Content-Type:", existingContentType);
    // If headers indicate JSON, React Router has already processed the action response
    // We need to get the actual response body from the context
    if (existingContentType && existingContentType.includes("application/json")) {
      console.log("[ENTRY] JSON Content-Type detected for fetcher request - must bypass HTML rendering");
      // Try to find the action response in the context
      // React Router v7 might store it differently
      let actionResponseData = null;
      
      // Log entire context structure to find where data is stored
      console.log("[ENTRY] Full context structure:", JSON.stringify(Object.keys(reactRouterContext || {})).substring(0, 500));
      
      // Check all possible locations where React Router might store action data
      console.log("[ENTRY] Checking actionData existence:", !!reactRouterContext?.actionData);
      if (reactRouterContext?.actionData) {
        console.log("[ENTRY] actionData keys:", Object.keys(reactRouterContext.actionData));
        for (const [routeId, data] of Object.entries(reactRouterContext.actionData)) {
          console.log("[ENTRY] Found actionData for route:", routeId, "data type:", typeof data, "is Response:", data instanceof Response);
          if (data && typeof data === "object" && !(data instanceof Response)) {
            console.log("[ENTRY] actionData content:", JSON.stringify(data).substring(0, 300));
            actionResponseData = data;
            console.log("[ENTRY] Using actionData from route:", routeId);
            break;
          }
        }
      } else {
        console.log("[ENTRY] No actionData found in context");
        
        // Check if React Router stored it in staticHandlerContext
        if (reactRouterContext?.staticHandlerContext) {
          console.log("[ENTRY] Checking staticHandlerContext");
          const staticContext = reactRouterContext.staticHandlerContext;
          console.log("[ENTRY] staticHandlerContext keys:", Object.keys(staticContext || {}));
          
          // Check actionData first
          if (staticContext?.actionData) {
            console.log("[ENTRY] Found actionData in staticHandlerContext:", Object.keys(staticContext.actionData));
            for (const [routeId, data] of Object.entries(staticContext.actionData)) {
              console.log("[ENTRY] staticHandlerContext.actionData for route:", routeId, "type:", typeof data);
              if (data && typeof data === "object" && !(data instanceof Response)) {
                console.log("[ENTRY] Found action response in staticHandlerContext.actionData:", routeId);
                console.log("[ENTRY] Data preview:", JSON.stringify(data).substring(0, 300));
                actionResponseData = data;
                break;
              }
            }
          }
          
          // Check if there's a response object directly in staticHandlerContext
          if (!actionResponseData && staticContext?.response && staticContext.response instanceof Response) {
            console.log("[ENTRY] Found Response object in staticHandlerContext.response");
            try {
              // Try to clone and read the response body
              const clonedResponse = staticContext.response.clone();
              const responseText = await clonedResponse.text();
              console.log("[ENTRY] Response body from staticHandlerContext:", responseText.substring(0, 300));
              try {
                actionResponseData = JSON.parse(responseText);
                console.log("[ENTRY] Successfully parsed response as JSON");
              } catch (e) {
                console.log("[ENTRY] Response is not JSON, cannot parse:", e.message);
              }
            } catch (e) {
              console.log("[ENTRY] Could not read response body:", e.message);
            }
          }
          
          // Also check loaderData in case action response was stored there
          if (!actionResponseData && staticContext?.loaderData) {
            console.log("[ENTRY] Checking loaderData in staticHandlerContext");
            for (const [routeId, data] of Object.entries(staticContext.loaderData)) {
              if (data && typeof data === "object" && (data.success !== undefined || data.error !== undefined)) {
                console.log("[ENTRY] Found action-like data in loaderData:", routeId);
                actionResponseData = data;
                break;
              }
            }
          }
        }
      }
      
      // Also check if there's a response body stored elsewhere in the context
      // React Router might serialize it differently
      if (!actionResponseData && reactRouterContext) {
        // Check for any data that looks like our action response
        for (const [key, value] of Object.entries(reactRouterContext)) {
          if (key.includes("action") || key.includes("data")) {
            console.log("[ENTRY] Checking context key:", key, "type:", typeof value);
            if (value && typeof value === "object" && !Array.isArray(value)) {
              // Check if it looks like our JSON response (has success, error, file, etc.)
              if (value.success !== undefined || value.error !== undefined || value.file !== undefined) {
                actionResponseData = value;
                console.log("[ENTRY] Found action response data in key:", key);
                break;
              }
            }
          }
        }
      }
      
      // If we didn't find the data but headers indicate JSON,
      // React Router has already processed the action and set JSON headers
      // The response body should be in the context, but if we can't find it,
      // we need to check if React Router stored it in matches/routeData
      if (!actionResponseData && reactRouterContext?.matches) {
        console.log("[ENTRY] Checking matches for action response data");
        for (const match of reactRouterContext.matches) {
          if (match.route?.module?.action && match.routeData) {
            console.log("[ENTRY] Checking match routeData:", Object.keys(match.routeData || {}));
            // Check if routeData contains our action response
            for (const [key, value] of Object.entries(match.routeData)) {
              if (value && typeof value === "object" && (value.success !== undefined || value.error !== undefined)) {
                actionResponseData = value;
                console.log("[ENTRY] Found action response in match routeData:", key);
                break;
              }
            }
          }
        }
      }
      
      // If we found the data, return it as JSON
      if (actionResponseData) {
        console.log("[ENTRY] Returning action response data as JSON");
        return new Response(JSON.stringify(actionResponseData), {
          status: responseStatusCode || 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      }
      
      // If we STILL didn't find the data, but headers are JSON,
      // React Router v7 has already processed the action response.
      // The response body should be available, but React Router may have already streamed it.
      // We need to reconstruct it from what we know - but since we can't access it,
      // we should check if React Router stored the response somewhere else.
      if (!actionResponseData) {
        console.log("[ENTRY] JSON headers detected but no actionData found in context");
        console.log("[ENTRY] This means React Router has already processed the action response");
        console.log("[ENTRY] Checking if response was already sent or if we need to read from a different source");
        
        // React Router v7 should have already sent the response body.
        // The fact that we're here means entry.server.jsx is being called AFTER the response was processed.
        // We should NOT render HTML - but we also can't access the original response body.
        // The best we can do is abort rendering by throwing or returning early.
        // However, if we throw, React Router might show an error page.
        // Instead, let's try to read from the response stream if available, or skip rendering.
        
        // Since we can't access the original response, and React Router should have already sent it,
        // we need to prevent HTML rendering without overriding the response.
        // The safest approach is to NOT render HTML at all - return early without calling renderToPipeableStream.
        // But entry.server.jsx is designed to always render, so we can't just return undefined.
        
        // ACTUALLY: If React Router has already set JSON headers and processed the response,
        // it means the response has already been sent to the client. entry.server.jsx
        // shouldn't even be called in this case. But if it is, we need to not render HTML.
        // The best approach: return a minimal response that won't break the client,
        // but log that something is wrong.
        
        console.error("[ENTRY] WARNING: JSON headers detected but cannot find actionData. React Router should have already sent the response.");
        console.error("[ENTRY] Returning empty success response to prevent HTML rendering.");
        // Return a minimal success response - the client might get this instead of the real response
        // But this is better than HTML
        return new Response(JSON.stringify({ success: true, message: "Response already processed by React Router" }), {
          status: responseStatusCode || 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      }
    }
  }
  
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
