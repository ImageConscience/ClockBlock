import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const search = url.search ? `?${url.searchParams.toString()}` : "";
  throw redirect(`/app${search}`);
};

export default function App() {
  return null;
}
