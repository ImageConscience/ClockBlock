import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.search ? `?${url.searchParams.toString()}` : "";
  throw redirect(`/app${search}`);
};

export default function App() {
  // This route immediately redirects in the loader; component won't render.
  return null;
}
