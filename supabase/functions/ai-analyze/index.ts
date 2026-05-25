import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RequestPayload {
  provider: "claude" | "openai";
  model: string;
  apiKey: string;
  prompt: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { provider, model, apiKey, prompt }: RequestPayload = await req.json();

    if (!provider || !model || !apiKey || !prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: provider, model, apiKey, prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let content: string;
    let tokensUsed: number | undefined;

    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return new Response(
          JSON.stringify({ error: `Claude API error (${res.status}): ${err}` }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json() as {
        content: Array<{ type: string; text: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      };

      content = data.content.find((c) => c.type === "text")?.text ?? "";
      if (data.usage) tokensUsed = data.usage.input_tokens + data.usage.output_tokens;

    } else if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: "system",
              content: "You are an expert Elementor developer. Respond only with valid JSON as instructed.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return new Response(
          JSON.stringify({ error: `OpenAI API error (${res.status}): ${err}` }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
        usage?: { total_tokens: number };
      };

      content = data.choices[0]?.message?.content ?? "";
      if (data.usage) tokensUsed = data.usage.total_tokens;

    } else {
      return new Response(
        JSON.stringify({ error: "Unknown provider. Use 'claude' or 'openai'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ content, tokensUsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
