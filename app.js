/* VIERNES MARK IV — app.js · Cerebro: Groq */
"use strict";

const DEFAULTS = {
  provider: "groq", apiKey: "", rememberKey: true, preferServerKey: false,
  connectionMode: "auto", baseUrl: "https://api.groq.com/openai/v1", proxyBase: "",
  model: "openai/gpt-oss-20b", reasoning: "medium", groqVisionModel: "qwen/qwen3.8-27b",
  maxTokens: 4096, webSearch: true, xSearch: false,
  voiceEngine: "browser", xaiVoice: "eve", xaiLang: "es-MX", browserVoice: "",
  rate: 1.0, pitch: 1.0, autoSpeak: true, sounds: true,
  userName: "Señor Daniel", altName: "Jefe", wakeWords: "viernes",
  language: "es-MX", followUp: 12, handsFree: true, autoStartMic: false,
  cameraDevice: "", imageDetail: "auto", maxImage: "1280", autoAttach: false, mirror: false, memory: true
};
let cfg = { ...DEFAULTS };
let recognition = null, listening = false, speaking = false, busy = false;
let historial = [], contextoImagen = null, cameraStream = null;
let synth = window.speechSynthesis;

const $ = (id) => document.getElementById(id);
const log = (t, tipo = "ok") => {
  const box = $("log"); if (!box) return;
  const d = new Date(), hh = String(d.getHours()).padStart(2,"0"), mm = String(d.getMinutes()).padStart(2,"0");
  const el = document.createElement("div");
  el.className = "log-entry " + tipo;
  el.innerHTML = `<span class="time">[${hh}:${mm}]</span>${t}`;
  box.appendChild(el); box.scrollTop = box.scrollHeight;
};
const toast = (t) => {
  const c = $("toasts"); if (!c) return;
  const el = document.createElement("div"); el.className = "toast"; el.textContent = t;
  c.appendChild(el); setTimeout(() => el.remove(), 3500);
};
const save = () => { try { localStorage.setItem("viernes_cfg", JSON.stringify(cfg)); } catch (e) {} };
// La clave de Groq vive en el Worker de Cloudflare (Secret GROQ_API_KEY).
// El navegador NO la necesita: llama al Worker, que añade la key del lado del servidor.
const WORKER_URL = (window.VIERNES_PROXY_URL || "https://viernes-proxy.danielnaula156.workers.dev").replace(/\/$/, "");

async function groqChat(mensajes) {
  const body = JSON.stringify({ model: cfg.model, messages: mensajes, temperature: 0.5, max_tokens: cfg.maxTokens });
  let r = await fetch(WORKER_URL + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error("Worker Groq HTTP " + r.status + ": " + t.slice(0,150));
  }
  const j = await r.json();
  const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!c) throw new Error("Respuesta vacía de Groq");
  return c;
}

function systemPrompt() {
  return "Eres VIERNES, asistente personal leal de " + cfg.userName + ". Responde en español de México, máximo 4 líneas. " +
    "Dirígete a él como 'señor' en cada respuesta. Nunca uses emojis. " +
    "Razona brevemente si requiere cálculo o lógica. Ve directo al grano, con respeto y lealtad.";
}

function setEstado(e) {
  const body = document.body; body.setAttribute("data-state", e);
  const st = $("statusText"), sub = $("orbSub"), orb = $("orbStage");
  if (st) st.textContent = e === "listening" ? "ESCUCHANDO" : e === "speaking" ? "HABLANDO" : "EN ESPERA";
  if (sub) sub.textContent = e === "listening" ? "MICRÓFONO ACTIVO" : e === "speaking" ? "RESPONDIENDO…" : "SISTEMA EN ESPERA";
  if (orb) orb.classList.toggle("active", e !== "standby");
  const btn = $("btnStop"); if (btn) btn.disabled = e !== "speaking";
}

