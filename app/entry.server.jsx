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
      
      // Check all possible locations where React Router might store action data
      console.log("[ENTRY] Checking actionData existence:", !!reactRouterContext?.actionData);
      if (reactRouterContext?.actionData) {
        console.log("[ENTRY] actionData keys:", Object.keys(reactRouterContext.actionData));
        for (const [routeId, data] of Object.entries(reactRouterContext.actionData)) {
          console.log("[ENTRY] Found actionData for route:", routeId, "data:", JSON.stringify(data).substring(0, 200));
          if (data && typeof data === "object" && !(data instanceof Response)) {
            actionResponseData = data;
            console.log("[ENTRY] Using actionData from route:", routeId);
            break;
          }
        }
      } else {
        console.log("[ENTRY] No actionData found in context");
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
      
      // If we didn't find the data but headers indicate JSON,
      // React Router should have already handled it, but we still need to prevent HTML rendering
      // In this case, we'll return an empty JSON response or re-read from the action
      console.log("[ENTRY] JSON headers detected but no actionData found, returning empty JSON");
      return new Response("{}", {
        status: responseStatusCode || 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
      });
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
