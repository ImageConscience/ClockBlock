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
  // Log context structure to understand how React Router passes Response objects
  console.log("[ENTRY] Context keys:", Object.keys(reactRouterContext || {}));
  console.log("[ENTRY] Response status code:", responseStatusCode);
  console.log("[ENTRY] Response headers:", Object.fromEntries(responseHeaders || []));
  
  // React Router v7: Check if the context already has a Response to return
  // Actions returning Response objects should bypass HTML rendering
  // Check multiple possible locations where Response might be stored
  if (reactRouterContext) {
    // Check actionData
    if (reactRouterContext.actionData) {
      console.log("[ENTRY] Found actionData:", Object.keys(reactRouterContext.actionData));
      for (const [routeId, actionData] of Object.entries(reactRouterContext.actionData)) {
        if (actionData instanceof Response) {
          const contentType = actionData.headers.get("content-type") || "";
          console.log("[ENTRY] Found Response in actionData, Content-Type:", contentType);
          if (contentType.includes("application/json")) {
            console.log("[ENTRY] Returning JSON Response directly from actionData");
            return actionData;
          }
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
  
  // Check if responseHeaders already indicate JSON (from action response)
  const existingContentType = responseHeaders.get("content-type");
  if (existingContentType && existingContentType.includes("application/json")) {
    console.log("[ENTRY] Response headers already set to JSON, Content-Type:", existingContentType);
    // Return a JSON response directly without HTML rendering
    // Note: This won't work if React Router hasn't populated the body yet
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