function actualizarReloj() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2,"0"), m = String(d.getMinutes()).padStart(2,"0"), s = String(d.getSeconds()).padStart(2,"0");
  $("clockTime").textContent = h + ":" + m + ":" + s;
  const dias = ["DOM","LUN","MAR","MIE","JUE","VIE","SAB"], meses = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
  $("clockDate").textContent = dias[d.getDay()] + ", " + d.getDate() + " " + meses[d.getMonth()];
}

/* ==== VOZ (Web Speech) ==== */
function iniciarReconocimiento() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { log("Reconocimiento no soportado", "error"); return; }
  recognition = new SR();
  recognition.lang = cfg.language; recognition.continuous = true; recognition.interimResults = true;
  recognition.onstart = () => { listening = true; setEstado("listening"); };
  recognition.onend = () => { if (listening && !speaking) { try { recognition.start(); } catch (e) {} } };
  recognition.onresult = (e) => {
    let fin = "", inter = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]; if (r.isFinal) fin += r[0].transcript + " "; else inter += r[0].transcript;
    }
    if (inter) $("liveCaption").textContent = inter;
    if (fin) procesarVoz(fin.trim());
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { listening = false; setEstado("standby"); log("Micrófono denegado", "error"); }
  };
}
async function activarMicrofono() {
  // Recrear el reconocedor en cada activación para evitar estado "used"
  if (recognition) { try { recognition.onend = null; recognition.stop(); } catch (e) {} recognition = null; }
  iniciarReconocimiento();
  if (!recognition) { log("Reconocimiento no soportado", "error"); return; }
  listening = true; setEstado("listening");
  try { recognition.start(); } catch (e) { log("Error al iniciar micrófono: " + e.message, "error"); }
  $("btnPower").classList.add("active"); $("btnMic").classList.add("active");
  $("powerLabel").textContent = "ACTIVO";
  log("Escucha activa. Di «Viernes»…", "ok");
}
function desactivarMicrofono() {
  listening = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  setEstado("standby"); $("btnPower").classList.remove("active"); $("btnMic").classList.remove("active");
  $("powerLabel").textContent = "ACTIVAR";
  log("Escucha desactivada", "warn");
}
let ultimaRespuesta = 0;
function procesarVoz(texto) {
  const n = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const w = cfg.wakeWords.split(",").map(s => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""));
  const tieneWake = w.some(k => n.includes(k));
  if (Date.now() - ultimaRespuesta < cfg.followUp * 1000) { enviarTexto(texto); return; }
  if (tieneWake) {
    const resto = n; let cmd = texto;
    for (const k of w) { const idx = n.indexOf(k); if (idx >= 0) { cmd = texto.slice(idx + k.length).trim(); break; } }
    if (cmd) enviarTexto(cmd); else { setEstado("listening"); toast("¿Sí? Diga su petición"); }
  }
}

/* ==== TTS ==== */
function detenerEscuchaParaHablar() {
  if (recognition) { try { recognition.stop(); } catch (e) {} }
}
function reanudarEscucha() {
  if (!listening) return;
  try {
    if (!recognition) iniciarReconocimiento();
    if (recognition) recognition.start();
  } catch (e) {}
  setEstado("listening");
}

// Voz hiperrealista: Edge TTS neural vía el Worker (con fallback a navegador)
async function hablar(texto) {
  if (!cfg.autoSpeak || !texto) { setEstado(listening ? "listening" : "standby"); return; }
  speaking = true; busy = true; setEstado("speaking");
  detenerEscuchaParaHablar();
  // 1) intentar voz natural de Google vía Worker (gratis, sin key)
  try {
    const r = await fetch(WORKER_URL + "/tts?texto=" + encodeURIComponent(texto.slice(0, 200)));
    if (r.ok) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); speaking = false; busy = false; reanudarEscucha(); };
      a.onerror = () => { URL.revokeObjectURL(url); hablarLocal(texto); };
      a.play();
      return;
    }
  } catch (e) {}
  hablarLocal(texto);
}

