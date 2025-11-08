export const json = (data, init = {}) => {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...init.headers,
  });

  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    statusText: init.statusText,
    headers,
  });
};

