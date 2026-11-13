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
// 7. BASE DE DATOS DE MEMORIA (recommended): dash.cloudflare.com →
//    Storage & Databases → D1 → Create database "viernes-memoria" →
//    en el Worker: Settings → Bindings → D1 database → Variable name:
//    VIERNES_D1, database: viernes-memoria. Importante: mantener la app
//    en la misma cuenta y pulsar Deploy después.
// 8. Si aparece "unpublished changes" → Deploy otra vez.
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
//        al LLM). El cerebro además RECIBE BÚSQUEDA WEB: si la pregunta pide
//        información (qué/quién/cuándo/noticias/precio…), se consultan
//        resultados frescos (motor gratis de DuckDuckGo) y llegan al LLM
//        como contexto, citando la fuente. El mismo beneficio vale para la
//        app en el teléfono (el proxy POST /) y el atajo. Devuelve la
//        respuesta; con &raw=1 solo texto plano para que el atajo
//        lo lea en voz alta. tz = desfase UTC del jefe (por defecto -6).
//   GET  /pend?pin=   → descarga y VACÍA la cola de recordatorios creados
//        por atajo (los recoge la app al abrir). Cada movimiento queda en bitácora.
//   GET  /log?pin=&desde=…   → bitácora (apunta todo lo ocurrido fuera de casa)
//   POST /mem        {id?,t?,tipo,texto,meta} → guardar memoria (nota/recordatorio/mensaje/aprendido)
//   GET  /mem        ?tipos=nota,recordatorio&limit=12 → últimas memorias
//   POST /mem/buscar {q, tipos?, limit?} → buscar por palabras
//   DELETE /mem?id=…  →borrar una memoria
//   POST /mem/vaciar  {confirmar:"si"} → borrar TODO (con PIN)
//   GET  /mem/estado  → qué motor hay (D1 o KV) y contaduras

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
  if ((m = pn.match(/\ba las?\s+(\d{1,2})(?:\s*[:.]\s*|\s+y\s+|\s+)?(\d{2}|media|cuarto)?(?:\s*(?:de la\s+)?(manana|tarde|noche|madrugada|am|pm))?\b/))) {
    let hh = parseInt(m[1]);
    const mmRaw = m[2] || "";
    const mm = mmRaw === "media" ? 30 : mmRaw === "cuarto" ? 15 : parseInt(mmRaw || 0);
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

/* ── BÚSQUEDA WEB PARA EL CEREBRO (gratuita, sin API key) ──
   El modelo no tiene internet; aquí se lo buscamos: si la pregunta
   pide información (qué/quién/cuándo/cuánto/noticias/precio…), se
   consulta la web. Cadena de respaldo por si una fuente bloquea la
   salida de Cloudflare (a DuckDuckGo a veces le da por regresar 403
   a las IPs de datacenter):
     1) DuckDuckGo HTML  ·  2) DuckDuckGo Lite  ·  3) Wikipedia ES.
   Si TODO falla, se le avisa al cerebro con una nota interna para que
   NUNCA prometa que va a buscar; responde con franqueza. */
const CHARLAPEQUE = /\b(como estas|como te sientes|como te llamas|quien eres|que eres|que hora es|que dia es|hola|buenas tardes|buenas noches|buenos dias|gracias|adios|hasta luego|que tal|que me dices|dime un chiste|eres real|que puedes hacer|que sabes hacer)\b/;
const PREGUNTAINFO = /\b(que|quien|quienes|cuando|cuanto|cuantos|cual|cuales|donde|como|por que|busca|buscame|noticias|noticia|precio|cuesta|vale|cotizacion|recomienda|hay|existen|que es|quien es|cuando se|como se hace|dime sobre|informacion sobre)\b/;
function quiereBusqueda(texto) {
  const t = String(texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length < 14 || CHARLAPEQUE.test(t)) return false; // charla corta o de diario: no buscar
  if (/^(apunta\w*|anota\w*|toma nota|recuerda(?:me)?|despiertame|alarmame|almame|borra(?:me)?|lee(?:me)?|dime mis)\b/.test(t) && !/\b(busca|noticias|precio|cotizacion)\b/.test(t)) return false; // las manos de VIERNES, no la web
  return PREGUNTAINFO.test(t);
}
function quitarTags(s) {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
const UA_BUSQ = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function traerTxt(url) {
  const sig = (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(8000) : undefined;
  const r = await fetch(url, {
    signal: sig,
    headers: { "User-Agent": UA_BUSQ, "Accept-Language": "es-MX,es;q=0.9" },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.text();
}
/* Fuente 1: DuckDuckGo HTML */
async function buscarDDGHtml(q, max) {
  const html = await traerTxt("https://html.duckduckgo.com/html/?kl=es-mx&q=" + encodeURIComponent(String(q).slice(0, 240)));
  const titulos = [...html.matchAll(/<a([^>]*class="[^"]*result__a[^"]*"[^>]*)>([\s\S]*?)<\/a>/g)];
  const resumenes = [...html.matchAll(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  const out = [];
  for (let i = 0; i < titulos.length && out.length < max; i++) {
    const attrs = titulos[i][1] || "";
    const uddg = (attrs.match(/uddg=([^&"]+)/) || [])[1] || "";
    let dom = "";
    try { const u2 = decodeURIComponent(uddg); dom = u2.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""); } catch (e) {}
    const titulo = quitarTags(titulos[i][2]);
    if (!titulo) continue;
    out.push({ titulo, snippet: resumenes[i] ? quitarTags(resumenes[i][1]).slice(0, 320) : "", dom });
  }
  if (!out.length) throw new Error("sin resultados");
  return out;
}
/* Fuente 2: DuckDuckGo Lite (Tabla plana; el atributo usa comillas simples) */
async function buscarDDGLite(q, max) {
  const html = await traerTxt("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(String(q).slice(0, 240)));
  const links = [...html.matchAll(/<a[^>]+href="[^"]*uddg=([^&"']+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)];
  const snips = [...html.matchAll(/<td[^>]+class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/g)];
  const out = [];
  for (let i = 0; i < links.length && out.length < max; i++) {
    const dom = decodeURIComponent(links[i][1]).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    const titulo = quitarTags(links[i][2]);
    if (!titulo) continue;
    out.push({ titulo, snippet: snips[i] ? quitarTags(snips[i][1]).slice(0, 320) : "", dom });
  }
  if (!out.length) throw new Error("sin resultados");
  return out;
}
/* Fuente 3: Wikipedia ES — nunca bloquea IPs de datacenter y no requiere clave */
async function buscarWiki(q, max) {
  const txt = await traerTxt("https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeURIComponent(String(q).slice(0, 240)) + "&format=json&srlimit=" + max);
  const j = JSON.parse(txt);
  const out = (((j || {}).query || {}).search || []).map((x) => ({
    titulo: quitarTags(x.title),
    snippet: quitarTags(x.snippet || "").slice(0, 320),
    dom: "es.wikipedia.org",
  }));
  if (!out.length) throw new Error("sin resultados");
  return out;
}
/* La cadena: cae a la siguiente fuente si la anterior falla o viene vacía.
   Devuelto: { items, fuente }. Lanza una sola excepción con la causa de cada fuente. */
async function buscarWeb(q, max = 5) {
  const qa = encodeURIComponent(String(q).slice(0, 240));
  const intentos = [
    ["ddg-html", () => buscarDDGHtml(q, max)],
    ["ddg-lite", () => buscarDDGLite(q, max)],
    ["wikipedia", async () => buscarWiki(decodeURIComponent(qa), max)],
  ];
  const fallos = [];
  for (const [nombre, fn] of intentos) {
    try {
      const items = await fn();
      return { items, fuente: nombre };
    } catch (e) {
      fallos.push(nombre + ": " + (e && e.message ? e.message.slice(0, 80) : "error"));
    }
  }
  throw new Error(fallos.join(" | "));
}
/* Nota interna que se inyecta al cerebro cuando la web NO está disponible:
   lo obliga a ser honesto en lugar de prometer que "va a buscar". */
const NOTA_SIN_WEB = "\n\nNOTA INTERNA (no la mencione textualmente): la búsqueda web no está disponible en este momento. NO diga que va a consultar, buscar ni verificar nada externo; responda con lo que ya sabe y, si la pregunta exige dato fresco, reconozca con franqueza que de momento no puede consultar la web.";
function contextoBusqueda(res) {
  if (!res || !res.length) return "";
  const d = new Date(Date.now() - 6 * 3600e3).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Mexico_City" });
  return "\n\nRESULTADOS DE BÚSQUEDA EN LA WEB (" + d + "), información más reciente que su memoria de entrenamiento:\n" +
    res.map((x, i) => (i + 1) + ". " + x.titulo + (x.snippet ? ". " + x.snippet : "") + (x.dom ? " [fuente: " + x.dom + "]" : "")).join("\n") +
    "\nSi la pregunta pedía información actual, respóndala apoyándose en estos resultados y mencione la fuente con naturalidad. Si no dan claridad, dígalo con franqueza en vez de inventar.";
}

/* ── VOZ NEURAL EDGE (Microsoft Read Aloud) ──
   Token Sec-MS-GEC v2 (algoritmo CS64+SHA256) + síntesis por WebSocket.
   Gratis y sin key; la voz neural suena natural. */
const EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_VER = "2-143.0.3650.75";
const U32 = 0xFFFFFFFFn;
const SHA256_INITIAL = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19].map(x=>BigInt(x));
const SHA256_STATE = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2].map(x=>BigInt(x));
const SHA256_SCHEDULE = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564].map(x=>BigInt(x));
const SHA256_ROUND_CONSTANTS = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2].map(x=>BigInt(x));
const SHA256_ADJUSTMENT = 0xC9DC06A7n;
const SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80n;
const SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0n;
const BLOCK_CONSTANTS = SHA256_ROUND_CONSTANTS.slice();
BLOCK_CONSTANTS[14] = SHA256_ADJUSTMENT;
const CS64_COEFFICIENTS = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]].map(p=>p.map(x=>BigInt(x)));
const CS64_FACTOR = 0x82893933n;
const CS64_ADJUSTMENT0 = 0xF2F90B1An;
const CS64_ADJUSTMENT1 = 0x0B1A0000n;
const rol16 = (v) => ((v << 16n) | (v >> 16n)) & U32;
const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(32 - n))) & U32;
const sigma0 = (v) => ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & U32;
const sigma1 = (v) => ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & U32;
function edgeExpand(words, firstWord) { firstWord = firstWord || 16; for (let i = firstWord; i < 64; i++) { const x = words[i-2], y = words[i-15]; words.push((sigma1(x) + words[i-7] + sigma0(y) + words[i-16]) & U32); } }
function edgeRounds(state, words, firstRound, constants) { let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7]; for (let i = firstRound; i < 64; i++) { const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25); const ch = g ^ (e & (f ^ g)); const t1 = (h + S1 + ch + constants[i] + words[i]) & U32; const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22); const maj = (a & b) | (c & (a | b)); const t2 = (S0 + maj) & U32; h=g; g=f; f=e; e=(d+t1)&U32; d=c; c=b; b=a; a=(t1+t2)&U32; } return [a,b,c,d,e,f,g,h]; }
function edgeInit(first7) { const words = new Array(14).fill(0n); words.push(BigInt(((first7[0]<<16)|(first7[1]<<8)|first7[2])>>>0)); words.push(BigInt(((first7[3]<<24)|(first7[4]<<16)|(first7[5]<<8)|first7[6])>>>0)); for (let index = 16; index < 30; index++) { let value = SHA256_SCHEDULE[index - 16]; if (index - 2 >= 14) value += (index === 16) ? (sigma1(words[index-2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[index-2]); if (index - 7 >= 14) value += words[index - 7]; if (index - 15 >= 14) value += (index === 29) ? (sigma0(words[index-15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[index-15]); words.push(value & U32); } words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) & U32); edgeExpand(words, 31); const working = edgeRounds(SHA256_STATE, words, 14, BLOCK_CONSTANTS); return SHA256_INITIAL.map((x, i) => (x + working[i]) & U32); }
function edgeBytesToWordsBE(b) { const o = []; for (let i = 0; i + 4 <= b.length; i += 4) o.push(BigInt(((b[i]<<24)|(b[i+1]<<16)|(b[i+2]<<8)|b[i+3])>>>0)); return o; }
function edgeBytesToWordsLE(b) { const o = []; for (let i = 0; i + 4 <= b.length; i += 4) o.push(BigInt((b[i]|(b[i+1]<<8)|(b[i+2]<<16)|(b[i+3]<<24))>>>0)); return o; }
function edgeWordsBE(b, words) { const o = []; for (const w of words) { const v = Number(w & U32); o.push((v>>24)&255,(v>>16)&255,(v>>8)&255,v&255); } return o; }
function edgeWordsLE(b, words) { const o = []; for (const w of words) { const v = Number(w & U32); o.push(v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255); } return o; }
function edgeSha256(dataBytes) { const length = 57 + dataBytes.length; const padded = []; for (let i = 7; i < dataBytes.length; i++) padded.push(dataBytes[i]); padded.push(0x80); const zeros = ((55 - length) % 64 + 64) % 64; for (let i = 0; i < zeros; i++) padded.push(0); const bitLen = BigInt(length) * 8n; for (let i = 7; i >= 0; i--) padded.push(Number((bitLen >> BigInt(i*8)) & 0xFFn)); let state = edgeInit(dataBytes.slice(0, 7)); for (let off = 0; off < padded.length; off += 64) { const words = edgeBytesToWordsBE(padded.slice(off, off + 64)); edgeExpand(words, 16); const working = edgeRounds(state, words, 0, SHA256_ROUND_CONSTANTS); state = state.map((x, i) => (x + working[i]) & U32); } return edgeWordsBE(null, state); }
function edgeCs64(dataBytes, digestBytes) { const kw = edgeBytesToWordsLE(digestBytes.slice(0, 8)); const keyA = kw[0] | 1n; const keyB = kw[1] | 1n; const factors = [(keyA * CS64_FACTOR) & U32, (keyB * CS64_FACTOR) & U32]; const terms = CS64_COEFFICIENTS.map((c, i) => (c[0] * factors[i % 2]) & U32); const offsets = CS64_COEFFICIENTS.map((c) => c[1]); const padded = [0].concat(dataBytes); while (padded.length % 4 !== 0) padded.push(0); let ww = edgeBytesToWordsLE(padded); if (ww.length % 2 !== 0) ww.push(0n); for (let index = 0; index < ww.length; index++) { const word = ww[index]; let term = word * (index % 2 === 0 ? keyA : keyB); let offset = rol16(word) * (index % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn); if (index === 0) { term += CS64_ADJUSTMENT0 * factors[0]; offset += CS64_ADJUSTMENT1; } terms.push(term & U32); offsets.push(offset & U32); } let swap_acc = 0n, swap_last = 0n, state = 0n, acc = 0n; for (let index = 0; index < terms.length; index += 2) { const x = terms[index], y = terms[index + 1]; let t = rol16((offsets[index] + x) & U32); let q = (t * 0x76F50F34n) & U32; swap_acc += (rol16(q) * 0xC3EFEA97n + q) & U32; t = rol16((offsets[index + 1] + y) & U32); q = (t * 0x1881CE3Cn) & U32; swap_last = (rol16(q) * 0x35BD1EC9n + q) & U32; swap_acc = (swap_acc + swap_last) & U32; state = (state * keyA + x) & U32; state = (rol16(state) * 0xCF98B111n) & U32; state = (rol16(state) * 0x87085B9Fn) & U32; state = (rol16(state) * 0x12CEB96Dn) & U32; state = (rol16(state) * 0x257E1D83n) & U32; acc += state; t = (state * keyB + y) & U32; t = (rol16(t) * 0xA27416F5n) & U32; t = (rol16(t) * 0xD38396FFn) & U32; state = (rol16((rol16(t) * 0x7C932B89n) & U32) * 0xBFA49F69n) & U32; acc = (acc + state) & U32; } return [swap_last ^ state, swap_acc ^ acc]; }
function edgeSecMsGec() { let ticks = Date.now() / 1000; ticks += 11644473600; ticks -= ticks % 300; ticks *= 10000000; const str = ticks.toFixed(0) + EDGE_TOKEN; const dataBytes = []; for (let i = 0; i < str.length; i++) dataBytes.push(str.charCodeAt(i) & 0xFF); const digest = edgeSha256(dataBytes); const cs = edgeCs64(dataBytes, digest); const csHex = edgeWordsLE(null, cs).map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase(); const shHex = digest.map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase(); return csHex + "-" + shHex; }
function edgeEscXml(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
async function ttsEdge(texto, voz) {
  const token = edgeSecMsGec();
  const connId = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "");
  const wsUrl = "https://api.msedgeservices.com/tts/cognitiveservices/websocket/v1" +
    "?Ocp-Apim-Subscription-Key=" + encodeURIComponent(EDGE_TOKEN) +
    "&Sec-MS-GEC=" + encodeURIComponent(token) +
    "&Sec-MS-GEC-Version=" + encodeURIComponent(EDGE_VER) +
    "&ConnectionId=" + connId;
  const resp = await fetch(wsUrl, { headers: {
    Upgrade: "websocket",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    "Accept-Language": "en-US,en;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
  }});
  const ws = resp.webSocket;
  if (!ws) throw new Error("handshake " + resp.status);
  ws.binaryType = "arraybuffer";
  const audioChunks = [];
  const listo = new Promise((resolve, reject) => {
    const tmo = setTimeout(() => { try { ws.close(4001, "timeout"); } catch (e) {} reject(new Error("timeout")); }, 25000);
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") {
        if (ev.data.indexOf("Path:turn.end") >= 0) { clearTimeout(tmo); try { ws.close(1000, "done"); } catch (e) {} resolve(); }
      } else {
        const bytes = new Uint8Array(ev.data);
        if (bytes.length > 2) { const hl = (bytes[0] << 8) | bytes[1]; if (bytes.length > hl + 2) audioChunks.push(bytes.slice(2 + hl)); }
      }
    });
    ws.addEventListener("close", () => { clearTimeout(tmo); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(tmo); reject(new Error("ws error")); });
  });
  ws.accept();
  const fecha = new Date().toString();
  const cfg = "X-Timestamp:" + fecha + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
    JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "true" }, outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } });
  ws.send(cfg);
  const ssml = "<speak version='1.0' xml:lang='es-MX'><voice name='" + voz.replace(/_/g, "-") + "'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" + edgeEscXml(texto) + "</prosody></voice></speak>";
  const msg = "X-RequestId:" + connId + "\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:" + fecha + "Z\r\nPath:ssml\r\n\r\n" + ssml;
  ws.send(msg);
  await listo;
  if (!audioChunks.length) throw new Error("sin audio");
  let total = 0; for (const c of audioChunks) total += c.length;
  const out = new Uint8Array(total); let off = 0; for (const c of audioChunks) { out.set(c, off); off += c.length; }
  return out;
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

    // ── PING: diagnóstico para el Ajustes de la app. ?web=1 pruebe la búsqueda real ──
    if (url.pathname === "/ping" && request.method === "GET") {
      const out = { ok: true, kv: !!kv, pin: !!pinSrv, mem: (env && env.VIERNES_D1) ? "d1" : "kv" };
      if (url.searchParams.get("web") === "1") {
        out.web = await buscarWeb("precio del dólar hoy en México")
          .then((b2) => ({ disponible: true, fuente: b2.fuente, resultados: b2.items.length, titulo: b2.items[0] && b2.items[0].titulo }))
          .catch((e) => ({ disponible: false, error: e.message }));
      }
      return respuesta(out, request.headers.get("Origin") || "*");
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

    // ── MEMORIA (base de datos): notas, recordatorios, mensajes, aprendizajes.
    //      Motor preferente: D1 (SQL). Si no hay binding, usa el KV ya configurado. ──
    const DBd1 = (env && env.VIERNES_D1) || null;
    const KMEM = "viernes:memoria";
    function plegarSrv(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
    async function memInit() {
      if (DBd1) {
        try {
          await DBd1.prepare("CREATE TABLE IF NOT EXISTS memoria (id TEXT PRIMARY KEY, t INTEGER, tipo TEXT, texto TEXT, meta TEXT)").run();
          return "d1";
        } catch (e) { return "d1-error"; }
      }
      return "kv";
    }
    async function memInsertar(item) {
      if (DBd1) {
        await DBd1.prepare("INSERT OR REPLACE INTO memoria (id,t,tipo,texto,meta) VALUES (?,?,?,?,?)")
          .bind(item.id, item.t || Date.now(), item.tipo || "nota", item.texto || "", item.meta == null ? "" : JSON.stringify(item.meta)).run();
        return;
      }
      const l = await leerClave(KMEM, []);
      l.push({ id: item.id, t: item.t || Date.now(), tipo: item.tipo || "nota", texto: item.texto || "", meta: item.meta == null ? "" : JSON.stringify(item.meta) });
      await guardarClave(KMEM, l.slice(-2000));
    }
    async function memListar(tipos, limit) {
      if (DBd1) {
        let sql = "SELECT id,t,tipo,texto,meta FROM memoria", ps = [];
        if (tipos && tipos.length) { sql += " WHERE tipo IN (" + tipos.map(() => "?").join(",") + ")"; ps.push(...tipos); }
        sql += " ORDER BY t DESC LIMIT " + Math.max(1, Math.min(200, limit || 12));
        const j = await DBd1.prepare(sql).bind(...ps).all();
        return (j && j.results) || [];
      }
      let l = await leerClave(KMEM, []);
      if (tipos && tipos.length) l = l.filter((x) => tipos.includes(x.tipo));
      l.sort((a, b) => (b.t || 0) - (a.t || 0));
      return l.slice(0, Math.max(1, Math.min(200, limit || 12)));
    }
    async function memBuscar(q2, tipos, limit) {
      const palabras = plegarSrv(q2).split(/[^a-z0-9]+/).filter((p) => p.length > 2);
      const limit2 = Math.max(1, Math.min(50, limit || 12));
      if (DBd1) {
        const conds = [], ps = [];
        if (tipos && tipos.length) { conds.push("tipo IN (" + tipos.map(() => "?").join(",") + ")"); ps.push(...tipos); }
        for (const w of palabras) { conds.push("LOWER(texto) LIKE ?"); ps.push("%" + w + "%"); }
        const sql = "SELECT id,t,tipo,texto,meta FROM memoria" + (conds.length ? " WHERE " + conds.join(" AND ") : "") + " ORDER BY t DESC LIMIT " + limit2;
        const j = await DBd1.prepare(sql).bind(...ps).all();
        return (j && j.results) || [];
      }
      let l = await leerClave(KMEM, []);
      if (tipos && tipos.length) l = l.filter((x) => tipos.includes(x.tipo));
      if (palabras.length) l = l.filter((x) => { const b = plegarSrv(x.texto); return palabras.every((w) => b.includes(w)); });
      l.sort((a, b) => (b.t || 0) - (a.t || 0));
      return l.slice(0, limit2);
    }
    async function memEstado() {
      const motor = await memInit();
      let total = 0; const tipos = {};
      if (DBd1) {
        try {
          const j = await DBd1.prepare("SELECT tipo, COUNT(*) AS n FROM memoria GROUP BY tipo").all();
          for (const r2 of (j && j.results) || []) { tipos[r2.tipo] = r2.n; total += r2.n; }
        } catch (e) {}
      } else {
        const l = await leerClave(KMEM, []);
        for (const x of l) { tipos[x.tipo] = (tipos[x.tipo] || 0) + 1; }
        total = l.length;
      }
      return { motor, total, tipos };
    }
    if (url.pathname === "/mem" || url.pathname.indexOf("/mem/") === 0) {
      if (!pinSrv) return respuesta({ error: "Configure VIERNES_PIN en el worker" }, "*", 500);
      if (pedir(url, request) !== pinSrv) return respuesta({ error: "PIN incorrecto" }, "*", 403);
      const orig = request.headers.get("Origin") || "*";
      try {
        if (request.method === "POST" && url.pathname === "/mem") {
          const b = await request.json().catch(() => null);
          const texto = ((b && b.texto) || "").trim();
          if (!texto) return respuesta({ ok: false, error: "Falta texto" }, orig, 400);
          const item = {
            id: (b.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7)).slice(0, 40),
            t: Number(b.t) || Date.now(),
            tipo: String(b.tipo || "nota").slice(0, 30),
            texto: texto.slice(0, 6000),
            meta: b.meta || null,
          };
          await memInsertar(item);
          try { await bitacoraAdd("memoria", item.tipo + ": " + item.texto.slice(0, 90)); } catch (e2) {}
          return respuesta({ ok: true, id: item.id }, orig);
        }
        if (request.method === "GET" && url.pathname === "/mem") {
          const tipos = (url.searchParams.get("tipos") || "").split(",").map((t) => t.trim()).filter(Boolean);
          const items = await memListar(tipos.length ? tipos : null, Number(url.searchParams.get("limit")) || 12);
          return respuesta({ ok: true, items }, orig);
        }
        if (request.method === "POST" && url.pathname === "/mem/buscar") {
          const b = await request.json().catch(() => ({}));
          const tipos = Array.isArray(b.tipos) ? b.tipos : null;
          const items = await memBuscar(b.q || "", tipos, Number(b.limit) || 12);
          return respuesta({ ok: true, items }, orig);
        }
        if (request.method === "DELETE" && url.pathname === "/mem") {
          const id = url.searchParams.get("id") || "";
          if (!id) return respuesta({ ok: false, error: "Falta id" }, orig, 400);
          if (DBd1) await DBd1.prepare("DELETE FROM memoria WHERE id = ?").bind(id).run();
          else await guardarClave(KMEM, (await leerClave(KMEM, [])).filter((x) => x.id !== id));
          return respuesta({ ok: true }, orig);
        }
        if (request.method === "POST" && url.pathname === "/mem/vaciar") {
          if (DBd1) await DBd1.prepare("DELETE FROM memoria").run();
          else await guardarClave(KMEM, []);
          try { await bitacoraAdd("memoria", "vaciar: el jefe vació toda su base de datos"); } catch (e2) {}
          return respuesta({ ok: true }, orig);
        }
        if (request.method === "GET" && url.pathname === "/mem/estado") {
          const est = await memEstado();
          return respuesta({ ok: true, ...est }, orig);
        }
        return respuesta({ ok: false, error: "Ruta /mem no reconocida" }, orig, 404);
      } catch (e) {
        return respuesta({ ok: false, error: String((e && e.message) || e).slice(0, 140) }, orig, 500);
      }
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
            .replace(/\ba las?\s*\d{1,2}(?:[:.]\s*\d{2}|\s+y\s+media|\s+y\s+cuarto|\s+\d{2})?(?:\s*de la\s*)?(?:manana|mañana|madrugada|tarde|noche|am|pm)?\b/i, "")
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
      let notas = (await leerClave(K.notas, [])).slice(0, 10);
      const bit = (await leerClave(K.bit, [])).slice(-10);
      const ctxNotas = notas.length ? "NOTAS RECIENTES DEL JEFE:\n" + notas.map((n) => "- " + n.txt).join("\n") : "";
      const ctxBit = bit.length ? "INTERCAMBIOS RECIENTES:\n" + bit.map((b) => b.tipo + ": " + b.txt).join("\n") : "";
      let ctxWeb = "";
      if (quiereBusqueda(pregunta)) {
        try {
          const b2 = await buscarWeb(pregunta);
          ctxWeb = contextoBusqueda(b2.items);
          await bitacoraAdd("busqueda", "ok [" + b2.fuente + "]: " + b2.items.length + " resultados");
        } catch (e) {
          ctxWeb = NOTA_SIN_WEB; // el cerebro NO promete que va a buscar
          await bitacoraAdd("busqueda", "falló: " + e.message);
        }
      }
      const sys = "Eres VIERNES, asistente personal leal y eficiente. Hablas español de México, natural y breve, " +
        "para ser leído en voz alta (1 a 5 frases, sin listas ni emojis). No escribas ningún saludo de tratamiento; " +
        "el sistema lo agrega. Responde directo y útil." + ctxWeb + (ctxNotas ? "\n" + ctxNotas : "") + (ctxBit ? "\n" + ctxBit : "");
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
      const voz = url.searchParams.get("voz") || "es-MX-DaliaNeural";
      if (!texto) return new Response("Falta texto", { status: 400 });
      try {
        const audio = await ttsEdge(texto.slice(0, 400), voz);
        const resp = new Response(audio, { status: 200, headers: { "Content-Type": "audio/mpeg", "Content-Length": String(audio.length) } });
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
      let body = await request.text();
      // BÚSQUEDA WEB: si la última frase del jefe pide información, se
      // inyectan resultados frescos en el mensaje del sistema (sin tocar
      // nada más: para Groq la petición sigue siendo idéntica).
      try {
        const j = JSON.parse(body);
        const msgs = Array.isArray(j && j.messages) ? j.messages : [];
        const ultima = [...msgs].reverse().find((m) => m && m.role === "user");
        const textoU = ultima && typeof ultima.content === "string" ? ultima.content : "";
        if (textoU && quiereBusqueda(textoU)) {
          let inj = "";
          try {
            const b2 = await buscarWeb(textoU);
            inj = contextoBusqueda(b2.items);
            try { await bitacoraAdd("busqueda", "ok [" + b2.fuente + "]: " + b2.items.length + " resultados"); } catch (e2) {}
          } catch (e) {
            inj = NOTA_SIN_WEB; // el cerebro NO promete que va a buscar
            try { await bitacoraAdd("busqueda", "falló: " + e.message); } catch (e2) {}
          }
          if (inj) {
            const idx = msgs.findIndex((m) => m.role === "system");
            if (idx >= 0) msgs[idx] = { ...msgs[idx], content: (msgs[idx].content || "") + inj };
            else msgs.unshift({ role: "system", content: inj.trim() });
            j.messages = msgs;
            body = JSON.stringify(j);
          }
        }
      } catch (e) { /* sin búsqueda: el proxy sigue transparente */ }
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
    h.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    h.set("Access-Control-Allow-Headers", "authorization, content-type");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}