function hablarLocal(texto) {
  if (!synth) { speaking = false; busy = false; reanudarEscucha(); return; }
  if (synth.speaking) synth.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = cfg.language; u.rate = cfg.rate; u.pitch = cfg.pitch;
  const voces = synth.getVoices();
  const v = voces.find(x => x.name === cfg.browserVoice) || voces.find(x => x.lang && x.lang.startsWith(cfg.language.split("-")[0])) || voces[0];
  if (v) u.voice = v;
  u.onend = u.onerror = () => { speaking = false; busy = false; reanudarEscucha(); };
  synth.speak(u);
}

// Keepalive: Chrome corta la sesión sin disparar onend tras varios ciclos.
setInterval(() => {
  if (listening && recognition && !speaking && !busy && !document.hidden) {
    try { recognition.stop(); } catch (e) {}
  }
}, 15000);

/* ==== MENSAJES ==== */
function agregarMensaje(rol, texto, img) {
  const box = $("messages"); if (!box) return;
  const div = document.createElement("div"); div.className = "msg " + (rol === "user" ? "msg-user" : "msg-vi");
  if (rol === "vi") {
    const av = document.createElement("div"); av.className = "msg-avatar";
    av.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.5l1.7 6.1 5.8 1.9-5.8 1.9L12 18.5l-1.7-6.1L4.5 10.5l5.8-1.9L12 2.5Z"/></svg>';
    div.appendChild(av);
  }
  const b = document.createElement("div"); b.className = "bubble";
  b.innerHTML = texto.replace(/\*\*(.+?)\*\*/g,"<b>$1</b>").replace(/\n/g,"<br>");
  if (img) { const im = document.createElement("img"); im.src = img; im.style.cssText = "max-width:180px;border-radius:8px;margin-top:8px;display:block"; b.appendChild(im); }
  div.appendChild(b);
  const t = document.createElement("div"); t.className = "msg-time";
  t.textContent = new Date().toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"});
  if (rol === "user") { div.insertBefore(b, div.firstChild); }
  box.appendChild(div); box.scrollTop = box.scrollHeight;
}

// Comandos locales instantáneos (sin IA): hora, fecha, saludos, estado
function normalizar(t) {
  return (t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function comandoLocal(texto) {
  const n = normalizar(texto);
  if (!n) return null;
  // ¿Estás despierta? → respuesta fija de lealtad
  if (/estas (despierta|despierto|ahi|activa|activo|ahi|presente|conmigo)|sigues (despierta|despierto|ahi|activa|activo)|estas funcionando/.test(n)) {
    return "Para usted señor, siempre.";
  }
  // Hora
  if (/que hora|la hora|hora actual|hora es|dime la hora/.test(n)) {
    const h = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    return "Son las " + h + ", señor.";
  }
  // Fecha
  if (/que fecha|que dia es|fecha de hoy|dia de hoy|la fecha/.test(n)) {
    const f = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    return "Hoy es " + f + ", señor.";
  }
  // Saludos
  if (/^(hola|buenos dias|buenas tardes|buenas noches|hey|ey|que tal|buen dia)$/.test(n)) {
    return "Hola, señor. Estoy a su servicio. ¿En qué le ayudo?";
  }
  // Quién eres
  if (/quien eres|como te llamas|tu nombre/.test(n)) {
    return "Soy Viernes, su asistente personal. Para usted señor, siempre disponible.";
  }
  return null;
}

// ── CLIMA en vivo (Open-Meteo, gratis y sin key) ──
const CODIGOS_CLIMA = {
  0:"despejado",1:"casi despejado",2:"parcialmente nublado",3:"nublado",
  45:"con niebla",48:"con escarcha",51:"llovizna ligera",53:"llovizna",55:"llovizna densa",
  56:"llovizna helada",57:"llovizna helada",61:"lluvia ligera",63:"lluvia",65:"lluvia intensa",
  66:"lluvia helada",67:"lluvia helada",71:"nevada ligera",73:"nevada",75:"nevada intensa",77:"granizo",
  80:"chubascos",81:"chubascos",82:"chubascos intensos",85:"chubascos de nieve",86:"chubascos de nieve",
  95:"tormenta",96:"tormenta con granizo",99:"tormenta fuerte"
};
async function buscarCiudad(nombre) {
  const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(nombre) + "&count=1&language=es");
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.results || !j.results.length) return null;
  const g = j.results[0];
  return { lat: g.latitude, lon: g.longitude, nombre: g.name + (g.country ? ", " + g.country : "") };
}
async function climaDe(lat, lon, lugar) {
  const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto");
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const c = j.current || {};
  const desc = CODIGOS_CLIMA[c.weather_code] || "cambiante";
  return "En " + lugar + " hay " + Math.round(c.temperature_2m) + " grados, " + desc +
    ", sensación de " + Math.round(c.apparent_temperature || c.temperature_2m) + " grados, humedad " +
    c.relative_humidity_2m + " por ciento, viento de " + Math.round(c.wind_speed_10m) + " kilómetros por hora, señor.";
}
async function comandoClima(texto) {
  const m = texto.match(/(?:en|de|para)\s+([a-záéíóúñü\s]+)/i);
  let geo = null;
  if (m) {
    const nombre = m[1].trim().replace(/^(la|el|los|las)\s+/i, "");
    geo = await buscarCiudad(nombre);
  }
  if (!geo && navigator.geolocation) {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 300000 }));
      geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, nombre: "su ubicación" };
    } catch (e) {}
  }
  if (!geo) return null;
  return await climaDe(geo.lat, geo.lon, geo.nombre);
}

