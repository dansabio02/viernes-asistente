// Cloudflare Worker — proxy para Groq + voz natural + MEMORIA DE VIERNES
// (las keys quedan en el servidor, no en el navegador)
//
// CÓMO DESPLEGAR (5 minutos, gratis):
// 1. dash.cloudflare.com → Workers & Pages → Create → Create Worker
// 2. Nómbralo "viernes-proxy"
// 3. Edit code (</>) → borra el código de ejemplo y pega ESTE archivo completo
// 4. Save and Deploy
// 5. Settings → Variables → Add variable (Type: Secret):
//      GROQ_API_KEY = tu_key_de_groq
//      VIERNES_PIN  = una_clave_solo_tuya   (protege notas y bitácora)
//    (Opcional) VIERNES_ORIGIN = https://tusitio (Type: Text)
//    Si VIERNES_ORIGIN no existe, se permite cualquier origen.
// 6. MEMORIA PERSISTENTE: dash.cloudflare.com → Storage & Databases → KV →
//    Create namespace "viernes-datos" → luego en el Worker: Settings →
//    Bindings → KV namespace → Variable name: VIERNES_KV, namespace: viernes-datos.
//    Sin el KV, el worker funciona pero las notas no sobreviven al reinicio.
// 7. Si aparece "unpublished changes" → Deploy otra vez.
//
// ENDPOINTS:
//   POST /              → proxy a Groq (GROQ_API_KEY del entorno)
//   GET  /tts?texto=…   → voz natural de Google (MP3, gratis, sin key)
//   GET  /ping          → estado del worker (si hay KV o no)
//   POST /note   {texto}&pin → guardar una nota
//   GET  /notes  ?pin        → listar las últimas notas
//   GET  /note?id=…&pin      → borrar una nota
//   GET  /ask?texto=…&pin=&tz=-6  → preguntar a VIERNES SIN ABRIR LA PÁGINA
//        (atiende MANOS: «apunta …» nota, «recuérdame … a las …» recordatorio,
//        «despiértame …» alarma, «mis notas», «mis recordatorios»; lo demás va
//        al LLM). Devuelve la respuesta; con &raw=1 solo texto plano para que
//        el atajo lo lea en voz alta. tz = desfase UTC del jefe (por defecto -6).
//   GET  /pend?pin=   → descarga y VACÍA la cola de recordatorios creados
//        por atajo (los recoge la app al abrir). Cada movimiento queda en bitácora.
//   GET  /log?pin=&desde=…   → bitácora (apunta todo lo ocurrido fuera de casa)

const TRATOS = ["Señor", "Señor Daniel", "Jefe"];
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]; // para mostrar (domingo=0)
const DIASEM = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]; // para sumar días (lunes=0)

/* ── TIEMPO NATURAL REMOTO: espejo del parser local de la app ──
   «off» es el desfase UTC del jefe en ms (CDMX: -6 h → 21600e3 en negativo).
   Las horas se calculan en reloj de pared del jefe con aritmética UTC. */
