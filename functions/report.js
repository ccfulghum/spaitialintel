export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();

    const {
      address,
      radius,
      blockgroups
    } = body;

    // Access environment variables securely
    const GOOGLE_MAPS_API_KEY = env.GOOGLE_MAPS_API_KEY;
    const CENSUS_API_KEY = env.CENSUS_API_KEY;
    const CHATGPT_BEARER_KEY = env.CHATGPT_BEARER_KEY;

    // =========================
    // Example: Call Census API
    // =========================

    const censusResponse = await fetch(
      `https://api.census.gov/data/2022/acs/acs5?get=NAME,B01001_001E&for=block%20group:*&key=${CENSUS_API_KEY}`
    );

    const censusData = await censusResponse.json();

    // =========================
    // Example: Call OpenAI
    // =========================

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CHATGPT_BEARER_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a healthcare market analytics expert."
          },
          {
            role: "user",
            content: `Generate a healthcare demographic report for:
            Address: ${address}
            Radius: ${radius}
            Blockgroups: ${JSON.stringify(blockgroups)}
            Census Data: ${JSON.stringify(censusData)}`
          }
        ]
      })
    });

    const aiResult = await aiResponse.json();

    // =========================
    // Return Combined Response
    // =========================

    return new Response(JSON.stringify({
      success: true,
      census: censusData,
      ai: aiResult
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}