async function enviarTexto(texto) {
  texto = (texto || "").trim();
  if (!texto && !contextoImagen) return;
  busy = true; $("btnStop").disabled = false; setEstado("speaking");
  agregarMensaje("user", texto || "[imagen]", contextoImagen);
  const n = parseInt($("turnCount").textContent) || 0; $("turnCount").textContent = (n+1) + " TURNOS";
  const ty = document.createElement("div"); ty.className = "msg msg-vi";
  ty.innerHTML = '<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
  $("messages").appendChild(ty);
  log("Usuario: " + (texto || "[imagen]"), "ok");
  const t0 = Date.now();
  try {
    // Comando local instantáneo (hora, fecha, saludo, estado) — sin IA
    let resp;
    if (!contextoImagen) resp = comandoLocal(texto);
    // Clima en vivo (Open-Meteo)
    if (!resp && !contextoImagen && /temperatura|clima|tiempo hace|que tiempo|grados|lluvia|humedad|calor|frio|nevando/.test(normalizar(texto))) {
      try { resp = await comandoClima(texto); } catch (e) { log("Clima: " + e.message, "warn"); }
    }
    if (!resp) {
      const msgs = [{ role: "system", content: systemPrompt() }, ...historial.slice(-6), { role: "user", content: texto || "(imagen)" }];
      resp = await groqChat(msgs);
    }
    ty.remove(); agregarMensaje("vi", resp);
    historial.push({ role: "user", content: texto || "[imagen]" }); historial.push({ role: "assistant", content: resp });
    if (cfg.memory) { try { localStorage.setItem("viernes_hist", JSON.stringify(historial.slice(-30))); } catch (e) {} }
    $("tLatency").textContent = (Date.now() - t0) + " ms";
    $("tTokens").textContent = "≈" + Math.round(resp.length / 4);
    $("tTransport").textContent = "GROQ"; $("tVoice").textContent = "BROWSER";
    hablar(resp);
  } catch (e) {
    ty.remove(); agregarMensaje("vi", "⚠️ " + e.message);
    log(e.message, "error"); setEstado(listening ? "listening" : "standby");
  } finally {
    busy = false; $("btnStop").disabled = true; contextoImagen = null; $("attachPreview").hidden = true;
  }
}

