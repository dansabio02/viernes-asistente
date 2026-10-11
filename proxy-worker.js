// Cloudflare Worker — proxy para Groq (la key queda en el servidor, no en el navegador)
//
// CÓMO DESPLEGAR (5 minutos, gratis):
// 1. dash.cloudflare.com → Workers & Pages → Create → Create Worker
// 2. Nómbralo "viernes-proxy"
// 3. Edit code (</>) → borra el código de ejemplo y pega ESTE archivo completo
// 4. Save and Deploy
// 5. Settings → Variables → Add variable:
//      GROQ_API_KEY = tu_key_de_groq   (Type: Secret)
//    (Opcional) Para restringir orígenes, agrega también:
//      VIERNES_ORIGIN = https://tusitio (Type: Text)
//    Si VIERNES_ORIGIN no existe, se permite cualquier origen.
// 6. Si aparece "unpublished changes" → Deploy otra vez.

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const permitido = (request.env && request.env.VIERNES_ORIGIN) || "";
    // Sin VIERNES_ORIGIN configurado, se permite cualquier origen
    // (asistente personal; la clave nunca sale del servidor).
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

    const apiKey = (request.env && request.env.GROQ_API_KEY) || "";
    if (!apiKey) {
      return new Response("Falta GROQ_API_KEY en el Worker", { status: 500, headers: cors(origin, true) });
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
