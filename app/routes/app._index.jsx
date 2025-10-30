import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  throw redirect("/app/schedulr");
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