/* ==== CÁMARA ==== */
async function toggleCamara() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null;
    $("camera").srcObject = null; $("cameraPlaceholder").hidden = false;
    $("camBadge").textContent = "OFF"; $("camBadge").style.color = "var(--muted)";
    log("Cámara apagada", "warn");
  } else {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: parseInt(cfg.maxImage) }, height: { ideal: 720 } } });
      cameraStream = s; $("camera").srcObject = s; $("camera").play();
      $("cameraPlaceholder").hidden = true; $("camBadge").textContent = "ON"; $("camBadge").style.color = "var(--green)";
      $("camSource").textContent = "CÁMARA"; $("camRes").textContent = cfg.maxImage + "px";
      log("Cámara activada", "ok");
    } catch (e) { log("Error cámara: " + e.message, "error"); }
  }
}
async function capturarCamara() {
  if (!cameraStream) await toggleCamara();
  if (!cameraStream) return null;
  const v = $("camera"); const c = document.createElement("canvas");
  c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
  c.getContext("2d").drawImage(v, 0, 0);
  return c.toDataURL("image/jpeg", 0.85);
}
async function visionPregunta(prompt) {
  const img = await capturarCamara();
  if (!img) { toast("Activa la cámara primero"); return; }
  contextoImagen = img;
  $("attachImage").src = img; $("attachMeta").textContent = "Cámara · captura";
  $("attachPreview").hidden = false;
  enviarTexto(prompt);
}

/* ==== MODALES ==== */
function abrirModal(id) { const m = $(id); if (m) m.classList.add("open"); }
function cerrarModal(id) { const m = $(id); if (m) m.classList.remove("open"); }

/* ==== AJUSTES UI ==== */
function aplicarUI() {
  const sv = (id, val) => { const el = $(id); if (el) el.value = val; };
  const sc = (id, val) => { const el = $(id); if (el) el.checked = val; };
  const st = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  sv("setProvider", cfg.provider); sv("setApiKey", cfg.apiKey);
  sv("setModel", cfg.model); sv("setReasoning", cfg.reasoning);
  sv("setGroqVisionModel", cfg.groqVisionModel); sv("setMaxTokens", cfg.maxTokens);
  sc("setWebSearch", cfg.webSearch); sc("setXSearch", cfg.xSearch);
  sv("setVoiceEngine", cfg.voiceEngine); sv("setXaiVoice", cfg.xaiVoice);
  sv("setXaiLang", cfg.xaiLang); sv("setBrowserVoice", cfg.browserVoice);
  sv("setRate", cfg.rate); st("rateValue", cfg.rate.toFixed(2) + "×");
  sv("setPitch", cfg.pitch); st("pitchValue", cfg.pitch.toFixed(2));
  sc("setAutoSpeak", cfg.autoSpeak); sc("setSounds", cfg.sounds);
  sv("setUserName", cfg.userName); sv("setAltName", cfg.altName);
  sv("setWakeWords", cfg.wakeWords); sv("setLanguage", cfg.language);
  sv("setFollowUp", cfg.followUp); st("followUpValue", cfg.followUp + " s");
  sc("setHandsFree", cfg.handsFree); sc("setAutoStartMic", cfg.autoStartMic);
  sv("setImageDetail", cfg.imageDetail); sv("setMaxImage", cfg.maxImage);
  sc("setAutoAttach", cfg.autoAttach); sc("setMirror", cfg.mirror);
  sc("setMemory", cfg.memory); sc("setRememberKey", cfg.rememberKey);
  sc("setPreferServerKey", cfg.preferServerKey); sv("setConnectionMode", cfg.connectionMode);
  sv("setBaseUrl", cfg.baseUrl); sv("setProxyBase", cfg.proxyBase);
  const mname = cfg.model.split("/").pop();
  st("modelChip", mname); st("tModel", mname); st("aboutModel", mname);
  st("aboutTransport", "GROQ"); st("tSearch", cfg.webSearch ? "ACTIVA" : "OFF");
}

