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
  // React Router v7: Check if the context already has a Response to return
  // Actions returning Response objects should bypass HTML rendering
  if (reactRouterContext?.actionData) {
    for (const [routeId, actionData] of Object.entries(reactRouterContext.actionData)) {
      if (actionData instanceof Response) {
        const contentType = actionData.headers.get("content-type") || "";
        console.log("[ENTRY] Found Response in actionData, Content-Type:", contentType);
        // If it's a Response with JSON content type, return it directly
        if (contentType.includes("application/json")) {
          console.log("[ENTRY] Returning JSON Response directly, bypassing HTML rendering");
          return actionData;
        }
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
