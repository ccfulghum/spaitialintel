const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (request.method === "GET") {
    return new Response(
      JSON.stringify({
        googleMapsApiKey: env.GOOGLE_MAPS_API_KEY || "",
        censusApiKey: env.CENSUS_API_KEY || ""
      }),
      { headers: JSON_HEADERS }
    );
  }

  if (request.method === "POST") {
    const body = await request.json();
    const { username, password } = body;

    if (username === env.DEMO_USERNAME && password === env.DEMO_PASSWORD) {
      return new Response(JSON.stringify({ success: true }), { headers: JSON_HEADERS });
    }

    return new Response(JSON.stringify({ success: false }), {
      status: 401,
      headers: JSON_HEADERS
    });
  }

  return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
    status: 405,
    headers: JSON_HEADERS
  });
}