function bindAjustes() {
  const map = {
    setProvider: v => cfg.provider = v, setApiKey: v => cfg.apiKey = v,
    setModel: v => cfg.model = v, setReasoning: v => cfg.reasoning = v,
    setGroqVisionModel: v => cfg.groqVisionModel = v, setMaxTokens: v => cfg.maxTokens = parseInt(v)||4096,
    setWebSearch: v => cfg.webSearch = v, setXSearch: v => cfg.xSearch = v,
    setVoiceEngine: v => cfg.voiceEngine = v, setXaiVoice: v => cfg.xaiVoice = v,
    setXaiLang: v => cfg.xaiLang = v, setBrowserVoice: v => cfg.browserVoice = v,
    setUserName: v => cfg.userName = v, setAltName: v => cfg.altName = v,
    setWakeWords: v => cfg.wakeWords = v, setLanguage: v => { cfg.language = v; if (recognition) recognition.lang = v; },
    setImageDetail: v => cfg.imageDetail = v, setMaxImage: v => cfg.maxImage = v,
    setConnectionMode: v => cfg.connectionMode = v, setBaseUrl: v => cfg.baseUrl = v, setProxyBase: v => cfg.proxyBase = v
  };
  for (const [id, fn] of Object.entries(map)) {
    const el = $(id); if (!el) continue;
    el.addEventListener("change", () => { fn(el.value); save(); });
  }
  const checks = { setAutoSpeak:"autoSpeak", setSounds:"sounds", setHandsFree:"handsFree", setAutoStartMic:"autoStartMic", setAutoAttach:"autoAttach", setMirror:"mirror", setMemory:"memory", setRememberKey:"rememberKey", setPreferServerKey:"preferServerKey" };
  for (const [id, key] of Object.entries(checks)) {
    const el = $(id); if (!el) continue;
    el.addEventListener("change", () => { cfg[key] = el.checked; save(); });
  }
  const ranges = { setRate:"rate", setPitch:"pitch", setFollowUp:"followUp" };
  for (const [id, key] of Object.entries(ranges)) {
    const el = $(id); if (!el) continue;
    el.addEventListener("input", () => { cfg[key] = parseFloat(el.value)||0; save(); });
  }
  $("setRate").addEventListener("input", () => $("rateValue").textContent = cfg.rate.toFixed(2)+"×");
  $("setPitch").addEventListener("input", () => $("pitchValue").textContent = cfg.pitch.toFixed(2));
  $("setFollowUp").addEventListener("input", () => $("followUpValue").textContent = cfg.followUp+" s");
  // tabs
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".settings-panel").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const p = document.querySelector(`.settings-panel[data-panel="${t.dataset.tab}"]`);
    if (p) p.classList.add("active");
  }));
  $("btnTestApi").addEventListener("click", async () => {
    const res = $("apiTestResult"); res.textContent = "Probando…";
    try { const r = await groqChat([{ role: "user", content: "ok" }]); res.textContent = "✅ OK"; res.style.color = "var(--green)"; }
    catch (e) { res.textContent = "❌ " + e.message; res.style.color = "var(--red)"; }
  });
  $("btnClearKey").addEventListener("click", () => { cfg.apiKey = ""; $("setApiKey").value = ""; save(); log("Clave borrada","warn"); });
  $("btnTestVoice").addEventListener("click", () => hablar("Hola " + cfg.userName + ", soy Viernes."));
  $("btnExportData").addEventListener("click", () => { const b = new Blob([JSON.stringify({cfg,historial},null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="viernes_datos.json"; a.click(); });
  $("btnClearHistory").addEventListener("click", () => { historial = []; $("messages").innerHTML = ""; localStorage.removeItem("viernes_hist"); log("Historial borrado","ok"); });
  $("btnResetAll").addEventListener("click", () => { if (confirm("¿Restaurar todo?")) { localStorage.removeItem("viernes_cfg"); localStorage.removeItem("viernes_hist"); location.reload(); } });
  $("setKeyToggle").addEventListener("click", () => { const i = $("setApiKey"); i.type = i.type === "password" ? "text" : "password"; });
}

function cerrarOnboarding() {
  cfg.apiKey = $("onboardKey").value || cfg.apiKey;
  cfg.userName = $("onboardName").value || cfg.userName;
  cfg.altName = $("onboardAlt").value || cfg.altName;
  if ($("onboardRemember").checked) save(); else cfg.apiKey = $("onboardKey").value;
  cerrarModal("onboarding"); document.body.setAttribute("data-ready","true");
  aplicarUI(); log("Sistema inicializado. Proveedor: " + cfg.provider, "ok");
}

/* ==== STARFIELD + ORB ==== */
function starfield() {
  const cv = $("starfield"); if (!cv) return;
  const ctx = cv.getContext("2d"); let W, H, stars = [];
  function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; stars = Array.from({length:120},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.3+.3,v:Math.random()*.4+.1})); }
  function draw() { ctx.clearRect(0,0,W,H); ctx.fillStyle="#48e9ff"; for (const s of stars) { ctx.globalAlpha=.6; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,7); ctx.fill(); s.y-=s.v; if (s.y<0){s.y=H;s.x=Math.random()*W;} } ctx.globalAlpha=1; requestAnimationFrame(draw); }
  resize(); draw(); addEventListener("resize", resize);
}

