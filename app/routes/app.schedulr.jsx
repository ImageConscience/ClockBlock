import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
    query ListSchedulableEntities($first: Int!) {
      metaobjects(type: "schedulable_entity", first: $first) {
        nodes {
          id
          handle
          fields {
            key
            value
          }
        }
      }
    }
  `,
    { variables: { first: 50 } },
  );
  const json = await response.json();
  const entries = json?.data?.metaobjects?.nodes ?? [];

  return { entries };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const positionId = String(formData.get("position_id") || "");
  const startAt = String(formData.get("start_at") || "");
  const endAt = String(formData.get("end_at") || "");
  const title = String(formData.get("title") || "");
  const content = String(formData.get("content") || "");

  const response = await admin.graphql(
    `#graphql
    mutation CreateSchedulableEntity($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject { id handle }
        userErrors { field message }
      }
    }
  `,
    {
      variables: {
        metaobject: {
          type: "schedulable_entity",
          fields: [
            { key: "position_id", value: positionId },
            { key: "start_at", value: startAt },
            { key: "end_at", value: endAt },
            { key: "title", value: title },
            { key: "content", value: content },
          ],
        },
      },
    },
  );
  const json = await response.json();

  return json;
};

export default function SchedulrPage() {
  const { entries } = useLoaderData();
  const fetcher = useFetcher();

  return (
    <s-page heading="Schedulr entries">
      <s-section heading="Create entry">
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-text-field name="title" label="Title" />
            <s-text-field name="position_id" label="Position ID" />
            <s-date-time-field name="start_at" label="Start At" />
            <s-date-time-field name="end_at" label="End At" />
            <s-text-area name="content" label="Content (rich text JSON or HTML)" />
            <s-button submit>Create</s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Existing entries">
        {entries.length === 0 ? (
          <s-text>No entries yet.</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            {entries.map((e) => {
              const fieldMap = Object.fromEntries(
                (e.fields || []).map((f) => [f.key, f.value]),
              );
              return (
                <s-box key={e.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-heading>{fieldMap.title || "(untitled)"}</s-heading>
                  <s-text variant="subdued">Position: {fieldMap.position_id}</s-text>
                  <s-text>
                    {fieldMap.start_at} → {fieldMap.end_at}
                  </s-text>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};


