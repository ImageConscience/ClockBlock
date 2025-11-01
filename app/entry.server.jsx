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
  
  // If this is a fetcher request expecting JSON but we haven't found a Response,
  // React Router might have already handled it, but we should still check responseHeaders
  if (isFetcherRequest && request.method === "POST") {
    const existingContentType = responseHeaders.get("content-type");
    console.log("[ENTRY] Fetcher POST request detected, existing Content-Type:", existingContentType);
    // If headers indicate JSON but we're about to render HTML, something is wrong
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