// Orbe cerebro: red neuronal (neuronas + sinapsis con pulsos viajeros)
function brainNetwork() {
  const cv = $("brainCanvas"); if (!cv) return;
  const ctx = cv.getContext("2d"); const W = cv.width, H = cv.height;
  const cx = W/2, cy = H/2;
  const nodes = [];
  for (let i = 0; i < 80; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const ang = Math.random() * Math.PI * 2;
    const x = cx + side * W * 0.20 + Math.cos(ang) * W * 0.22;
    const y = cy + Math.sin(ang) * H * 0.36;
    nodes.push({ x, y, r: 1.2 + Math.random() * 1.8 });
  }
  const links = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i+1; j < nodes.length; j++) {
    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d < 95) links.push({ a: i, b: j, p: Math.random() });
  }
  const activo = () => document.body.getAttribute("data-state") !== "standby";
  function draw() {
    ctx.clearRect(0,0,W,H);
    const g = activo() ? 0.9 : 0.35;
    for (const l of links) {
      const a = nodes[l.a], b = nodes[l.b];
      ctx.strokeStyle = `rgba(72,233,255,${0.12*g})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      l.p += 0.004 * (activo() ? 2 : 1); if (l.p > 1) l.p = 0;
      const px = a.x + (b.x - a.x)*l.p, py = a.y + (b.y - a.y)*l.p;
      ctx.fillStyle = `rgba(72,233,255,${0.85*g})`;
      ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill();
    }
    for (const n of nodes) {
      ctx.fillStyle = `rgba(72,233,255,${0.65*g})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

function init() {
  try { Object.assign(cfg, JSON.parse(localStorage.getItem("viernes_cfg") || "{}")); } catch (e) {}
  try { historial = JSON.parse(localStorage.getItem("viernes_hist") || "[]"); } catch (e) {}
  starfield(); brainNetwork(); actualizarReloj(); setInterval(actualizarReloj, 1000);
  aplicarUI(); bindAjustes();
  // La clave está en el Worker de Cloudflare: NO bloquear con onboarding.
  document.body.setAttribute("data-ready","true");
  cerrarModal("onboarding");
  // chequeos de capacidades
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  document.querySelectorAll("#onboardStatus span").forEach(s => {
    const k = s.dataset.check;
    const ok = k === "browser" ? !!SR : k === "secure" ? location.protocol !== "file:" : k === "speech" ? !!window.speechSynthesis : k === "camera" ? !!navigator.mediaDevices : false;
    if (ok) { s.classList.add("ok"); s.innerHTML = s.innerHTML.replace("<i></i>", "<i></i>"); }
  });
  iniciarReconocimiento(); // calienta el permiso (no arranca)
  // listeners principales
  $("btnPower").addEventListener("click", () => listening ? desactivarMicrofono() : activarMicrofono());
  $("btnMic").addEventListener("click", () => listening ? desactivarMicrofono() : activarMicrofono());
  $("btnStop").addEventListener("click", () => { if (synth) synth.cancel(); speaking = false; busy = false; setEstado(listening?"listening":"standby"); });
  $("btnSend").addEventListener("click", () => { const v = $("messageInput").value; $("messageInput").value = ""; enviarTexto(v); });
  $("messageInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = $("messageInput").value; $("messageInput").value = ""; enviarTexto(v); } });
  $("btnClear").addEventListener("click", () => { $("messages").innerHTML = ""; historial = []; });
  $("btnAttach").addEventListener("click", async () => { const img = await capturarCamara(); if (img) { contextoImagen = img; $("attachImage").src = img; $("attachMeta").textContent = "Cámara"; $("attachPreview").hidden = false; } });
  $("btnRemoveAttach").addEventListener("click", () => { contextoImagen = null; $("attachPreview").hidden = true; });
  $("btnQuickVision").addEventListener("click", () => visionPregunta("Describe con detalle lo que ves."));
  document.querySelectorAll(".vision-quick button").forEach(b => b.addEventListener("click", () => visionPregunta(b.dataset.visionPrompt)));
  $("btnCameraToggle").addEventListener("click", toggleCamara);
  $("btnCameraPlaceholder").addEventListener("click", toggleCamara);
  $("btnSwitchCamera").addEventListener("click", () => toast("Cambio de cámara no disponible"));
  $("btnScreenShare").addEventListener("click", async () => {
    try { const s = await navigator.mediaDevices.getDisplayMedia({video:true}); $("camera").srcObject = s; $("cameraPlaceholder").hidden = true; log("Pantalla compartida","ok"); }
    catch (e) { log("Error pantalla: " + e.message, "error"); }
  });
  $("btnClearLog").addEventListener("click", () => $("log").innerHTML = "");
  $("btnOpenSettings").addEventListener("click", () => abrirModal("settingsModal"));
  $("btnCloseSettings").addEventListener("click", () => cerrarModal("settingsModal"));
  $("btnSettingsDone").addEventListener("click", () => cerrarModal("settingsModal"));
  $("btnHelp").addEventListener("click", () => abrirModal("helpModal"));
  $("btnCloseHelp").addEventListener("click", () => cerrarModal("helpModal"));
  $("btnVisionSettings").addEventListener("click", () => { abrirModal("settingsModal"); document.querySelector('.tab[data-tab="vision"]').click(); });
  $("onboardStart").addEventListener("click", cerrarOnboarding);
  $("onboardSkip").addEventListener("click", () => { cerrarModal("onboarding"); document.body.setAttribute("data-ready","true"); });
  $("onboardKeyToggle").addEventListener("click", () => { const i = $("onboardKey"); i.type = i.type === "password" ? "text" : "password"; });
  $("onboardProvider").addEventListener("change", () => {
    const g = $("onboardProvider").value === "groq";
    $("onboardKeyLabel").textContent = g ? "Clave API de Groq" : "Clave API de xAI";
    $("onboardKeyLink").href = g ? "https://console.groq.com/keys" : "https://console.x.ai/settings/api-keys";
  });
  if (cfg.autoStartMic) setTimeout(activarMicrofono, 800);
  log("VIERNES MARK IV iniciado", "ok");
}

document.addEventListener("DOMContentLoaded", init);
