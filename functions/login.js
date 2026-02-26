export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json();
  const { username, password } = body;

  const VALID_USER = env.DEMO_USERNAME;
  const VALID_PASS = env.DEMO_PASSWORD;

  if (username === VALID_USER && password === VALID_PASS) {
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ success: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}