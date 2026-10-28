// Logic First — free class AI server (Cloudflare Workers AI, Workers FREE plan).
//
// On the free plan, Cloudflare gives 10,000 "neurons" of AI per day. When they run out,
// requests fail until the daily reset at 00:00 UTC. Nothing is ever charged on the free plan.
// When this server is out for the day, the site automatically switches to the AI in each
// student's browser.
//
// Setup: see ai-server/README.md (about 10 minutes, no credit card).

// The site(s) allowed to use this server. Use your GitHub Pages address, with no trailing slash.
const ALLOWED_ORIGINS = ["https://ayusmukherjee.github.io"];

// Models (Workers AI). The coder model translates; the small model writes hints.
const CODE_MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";
const HINT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";

const SYSTEM = "You convert a student's pseudocode into code, literally. Never fix their mistakes, never change their algorithm, and never add steps they did not write. Reply only in the requested format.";
const TUTOR = "You are a friendly, concise algorithms tutor for university students.";
const MAX_PROMPT_CHARS = 12000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.concat(String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean))
      .map(s => s.replace(/\/$/, ""));
    const originOk = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (request.method === "GET") return json({ ok: true, message: "Logic First AI server is running." }, 200, cors);
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);
    if (!originOk) return json({ error: "This site is not allowed to use this server. Add it to ALLOWED_ORIGINS." }, 403, cors);
    if (!env.AI) return json({ error: "The Workers AI binding named AI is missing. See ai-server/README.md, step 5." }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Request body must be JSON." }, 400, cors); }
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const purpose = ["code", "hint", "review"].includes(body.purpose) ? body.purpose : "code";
    if (!prompt) return json({ error: "Missing prompt." }, 400, cors);
    if (prompt.length > MAX_PROMPT_CHARS) return json({ error: "Prompt is too long." }, 400, cors);

    try {
      const out = await env.AI.run(purpose === "hint" ? HINT_MODEL : CODE_MODEL, {
        messages: [
          { role: "system", content: purpose === "code" ? SYSTEM : TUTOR },
          { role: "user", content: prompt }
        ],
        max_tokens: purpose === "code" ? 1500 : 400,
        temperature: 0.1
      });
      let text = out && (out.response !== undefined ? out.response : out.result && out.result.response);
      if (text && typeof text !== "string") text = JSON.stringify(text);
      if (!text) return json({ error: "The model returned an empty reply." }, 502, cors);
      return json({ text }, 200, cors);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/4006|neuron|daily|allocation|quota|exceeded|rate limit|capacity/i.test(msg)) {
        return json({ error: "The free daily AI limit has been reached." }, 429, cors);
      }
      return json({ error: "AI error: " + msg.slice(0, 200) }, 502, cors);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "content-type": "application/json" } });
}