function offMs(url) {
  const tz = parseFloat((url.searchParams.get("tz") || "").trim());
  const tzH = isFinite(tz) && tz >= -13 && tz <= 13 ? tz : -6; // CDMX por defecto
  return Math.round(tzH * 3600e3);
}
function parsearTiempoRemoto(pn, off) {
  const ahora = Date.now();
  const base = new Date(ahora + off); // los campos UTC reflejan el reloj del jefe
  base.setUTCSeconds(0, 0);
  let m;
  // Relativo: no depende de la zona
  if ((m = pn.match(/\ben (media) hora\b/))) return { t: ahora + 30 * 60e3, rep: null };
  if ((m = pn.match(/\ben\s+(una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|\d+)\s+(minutos?|horas?)\b/))) {
    const mapa = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30 };
    const cant = mapa[m[1]] !== undefined ? mapa[m[1]] : parseInt(m[1]);
    const mins = /minut/.test(m[2]) ? cant : cant * 60;
    return { t: ahora + mins * 60e3, rep: null };
  }
  // Día base
  let deltaDias = 0, quiereTodoElDia = false;
  if ((m = pn.match(/\bpasado manana\b/))) { deltaDias = 2; }
  else if ((m = pn.match(/\bmanana\b/))) { deltaDias = 1; }
  else if ((m = pn.match(/\bhoy\b/))) { quiereTodoElDia = true; }
  else if ((m = pn.match(new RegExp("\\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\\b")))) {
    const destino = DIASEM.indexOf(m[1]);
    let delta = (destino - ((base.getUTCDay() + 6) % 7) + 7) % 7;
    if (delta === 0) delta = 7; // "el viernes" en viernes → el próximo
    deltaDias = delta;
  }
  const rep = /\b(cada manana|todas las mananas|todos los dias|cada dia|diario)\b/.test(pn) ? "daily" : null;
  let t = null;
  if ((m = pn.match(/\ba las?\s+(\d{1,2})(?:\s*[:.]\s*|\s+y\s+|\s+)?(\d{2}|media)?(?:\s*(?:de la\s+)?(manana|tarde|noche|madrugada|am|pm))?\b/))) {
    let hh = parseInt(m[1]);
    const mmRaw = m[2] || "";
    const mm = mmRaw === "media" ? 30 : parseInt(mmRaw || 0);
    const marc = m[3] || "";
    if (marc === "pm" || marc === "tarde" || marc === "noche") { if (hh < 12) hh += 12; }
    const d = new Date(base.getTime() + deltaDias * 864e5);
    d.setUTCHours(hh, mm, 0, 0);
    t = d.getTime() - off;
    if (!deltaDias && !quiereTodoElDia && t <= ahora - 60e3) t += 864e5; // ya pasó hoy: mañana
  } else if (deltaDias || quiereTodoElDia || /\bmediodia\b/.test(pn)) {
    // Sin hora expresa: mediodía si se pide, si no 8 de la mañana (igual que la app)
    const d = new Date(base.getTime() + deltaDias * 864e5);
    if (/\bmediodia\b/.test(pn)) d.setUTCHours(12, 0, 0, 0); else d.setUTCHours(8, 0, 0, 0);
    t = d.getTime() - off;
  }
  if (!t) return null;
  return { t, rep };
}
function describeRemoto(t, off) {
  const diaPos = new Date(t + off);
  const hora = ("0" + diaPos.getUTCHours()).slice(-2) + ":" + ("0" + diaPos.getUTCMinutes()).slice(-2);
  const diaD0 = new Date(diaPos.getTime()); diaD0.setUTCHours(0, 0, 0, 0);
  const hoyD0 = new Date(Date.now() + off); hoyD0.setUTCHours(0, 0, 0, 0);
  const dif = Math.round((diaD0.getTime() - hoyD0.getTime()) / 864e5);
  const diaTxt = dif === 0 ? "hoy" : dif === 1 ? "mañana" : DIAS[diaPos.getUTCDay()];
  return diaTxt + " a las " + hora;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = (env && env.VIERNES_KV) || null;
    const memoria = (globalThis.__viernesMem = globalThis.__viernesMem || { notas: [], bitacora: [], pend: [] });

    // ── MEMORIA: lecto-escritura en KV (fallback en RAM si no hay binding) ──
    const K = { notas: "viernes:notas", bit: "viernes:bitacora", pend: "viernes:pend" };
    const KRAM = { [K.notas]: "notas", [K.bit]: "bitacora", [K.pend]: "pend" };
    async function leerClave(k, def) {
      if (kv) { try { const v = await kv.get(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
      return memoria[KRAM[k]] || def;
    }
    async function guardarClave(k, val) {
      if (kv) { try { await kv.put(k, JSON.stringify(val)); return; } catch (e) {} }
      memoria[KRAM[k]] = val;
    }
    async function bitacoraAdd(tipo, txt) {
      const b = await leerClave(K.bit, []);
      b.push({ t: Date.now(), tipo, txt: String(txt).slice(0, 600) });
      await guardarClave(K.bit, b.slice(-120));
    }

    // ── AUTENTICACIÓN por PIN (protege la memoria personal) ──
    const pinSrv = ((env && env.VIERNES_PIN) || (request.env && request.env.VIERNES_PIN)) || "";
    function pedir(url2, req2) {
      return url2.searchParams.get("pin") || req2.headers.get("x-viernes-pin") || "";
    }
    function respuesta(obj, origen, status) {
      const h = cors(origen || "*", true);
      h.set("Content-Type", "application/json");
      return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
    }

    // ── PING: diagnóstico para el Ajustes de la app ──
    if (url.pathname === "/ping" && request.method === "GET") {
      return respuesta({ ok: true, kv: !!kv, pin: !!pinSrv }, request.headers.get("Origin") || "*");
    }

    // ── NOTAS ──
    if (url.pathname === "/note" && (request.method === "POST" || request.method === "GET")) {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      let texto = url.searchParams.get("texto") || "";
      if (!texto && request.method === "POST") {
        try { const b = await request.json(); texto = (b && b.texto) || ""; } catch (e) {}
      }
      if (!texto) return respuesta({ error: "Falta texto" }, "*", 400);
      const notas = await leerClave(K.notas, []);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      notas.unshift({ id, t: Date.now(), txt: texto.slice(0, 500) });
      await guardarClave(K.notas, notas.slice(0, 100));
      await bitacoraAdd("nota", texto);
      return respuesta({ ok: true, id, total: Math.min(notas.length, 100) }, request.headers.get("Origin") || "*");
    }
    if (url.pathname === "/note" && request.method === "DELETE") {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const id = url.searchParams.get("id") || "";
      let notas = await leerClave(K.notas, []);
      const antes = notas.length;
      notas = notas.filter((n) => n.id !== id);
      await guardarClave(K.notas, notas);
      return respuesta({ ok: true, borradas: antes - notas.length }, request.headers.get("Origin") || "*");
    }
    if (url.pathname === "/notes" && request.method === "GET") {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const notas = await leerClave(K.notas, []);
      return respuesta({ ok: true, notas }, request.headers.get("Origin") || "*");
    }

    // ── PEND: cola de recordatorios/alarmas creados por atajo. La app los
    //      descarga al abrir (GET consume y vacía la cola). ──
    if (url.pathname === "/pend" && request.method === "GET") {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const pend = await leerClave(K.pend, []);
      await guardarClave(K.pend, []);
      return respuesta({ ok: true, items: pend }, request.headers.get("Origin") || "*");
    }

    // ── ASK: VIERNES responde SIN que abras la página (atajos, Tasker, Shortcuts) ──
    if (url.pathname === "/ask") {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("Origin") || "*", true) });
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const pregunta = url.searchParams.get("texto") || "";
      if (!pregunta) return respuesta({ error: "Falta texto" }, "*", 400);

      /* ── MANOS DE VIERNES: intenciones que se resuelven sin modelo ── */
      const off = offMs(url);
      const pn = pregunta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const bLen = (await leerClave(K.bit, [])).length;
      const tratoP = TRATOS[bLen % TRATOS.length];
      const limpia = (t2) => tratoP + ", " + t2.charAt(0).toLowerCase() + t2.slice(1);

      // APUNTAR nota
      if (/^(apunta|apuntame|apuntar|anota|anotar|toma nota|recuerda que)\b/.test(pn)) {
        const txt = pregunta.replace(/^(?:ap[uú]ntame|apuntas?|anotas?|toma nota(?: de)?|recuerda(?: que)?)\s*[:,]?\s*/i, "").replace(/^que\s+/i, "").trim();
        if (txt.length > 2) {
          const notas = await leerClave(K.notas, []);
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          notas.unshift({ id, t: Date.now(), txt: txt.slice(0, 500) });
          await guardarClave(K.notas, notas.slice(0, 100));
          await bitacoraAdd("nota", txt);
          return respuesta({ ok: true, respuesta: limpia("anotado: " + txt + ".") }, request.headers.get("Origin") || "*");
        }
      }
      // LEER notas
      if (/\b(mis notas|mis apuntes|que notas|dame mis notas|leeme las notas|leer las notas|listame las notas|lista las notas)\b/.test(pn) || /^(mis notas|notas)/.test(pn)) {
        const notas = await leerClave(K.notas, []);
        if (!notas.length) return respuesta({ ok: true, respuesta: limpia("no tiene notas guardadas todavía.") }, request.headers.get("Origin") || "*");
        const txt = notas.slice(0, 8).map((x, i) => (i + 1) + ": " + x.txt).join(". ");
        return respuesta({ ok: true, respuesta: limpia("sus notas recientes: " + txt) }, request.headers.get("Origin") || "*");
      }
      // RECORDATORIO o ALARMA por atajo (solo si hay tiempo expreso en la frase)
      if (/(recuerdame|despiertame|alarmame|alarma|recordatorio)/.test(pn)) {
        const p2 = parsearTiempoRemoto(pn, off);
        if (p2) {
          const tipo = /(despiertame|alarmame)\b|alarma/.test(pn) ? "alarma" : "recordatorio";
          let txt = pregunta.trim()
            .replace(/^(?:despi[eé]rtame|despierta me|alarmame|ponme una alarma|pon una alarma|una alarma|alarma|recu[eé]rd(?:ame|a me)|recuerdeme|recordatorios?|recordar)\b[).:,]?\s*/i, "")
            .replace(/^que\s+/i, "")
            .replace(/\bcada\s+(manana|mañana|dia|día|todas las mananas|todos los dias)\b/i, "")
            .replace(/\ba las?\s*\d{1,2}(?:[:.]\s*\d{2}|\s+y\s+media|\s+\d{2})?(?:\s*de la\s*)?(?:manana|mañana|madrugada|tarde|noche|am|pm)?\b/i, "")
            .replace(/\bal mediod[ií]a\b|\ben media hora\b|\ben\s+(un|una|\d+)\s+cuart[oa]s? de hora\b|\ben\s+\d+\s+(minutos?|horas?)\b/i, "")
            .replace(/\b((pasado )?mañana|mañana|hoy|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/i, "")
            .replace(/\s+/g, " ").replace(/^[,;:.]\s*/, "").replace(/^(el|la|los|las|que|de|para|a|al)\s+/i, "").replace(/\s+(el|la|los|las|de|para|a)$/i, "").trim();
          const pend = await leerClave(K.pend, []);
          const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tipo, txt, t: p2.t, rep: p2.rep };
          pend.push(item);
          await guardarClave(K.pend, pend.slice(-40));
          await bitacoraAdd("recordatorio", tipo + ": " + (txt || "—") + " → " + describeRemoto(p2.t, off));
          return respuesta({ ok: true, respuesta: limpia((tipo === "alarma" ? "alarma puesta" : "recordatorio de " + (txt || "su aviso")) + " para " + describeRemoto(p2.t, off) + (p2.rep === "daily" ? ", se repite todas las mañanas" : "") + ". Sonará cuando abra Viernes.") }, request.headers.get("Origin") || "*");
        }
      }
      // LISTAR pendientes
      if (/\b(mis recordatorios|mis alarmas|que recordatorios tengo|que alarmas tengo|listame los pendientes|pendientes)\b/.test(pn)) {
        const pend = (await leerClave(K.pend, [])).filter((x) => !x.hecho);
        if (!pend.length) return respuesta({ ok: true, respuesta: limpia("no hay recordatorios ni alarmas pendientes.") }, request.headers.get("Origin") || "*");
        const texto = pend.slice(0, 8).map((x, i) => (i + 1) + " " + (x.tipo === "alarma" ? "alarma" : "recordatorio") + (x.txt ? " de " + x.txt : "") + " " + describeRemoto(x.t, off)).join(". ");
        return respuesta({ ok: true, respuesta: limpia("pendiente" + (pend.length === 1 ? "" : "s") + ": " + texto) }, request.headers.get("Origin") || "*");
      }

      // Contexto: últimas notas + últimos intercambios, para que "recuerde"
      const key = ((env && env.GROQ_API_KEY) || (request.env && request.env.GROQ_API_KEY)) || "";
      if (!key) return respuesta({ error: "Falta GROQ_API_KEY" }, "*", 500);
      const notas = (await leerClave(K.notas, [])).slice(0, 10);
      const bit = (await leerClave(K.bit, [])).slice(-10);
      const ctxNotas = notas.length ? "NOTAS RECIENTES DEL JEFE:\n" + notas.map((n) => "- " + n.txt).join("\n") : "";
      const ctxBit = bit.length ? "INTERCAMBIOS RECIENTES:\n" + bit.map((b) => b.tipo + ": " + b.txt).join("\n") : "";
      const sys = "Eres VIERNES, asistente personal leal y eficiente. Hablas español de México, natural y breve, " +
        "para ser leído en voz alta (1 a 5 frases, sin listas ni emojis). No escribas ningún saludo de tratamiento; " +
        "el sistema lo agrega. Responde directo y útil." + (ctxNotas ? "\n" + ctxNotas : "") + (ctxBit ? "\n" + ctxBit : "");
      try {
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-oss-120b", reasoning_effort: "medium",
            messages: [{ role: "system", content: sys }, { role: "user", content: pregunta }],
            temperature: 0.6, max_tokens: 1024
          })
        });
        if (!r.ok) return respuesta({ error: "Groq HTTP " + r.status }, "*", 502);
        const j = await r.json();
        let texto = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
        if (!texto) return respuesta({ error: "Respuesta vacía" }, "*", 502);
        // Trato rotativo del servidor — la misma alternancia que la app
        const b = await leerClave(K.bit, []);
        const turno = b.length % TRATOS.length; // persistencia que rota sola
        const textoFinal = TRATOS[turno] + ", " + texto.charAt(0).toLowerCase() + texto.slice(1);
        await bitacoraAdd("pregunta", pregunta);
        await bitacoraAdd("respuesta", textoFinal);
        if ((url.searchParams.get("raw") || "") === "1") {
          const h2 = cors("*", true); h2.set("Content-Type", "text/plain; charset=utf-8");
          return new Response(textoFinal, { headers: h2 });
        }
        return respuesta({ ok: true, respuesta: textoFinal }, request.headers.get("Origin") || "*");
      } catch (e) {
        return respuesta({ error: "Error: " + e.message }, "*", 502);
      }
    }

    // ── LOG: la app sincroniza al abrir lo ocurrido mientras estaba cerrada ──
    if (url.pathname === "/log" && request.method === "GET") {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const desde = Number(url.searchParams.get("desde")) || 0;
      const b = await leerClave(K.bit, []);
      return respuesta({ ok: true, eventos: b.filter((x) => x.t > desde) }, request.headers.get("Origin") || "*");
    }

    // ── TTS EDGE (neural, voz extremadamente natural) ──
    if (url.pathname === "/tts-edge") {
      const texto = url.searchParams.get("texto") || "";
      const voz = url.searchParams.get("voz") || "es-MX_DaliaNeural";
      if (!texto) return new Response("Falta texto", { status: 400 });
      try {
        const g = "https://speech.platform.bing.com/cognitiveServices/speech/synthesize/readaloud/voices/" +
          encodeURIComponent(voz) + "?text=" + encodeURIComponent(texto.slice(0, 400));
        const r = await fetch(g, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edge/120.0.0.0",
            "Accept": "*/*",
            "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
          }
        });
        if (!r.ok) {
          return new Response("Error Edge TTS " + r.status, { status: 502 });
        }
        const resp = new Response(r.body, { status: r.status, headers: { "Content-Type": "audio/mpeg" } });
        resp.headers.set("Access-Control-Allow-Origin", "*");
        return resp;
      } catch (e) {
        return new Response("Error de TTS Edge: " + e.message, { status: 502 });
      }
    }

    // ── TTS ELEVENLABS · Luisa ──
    if (url.pathname === "/tts11") {
      const texto = url.searchParams.get("texto") || "";
      if (!texto) return new Response("Falta texto", { status: 400 });
      const voz = ((env && env.ELEVEN_VOICE_ID) || (request.env && request.env.ELEVEN_VOICE_ID)) || "1u9q7vX1Lcx74yAcFPt7";
      const key = ((env && env.ELEVENLABS_API_KEY) || (request.env && request.env.ELEVENLABS_API_KEY)) || "";
      if (!key) {
        return new Response("Falta ELEVENLABS_API_KEY", { status: 400 });
      }
      try {
        const r = await fetch(
          "https://api.elevenlabs.io/v1/text-to-speech/" + voz + "?output_format=mp3_44100_128",
          {
            method: "POST",
            headers: { "xi-api-key": key, "Content-Type": "application/json" },
            body: JSON.stringify({
              text: texto.slice(0, 500),
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true }
            })
          }
        );
        if (!r.ok) {
          const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
          const status = (r.status >= 400 && r.status < 500) ? r.status : 502;
          return new Response("Error ElevenLabs " + r.status + ": " + t, { status: status });
        }
        const resp = new Response(r.body, { status: r.status, headers: { "Content-Type": "audio/mpeg" } });
        resp.headers.set("Access-Control-Allow-Origin", "*");
        return resp;
      } catch (e) {
        return new Response("Error de TTS: " + e.message, { status: 502 });
      }
    }

    // ── TTS NATURAL (Google) · GET /tts?texto=... ──
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
    const permitido = ((env && env.VIERNES_ORIGIN) || (request.env && request.env.VIERNES_ORIGIN)) || "";
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
    const apiKey = ((env && env.GROQ_API_KEY) || (request.env && request.env.GROQ_API_KEY)) || "";
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
