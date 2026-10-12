// Cloudflare Worker — proxy para Groq + voz natural Google TTS
// (la key queda en el servidor, no en el navegador)
//
// CÓMO DESPLEGAR (5 minutos, gratis):
// 1. dash.cloudflare.com → Workers & Pages → Create → Create Worker
// 2. Nómbralo "viernes-proxy"
// 3. Edit code (</>) → borra el código de ejemplo y pega ESTE archivo completo
// 4. Save and Deploy
// 5. (Opcional) Settings → Variables → Add variable:
//      VIERNES_ORIGIN = https://tusitio (Type: Text)
//    Si VIERNES_ORIGIN no existe, se permite cualquier origen.
// 6. Si aparece "unpublished changes" → Deploy otra vez.
//
// ENDPOINTS:
//   POST /            → proxy a Groq (usa GROQ_API_KEY del entorno,
//                       o la key incrustada más abajo si no la configuraste)
//   GET  /tts?texto=… → voz natural de Google (MP3, gratis, sin key)

export default {
  async fetch(request) {
    // ── TTS NATURAL (Google) · GET /tts?texto=... ──
    const url = new URL(request.url);
    if (url.pathname === "/tts") {
      const texto = url.searchParams.get("texto") || "";
      if (!texto) return new Response("Falta texto", { status: 400 });
      const g = "https://translate.google.com/translate_tts?ie=UTF-8&tl=es&client=tw-ob&q=" +
        encodeURIComponent(texto.slice(0, 200));
      try {
        const r = await fetch(g, { headers: { "User-Agent": "Mozilla/5.0" } });
        const resp = new Response(r.body, { status: r.status, headers: { "Content-Type": "audio/mpeg" } });
        resp.headers.set("Access-Control-Allow-Origin", "*");
        return resp;
      } catch (e) {
        return new Response("Error de TTS: " + e.message, { status: 502 });
      }
    }

    // ── PROXY GROQ · POST / ──
    const origin = request.headers.get("Origin") || "";
    const permitido = (request.env && request.env.VIERNES_ORIGIN) || "";
    const ok =
      !permitido ||
      permitido.split(",").some((d) => d.trim() && origin.includes(d.trim())) ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin, ok) });
    }
    if (!ok) {
      return new Response("Origen no autorizado", { status: 403, headers: cors(origin, true) });
    }

    // Tu API key: agrégala en Settings → Variables (Type: Secret)
    // con el nombre GROQ_API_KEY. NUNCA la pegues en este archivo
    // si vas a subirlo a GitHub (GitHub la revocarían).
    const apiKey = (request.env && request.env.GROQ_API_KEY) || "";
    if (!apiKey) {
      return new Response("Falta GROQ_API_KEY: agrégala en Settings → Variables (Type: Secret)", { status: 500, headers: cors(origin, true) });
    }

    try {
      const body = await request.text();
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body
      });
      const resp = new Response(r.body, { status: r.status });
      cors(origin, true).forEach((v, k) => resp.headers.set(k, v));
      return resp;
    } catch (e) {
      return new Response("Error del proxy: " + e.message, { status: 502, headers: cors(origin, true) });
    }
  }
};

function cors(origin, allow) {
  const h = new Headers();
  if (allow) {
    h.set("Access-Control-Allow-Origin", origin || "*");
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "authorization, content-type");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}
