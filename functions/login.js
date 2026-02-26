export async function onRequestPost(context) {
  const { request, env } = context;

  const body = await request.json();
  const { username, password } = body;

  if (
    username === env.DEMO_USERNAME &&
    password === env.DEMO_PASSWORD
  ) {
    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({ success: false }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}