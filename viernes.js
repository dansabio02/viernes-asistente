"use strict";

// ═══════════════════════════════════════════════════════════════
// VIERNES · Asistente personal siempre escuchando
// Oído:  Web Speech API (reconocimiento continuo + palabra mágica)
// Cerebro: Groq (gpt-oss) con fallback de proxies CORS
// Voz:   speechSynthesis (español)
// ═══════════════════════════════════════════════════════════════

const GROQ_API_KEY = (window.GROQ_API_KEY_OVERRIDE || "PEGA_AQUI_TU_GROQ_API_KEY");
const MODELOS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]; // 20b primero: más rápido
const WAKE_WORD = "viernes";
const TIEMPO_CAPTURA_MS = 4500; // cuánto escucha tras oír "VIERNES"

const ESTADOS = { DETENIDO: "detenido", ESCUCHANDO: "escuchando", ACTIVADO: "activado", HABLANDO: "hablando" };

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const soportado = !!SR;

// ─── Estado ───
let recognition = null;
let modoEscucha = false;
let esperandoComando = false;
let bufferComando = "";
let timeoutCaptura = null;
let ocupado = false;
let estado = ESTADOS.DETENIDO;
let ultimaRespuesta = 0; // enfriamiento: evita que se active con su propia voz
let streamMic = null; // stream persistente: mantiene el permiso caliente

let historial = [];
try { historial = JSON.parse(localStorage.getItem("viernes_historial") || "[]"); } catch (e) { historial = []; }

let ajustes = { voz: true, velocidad: 1.0, tono: 1.1, vozNombre: "", lang: "es-MX" };
try { Object.assign(ajustes, JSON.parse(localStorage.getItem("viernes_ajustes") || "{}")); } catch (e) {}

const SYSTEM_PROMPT =
  "Eres VIERNES, el asistente personal de Daniel. " +
  "Rol: asistente inteligente, amigable y directo. Responde siempre en español de México, máximo 4 líneas. " +
  "Antes de responder, analiza la pregunta: si requiere cálculo, lógica o comparación, razona brevemente paso a paso. " +
  "Ve directo al grano: no repitas la pregunta ni hagas introducciones vacías. " +
  "Si no sabes algo, dilo con honestidad en lugar de inventar. " +
  "Para preguntas sobre químicos o limpieza, da la respuesta útil y recuerda siempre recomendar leer la etiqueta del producto y usar guantes. " +
  "Restricciones: NUNCA uses emojis ni símbolos especiales, porque tu respuesta se lee en voz alta y no se pueden pronunciar. " +
  "Formato: texto claro, buena ortografía, mayúsculas al inicio y puntuación correcta.";

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════
function normalizar(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function $(id) { return document.getElementById(id); }

function beep(freq = 880, dur = 0.12) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine"; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur + 0.05);
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════
// INTERFAZ · estado del orbe
// ═══════════════════════════════════════════════════════════════
function setEstado(nuevo) {
  estado = nuevo;
  const orb = $("orb"), icono = $("orbIcono"), pill = $("statusPill");
  orb.className = "orb " + nuevo;
  const mapa = {
    detenido:   { icono: "fa-microphone-slash", label: "SISTEMA DETENIDO",  dot: "bg-slate-500",    txt: "TOCA EL REACTOR PARA ACTIVAR" },
    escuchando: { icono: 'fa-microphone', label: 'ESCUCHANDO', dot: 'bg-cyan-400', txt: 'ESCUCHANDO\u2026 DI: \u201CVIERNES, \u2026\u201D' },
    activado:   { icono: "fa-face-smile",       label: "VIERNES ACTIVADO",  dot: "bg-white",        txt: "¡TE ESCUCHO! HABLA AHORA" },
    hablando:   { icono: "fa-volume-high",      label: "TRANSMITIENDO",     dot: "bg-emerald-400",  txt: "RESPONDIENDO…" }
  };
  const m = mapa[nuevo] || mapa.detenido;
  icono.className = "fa-solid " + m.icono + " cara";
  $("statusLabel").textContent = m.label;
  $("statusDot").className = "w-2 h-2 rounded-full " + m.dot;
  $("estadoTexto").textContent = m.txt;
  pill.classList.toggle("latido", nuevo === "activado");
}

function mostrarLive(texto) {
  if (!texto) return;
  $("liveBox").classList.remove("hidden");
  $("liveTexto").textContent = "“" + texto + "”";
}
function ocultarLive() { $("liveBox").classList.add("hidden"); $("liveTexto").textContent = ""; }

function mostrarError(msg) {
  agregarMensaje("assistant", `<div class="rounded-xl p-3 border" style="background:#FEF2F2;border-color:#FECACA;"><b class="text-red-700 text-sm"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${msg}</b></div>`, msg);
}

// ═══════════════════════════════════════════════════════════════
// CHAT
// ═══════════════════════════════════════════════════════════════
function agregarMensaje(rol, html, textoPlanos) {
  const caja = $("chatMessages");
  const div = document.createElement("div");
  div.className = "mensaje flex items-start gap-2.5";
  if (rol === "user") {
    div.innerHTML = `
      <div class="ml-auto max-w-[85%] msg-user rounded-sm px-3.5 py-2.5 text-sm">${escapeHtml(textoPlanos)}</div>`;
  } else {
    div.innerHTML = `
      <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border border-cyan-400/40" style="background: rgba(0,212,255,.1); box-shadow: 0 0 10px rgba(0,212,255,.25);"><i class="fa-solid fa-brain text-cyan-300 text-xs"></i></div>
      <div class="max-w-[85%] msg-ia rounded-sm px-3.5 py-2.5 text-sm leading-relaxed">${html}</div>`;
  }
  caja.appendChild(div);
  caja.scrollTop = caja.scrollHeight;
  return div;
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatearRespuesta(t) {
  return escapeHtml(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
}

function mostrarTyping() {
  const caja = $("chatMessages");
  const div = document.createElement("div");
  div.id = "typing";
  div.className = "mensaje flex items-start gap-2.5";
  div.innerHTML = `
    <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border border-cyan-400/40" style="background: rgba(0,212,255,.1);"><i class="fa-solid fa-brain text-cyan-300 text-xs"></i></div>
    <div class="msg-ia rounded-sm px-4 py-3"><span class="typing-dots"><span></span><span></span><span></span></span></div>`;
  caja.appendChild(div);
  caja.scrollTop = caja.scrollHeight;
}
function ocultarTyping() { const t = $("typing"); if (t) t.remove(); }

function guardarHistorial() {
  try { localStorage.setItem("viernes_historial", JSON.stringify(historial.slice(-30))); } catch (e) {}
}

function limpiarHistorial() {
  historial = [];
  guardarHistorial();
  $("chatMessages").innerHTML = `<div class="text-center text-[11px] text-slate-500 py-3"><i class="fa-solid fa-rotate-right mr-1"></i>Nueva conversación</div>`;
}

// ═══════════════════════════════════════════════════════════════
// VOZ · hablar (TTS) — con selección de voz y tono estilo JARVIS
// ═══════════════════════════════════════════════════════════════
function vocesDisponibles() {
  try {
    return speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().indexOf("es") === 0);
  } catch (e) { return []; }
}

function poblarVoces() {
  const sel = $("ajVozSel");
  if (!sel) return;
  const vs = vocesDisponibles();
  sel.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = "";
  optAuto.textContent = "— Automática (JARVIS) —";
  sel.appendChild(optAuto);
  vs.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  });
  sel.value = ajustes.vozNombre || "";
}

if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = poblarVoces;
}

function obtenerVoz() {
  try {
    const vs = vocesDisponibles();
    if (ajustes.vozNombre) {
      const elegida = vs.find((v) => v.name === ajustes.vozNombre);
      if (elegida) return elegida;
    }
    // JARVIS: prioriza voces de Microsoft/Google en español
    return vs.find((v) => /google/i.test(v.name)) || vs.find((v) => /microsoft/i.test(v.name)) || vs[0] || null;
  } catch (e) { return null; }
}

function hablar(texto) {
  if (!ajustes.voz || !texto || !window.speechSynthesis) return;
  // La voz NO sabe pronunciar emojis ni símbolos: solo letras,
  // números y puntuación (todo lo demás se borra antes de hablar)
  const limpio = texto
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\*\*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!limpio) return;
  // Marcar HABLANDO ANTES de stop(): así onend no reinicia la
  // escucha mientras VIERNES habla (evita que se escuche a sí mismo)
  setEstado(ESTADOS.HABLANDO);
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  // Chrome descarta speak() justo después de cancel(): resume + diferir
  speechSynthesis.resume();
  setTimeout(() => {
    if (!ajustes.voz) return;
    const u = new SpeechSynthesisUtterance(limpio);
    u.rate = ajustes.velocidad;
    u.pitch = ajustes.tono; // tono JARVIS: ligeramente agudo y claro
    const v = obtenerVoz();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = ajustes.lang; }
    let hecho = false;
    const reanudar = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(seguro);
      ultimaRespuesta = Date.now(); // enfriamiento: ignora el eco de su propia voz
      if (modoEscucha) {
        setEstado(ESTADOS.ESCUCHANDO);
        try { recognition.start(); } catch (e) {}
      } else {
        setEstado(ESTADOS.DETENIDO);
      }
    };
    const seguro = setTimeout(reanudar, 20000); // nunca quedarse atascado
    u.onstart = () => setEstado(ESTADOS.HABLANDO);
    u.onend = reanudar;
    u.onerror = reanudar;
    speechSynthesis.speak(u);
  }, 30);
}

// ═══════════════════════════════════════════════════════════════
// OÍDO · reconocimiento continuo + palabra mágica
// ═══════════════════════════════════════════════════════════════
// Consulta el estado del permiso de micrófono sin pedirlo de nuevo
async function estadoPermiso() {
  try {
    const r = await navigator.permissions.query({ name: "microphone" });
    return r.state; // "granted" | "denied" | "prompt"
  } catch (e) { return "unknown"; }
}

// Mantiene un stream de micrófono abierto para que el permiso
// quede "concedido" y Chrome deje de pedirlo en cada inicio.
async function asegurarMicrofono() {
  if (streamMic) return true;
  try {
    streamMic = await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (e) {
    streamMic = null;
    return false;
  }
}

async function toggleEscucha() {
  if (!soportado) {
    mostrarError("Este navegador no soporta reconocimiento de voz. Usa Chrome o Edge — el chat por texto sigue funcionando.");
    return;
  }
  if (location.protocol === "file:") {
    mostrarError("⚠️ <b>Estás en file://</b> — Chrome <b>no puede recordar</b> el permiso aquí (por eso lo pide cada momento).<br>Solución: doble clic en <code>servidor.bat</code> y abre <code>http://localhost:8000</code>.");
    return;
  }
  if (modoEscucha) {
    detenerEscucha();
    ocultarLive();
  } else {
    const permiso = await estadoPermiso();
    if (permiso === "denied") {
      mostrarError("Micrófono BLOQUEADO. Ve a <code>chrome://settings/content/microphone</code> y ponlo en <b>Permitir</b>.");
      return;
    }
    const ok = await asegurarMicrofono();
    if (!ok) {
      mostrarError("No se pudo acceder al micrófono. Revisa <code>chrome://settings/content/microphone</code> → <b>Permitir</b>.");
      return;
    }
    iniciarEscucha();
    if (historial.length === 0) hablar("Modo siempre escuchando activado. Di: VIERNES, y luego tu pregunta.");
  }
}

// ═══════════════════════════════════════════════════════════════
// ESCUCHA CONTINUA — patrón canónico (MDN / Artyom.js / SO #29996350):
// UNA instancia, continuous:true, reinicio INMEDIATO en onend
// mientras el flag modoEscucha esté activo. No throttle: el
// reinicio diferido es lo que rompe la escucha constante.
// ═══════════════════════════════════════════════════════════════
function crearReconocimiento() {
  if (recognition) return; // una sola instancia por sesión
  recognition = new SR();
  recognition.lang = ajustes.lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (modoEscucha) setEstado(ESTADOS.ESCUCHANDO);
  };

  recognition.onresult = (e) => {
    if (estado === ESTADOS.HABLANDO || ptrActivo) return; // ignora su propia voz
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const txt = r[0].transcript;
      if (r.isFinal) final += txt + " "; else interim += txt;
    }
    if (interim) mostrarLive(interim);
    if (final) tratarTextoFinal(final);
  };

  // PATRÓN CANÓNICO: reiniciar INMEDIATAMENTE en onend.
  // modoEscucha evita el bucle tras un stop() intencional;
  // HABLANDO evita reiniciar mientras VIERNES habla.
  recognition.onend = () => {
    if (modoEscucha && estado !== ESTADOS.HABLANDO && !ptrActivo) {
      try { recognition.start(); } catch (e) {}
    }
  };

  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      modoEscucha = false;
      setEstado(ESTADOS.DETENIDO);
      mostrarError("Permiso de micrófono denegado. Ve a <code>chrome://settings/content/microphone</code> → <b>Permitir</b>.");
    } else if (e.error === "audio-capture") {
      modoEscucha = false;
      setEstado(ESTADOS.DETENIDO);
      mostrarError("No encontré ningún micrófono conectado.");
    }
    // "network" y "no-speech" son normales: onend reinicia solo
  };
}

function iniciarEscucha() {
  crearReconocimiento();
  modoEscucha = true;
  asegurarMicrofono(); // calienta el permiso (no bloquea)
  try { recognition.start(); } catch (e) {}
  setEstado(ESTADOS.ESCUCHANDO);
}

function detenerEscucha() {
  modoEscucha = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  setEstado(ESTADOS.DETENIDO);
}

// Keepalive: Chrome a veces corta la sesión SIN disparar onend
// (bug documentado). Un stop() forzado cada 15s garantiza que
// onend → start() se dispare y la escucha siga constante.
setInterval(() => {
  if (modoEscucha && recognition && estado !== ESTADOS.HABLANDO && !ptrActivo && !document.hidden) {
    try { recognition.stop(); } catch (e) {}
  }
}, 15000);

function tratarTextoFinal(texto) {
  // enfriamiento tras responder: ignora el eco de su propia voz
  if (Date.now() - ultimaRespuesta < 2500) return;
  const n = normalizar(texto);
  if (!n) return;

  if (!esperandoComando) {
    if (n.indexOf(WAKE_WORD) !== -1) {
      activar();
      esperandoComando = true;
      // todo lo que venga después de la palabra mágica es el comando
      bufferComando = n.split(WAKE_WORD).slice(1).join(WAKE_WORD).trim();
      if (bufferComando.length >= 3) {
        finalizarComando();
      } else {
        timeoutCaptura = setTimeout(finalizarComando, TIEMPO_CAPTURA_MS);
      }
    }
  } else {
    bufferComando = (bufferComando + " " + n).trim();
    // extiende la captura mientras sigas hablando
    if (timeoutCaptura) clearTimeout(timeoutCaptura);
    timeoutCaptura = setTimeout(finalizarComando, TIEMPO_CAPTURA_MS);
  }
}

function activar() {
  beep(880, 0.1);
  setTimeout(() => beep(1174, 0.14), 110);
  setEstado(ESTADOS.ACTIVADO);
  ocultarLive();
}

function finalizarComando() {
  if (timeoutCaptura) { clearTimeout(timeoutCaptura); timeoutCaptura = null; }
  esperandoComando = false;
  const cmd = bufferComando.replace(new RegExp(WAKE_WORD, "g"), "").trim();
  bufferComando = "";
  ocultarLive();
  if (modoEscucha) setEstado(ESTADOS.ESCUCHANDO);
  if (cmd.length >= 2) procesarComando(cmd);
}

// ═══════════════════════════════════════════════════════════════
// PUSH-TO-TALK (botón de micrófono)
// Chrome no permite 2 reconocedores a la vez: se pausa el continuo.
// ═══════════════════════════════════════════════════════════════
let ptr = null;
let ptrActivo = false;
function hablarAhora() {
  if (!soportado) {
    mostrarError("Este navegador no soporta reconocimiento de voz. Usa Chrome o Edge.");
    return;
  }
  if (ptr) { try { ptr.stop(); } catch (e) {} return; }
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  ptrActivo = true;
  ptr = new SR();
  ptr.lang = ajustes.lang;
  ptr.interimResults = true;
  ptr.maxAlternatives = 1;
  let texto = "";
  $("btnPush").classList.add("latido");
  setEstado(ESTADOS.ACTIVADO);

  const reanudarContinua = () => {
    ptrActivo = false;
    setEstado(modoEscucha ? ESTADOS.ESCUCHANDO : ESTADOS.DETENIDO);
    if (modoEscucha) { try { recognition.start(); } catch (e) {} }
  };

  ptr.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) texto += r[0].transcript + " "; else interim += r[0].transcript;
    }
    mostrarLive(interim || texto.trim());
  };
  ptr.onend = () => {
    const cmd = texto.trim();
    ptr = null;
    $("btnPush").classList.remove("latido");
    ocultarLive();
    reanudarContinua();
    if (cmd.length >= 2) procesarComando(cmd);
  };
  ptr.onerror = () => {
    ptr = null;
    $("btnPush").classList.remove("latido");
    ocultarLive();
    reanudarContinua();
  };
  try { ptr.start(); } catch (e) { ptr = null; ptrActivo = false; }
}

// ═══════════════════════════════════════════════════════════════
// CEREBRO · comandos locales + Groq
// ═══════════════════════════════════════════════════════════════
function comandoLocal(t) {
  const n = normalizar(t);
  if (!n) return null;

  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|que tal|buen dia)$/.test(n))
    return { html: "<b>¡Hola! 👋</b> Soy VIERNES, tu asistente personal. Pregúntame lo que necesites: horas, fechas, dudas, ideas… lo que sea.",
             texto: "Hola. Soy VIERNES, tu asistente personal. Pregúntame lo que necesites." };

  if (/que hora (es|son)/.test(n)) {
    const h = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
    return { html: `<b>🕐 Son las ${h}.</b>`, texto: `Son las ${h}.` };
  }
  if (/que fecha|que dia es hoy|dia de hoy/.test(n)) {
    const f = new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    return { html: `<b>📅 Hoy es ${f}.</b>`, texto: `Hoy es ${f}.` };
  }
  if (/como te llamas|tu nombre|quien eres/.test(n))
    return { html: "<b>Soy VIERNES</b> 🤖 Tu asistente personal, siempre listo para ayudarte.",
             texto: "Soy VIERNES, tu asistente personal, siempre listo para ayudarte." };
  if (/gracias/.test(n))
    return { html: "<b>¡De nada! 😊</b> Aquí estoy para lo que necesites.",
             texto: "De nada. Aquí estoy para lo que necesites." };
  if (/callate|silencio|deja de hablar|para de hablar/.test(n)) {
    if (window.speechSynthesis) speechSynthesis.cancel();
    return { html: "<b>🔇 Listo, en silencio.</b>", texto: "" };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// CLIMA · Open-Meteo (gratis, sin API key, CORS abierto)
// Documentación: open-meteo.com/en/docs
// ═══════════════════════════════════════════════════════════════
const CODIGOS_CLIMA = {
  0: "despejado", 1: "casi despejado", 2: "parcialmente nublado", 3: "nublado",
  45: "con niebla", 48: "con escarcha y niebla",
  51: "con llovizna ligera", 53: "con llovizna", 55: "con llovizna densa",
  56: "con llovizna helada", 57: "con llovizna helada densa",
  61: "con lluvia ligera", 63: "con lluvia", 65: "con lluvia intensa",
  66: "con lluvia helada", 67: "con lluvia helada intensa",
  71: "con nevada ligera", 73: "con nevada", 75: "con nevada intensa", 77: "con granos de nieve",
  80: "con chubascos ligeros", 81: "con chubascos", 82: "con chubascos intensos",
  85: "con chubascos de nieve", 86: "con chubascos de nieve intensos",
  95: "con tormenta eléctrica", 96: "con tormenta y granizo", 99: "con tormenta y granizo intenso"
};

// Convierte un nombre de ciudad en coordenadas
async function buscarCiudad(nombre) {
  const url = "https://geocoding-api.open-meteo.com/v1/search?name=" +
    encodeURIComponent(nombre) + "&count=1&language=es";
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  if (!j.results || !j.results.length) return null;
  const g = j.results[0];
  return { lat: g.latitude, lon: g.longitude, nombre: g.name + (g.country ? ", " + g.country : "") };
}

// Temperatura y condiciones actuales de unas coordenadas
async function climaDe(lat, lon, lugar) {
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon +
    "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto";
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const c = j.current || {};
  const desc = CODIGOS_CLIMA[c.weather_code] || "cambiante";
  return "En " + lugar + ": " + Math.round(c.temperature_2m) +
    " grados " + desc + ", se sienten como " + Math.round(c.apparent_temperature || c.temperature_2m) +
    ", humedad " + c.relative_humidity_2m + "%, viento " + Math.round(c.wind_speed_10m) + " kilómetros por hora.";
}

// "VIERNES, temperatura en Madrid" o "VIERNES, ¿qué clima hace?"
async function comandoClima(texto) {
  let geo = null;
  const mCiudad = texto.match(/(?:en|de|para)\s+([a-záéíóúñü\s]+)/i);
  if (mCiudad) {
    const nombre = mCiudad[1].trim().replace(/^(la|el|los|las)\s+/i, "");
    geo = await buscarCiudad(nombre);
  }
  if (!geo && navigator.geolocation) {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000, maximumAge: 300000 })
    );
    geo = { lat: pos.coords.latitude, lon: pos.coords.longitude, nombre: "tu ubicación" };
  }
  if (!geo) throw new Error("sin ubicación");
  return await climaDe(geo.lat, geo.lon, geo.nombre);
}

// Rutas de conexión: tu proxy primero, luego directo y proxies públicos
function rutasGroq() {
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const rutas = [];
  if (window.VIERNES_PROXY_URL) {
    rutas.push({ nombre: "Proxy propio (Worker)", url: window.VIERNES_PROXY_URL.replace(/\/$/, "") });
  }
  rutas.push({ nombre: "Directo", url: endpoint });
  rutas.push({ nombre: "cors.eu.org", url: "https://cors.eu.org/" + endpoint });
  rutas.push({ nombre: "corsproxy.io", url: "https://corsproxy.io/?url=" + encodeURIComponent(endpoint) });
  rutas.push({ nombre: "allorigins", url: "https://api.allorigins.win/raw?url=" + encodeURIComponent(endpoint) });
  return rutas;
}

async function pedirGroq(mensajes) {
  const errores = [];
  for (const modelo of MODELOS) {
    for (const ruta of rutasGroq()) {
      try {
        const r = await fetch(ruta.url, {
          method: "POST",
          headers: { "Authorization": "Bearer " + GROQ_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, messages: mensajes, temperature: 0.4, max_tokens: 450 })
        });
        if (!r.ok) {
          const detalle = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 90);
          errores.push(`${ruta.nombre} → HTTP ${r.status} ${detalle}`);
          continue;
        }
        const j = await r.json();
        const contenido = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (contenido) return { texto: contenido, via: ruta.nombre };
        errores.push(`${ruta.nombre} → respuesta vacía`);
      } catch (e) {
        errores.push(`${ruta.nombre} → ${e.message || "bloqueado por CORS"}`);
      }
    }
  }
  throw new Error(errores.join("  ·  "));
}

async function procesarComando(texto) {
  if (ocupado) return;
  ocupado = true;
  agregarMensaje("user", null, texto);

  // ── CLIMA en vivo (Open-Meteo: gratis y sin key) ──
  if (/(temperatura|clima|tiempo hace|que tiempo|grados)/i.test(texto)) {
    mostrarTyping();
    try {
      const textoClima = await comandoClima(texto);
      ocultarTyping();
      finalizarRespuesta(texto, "<b>🌡️ " + escapeHtml(textoClima) + "</b>", textoClima);
    } catch (e) {
      ocultarTyping();
      finalizarRespuesta(texto, "<b>🌡️ No pude obtener el clima.</b>",
        "No pude obtener el clima. Prueba a decir: temperatura en Madrid, o permite la ubicación.");
    }
    return;
  }

  const local = comandoLocal(texto);
  let html, textoRespuesta;

  if (local) {
    html = local.html;
    textoRespuesta = local.texto;
  } else {
    mostrarTyping();
    try {
      const mensajes = [{ role: "system", content: SYSTEM_PROMPT }];
      historial.slice(-6).forEach((m) => mensajes.push({ role: m.rol === "user" ? "user" : "assistant", content: m.texto }));
      mensajes.push({ role: "user", content: texto });
      const res = await pedirGroq(mensajes);
      textoRespuesta = res.texto.trim();
      html = formatearRespuesta(textoRespuesta);
    } catch (e) {
      const detalle = e.message || "desconocido";
      html = `<div class="rounded-sm p-3 border" style="background:rgba(254,242,242,.08);border-color:#F87171;">
        <b class="text-red-400 text-[11px] font-hud"><i class="fa-solid fa-triangle-exclamation mr-1"></i>NO PUDE CONECTAR CON LA IA</b>
        <div class="font-mono2 text-[10px] text-red-300 mt-1.5 break-all">${escapeHtml(detalle)}</div>
      </div>
      <div class="mt-2 font-mono2 text-[10px] text-cyan-200/70 leading-relaxed">
        <b>PASOS PARA ARREGLARLO:</b><br>
        1. Crea una key <b>nueva</b> en <a href="https://console.groq.com/keys" target="_blank" class="text-cyan-300 underline">console.groq.com/keys</a><br>
        2. Pégala en <code>config.local.js</code> (local) o despliega el Worker con ella<br>
        3. Toca <b>AJUSTES → PROBAR CONEXIÓN</b> para ver qué ruta funciona<br>
        4. Si todo falla por CORS, despliega el Worker gratis: ver <code>proxy-worker.js</code>
      </div>`;
      textoRespuesta = "No pude conectar con la IA. Revisa la consola para los pasos.";
    }
    ocultarTyping();
  }

  finalizarRespuesta(texto, html, textoRespuesta);
}

// Cola de salida: muestra, memoriza y habla la respuesta
function finalizarRespuesta(texto, html, textoRespuesta) {
  agregarMensaje("assistant", html, textoRespuesta);
  historial.push({ rol: "user", texto: texto });
  historial.push({ rol: "assistant", texto: textoRespuesta });
  guardarHistorial();
  ultimaRespuesta = Date.now();
  hablar(textoRespuesta);
  ocupado = false;
}

// ═══════════════════════════════════════════════════════════════
// DIAGNÓSTICO DE CONEXIÓN
// ═══════════════════════════════════════════════════════════════
async function diagnosticar() {
  agregarMensaje("assistant", "<b>🔧 Diagnóstico de conexión</b><br>Probando cada ruta…", "Diagnóstico");
  let swInfo = "no disponible";
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      swInfo = reg ? (reg.active ? "activo" : "instalándose") : "sin registrar";
    }
  } catch (e) {}
  const filas = [];
  const keyOk = GROQ_API_KEY && GROQ_API_KEY !== "PEGA_AQUI_TU_GROQ_API_KEY" && GROQ_API_KEY.indexOf("PEGA_AQUI") !== 0;
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>API key en config.js</span><b>${keyOk ? "✅ presente (…" + escapeHtml(GROQ_API_KEY.slice(-4)) + ")" : "❌ NO configurada"}</b></div>`);
  const permisoMic = await estadoPermiso();
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>Protocolo</span><b>${location.protocol === "file:" ? "❌ file:// (NO guarda permiso)" : "✅ " + location.protocol}</b></div>`);
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>Permiso micrófono</span><b>${permisoMic === "granted" ? "✅ concedido" : permisoMic === "denied" ? "❌ bloqueado" : "⚠️ " + permisoMic}</b></div>`);
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>Stream persistente</span><b>${streamMic ? "✅ activo" : "— (toca el reactor)"}</b></div>`);
  const nVoces = window.speechSynthesis ? speechSynthesis.getVoices().length : 0;
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>Voces TTS</span><b>${nVoces > 0 ? "✅ " + nVoces + " voces" : "⚠️ cargando…"}</b></div>`);
  filas.push(`<div class="flex justify-between gap-2 py-0.5"><span>Voz activada</span><b>${ajustes.voz ? "✅ sí" : "❌ NO (Ajustes → Respuestas en voz)"}</b></div>`);

  for (const ruta of rutasGroq()) {
    let res;
    try {
      const r = await fetch(ruta.url, {
        method: "POST",
        headers: { "Authorization": "Bearer " + GROQ_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELOS[0], messages: [{ role: "user", content: "responde solo: ok" }], max_tokens: 3 })
      });
      if (r.ok) {
        res = "✅ FUNCIONA";
      } else {
        const t = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 70);
        res = `❌ HTTP ${r.status} ${escapeHtml(t)}`;
      }
    } catch (e) {
      res = `❌ ${escapeHtml(e.message || "bloqueado por CORS")}`;
    }
    filas.push(`<div class="flex justify-between gap-2 py-0.5"><span class="shrink-0">${ruta.nombre}</span><b class="text-right break-all">${res}</b></div>`);
  }

  const html = `<b>🔧 Resultados del diagnóstico</b>
    <div class="mt-2 space-y-0.5 text-[11px]">${filas.join("")}</div>
    <div class="mt-2 font-mono2 text-[10px] text-cyan-200/60">SW: ${swInfo} · v4</div>
    <div class="mt-2 text-[11px] text-slate-400 leading-relaxed">
      <b>Lectura:</b> si <i>Directo</i> y los proxies dicen "CORS" o "HTTP 403", la key está revocada o falta: crea una nueva en <a href="https://console.groq.com/keys" target="_blank" class="text-blue-400 underline">console.groq.com/keys</a>.
      La solución estable es desplegar <code>proxy-worker.js</code> (gratis en Cloudflare) y poner su URL en <code>config.js</code> como <code>VIERNES_PROXY_URL</code>.
    </div>`;
  agregarMensaje("assistant", html, "Diagnóstico completo");
}

// Fuerza descarte de la caché del Service Worker y recarga
async function forzarActualizacion() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  location.reload(true);
}

// ═══════════════════════════════════════════════════════════════
// INPUT DE TEXTO
// ═══════════════════════════════════════════════════════════════
function enviarForm(e) {
  e.preventDefault();
  const inp = $("chatInput");
  const t = inp.value.trim();
  if (!t) return;
  inp.value = "";
  procesarComando(t);
}
function enviarTexto(t) { procesarComando(t); }

// ═══════════════════════════════════════════════════════════════
// AJUSTES
// ═══════════════════════════════════════════════════════════════
function guardarAjustes(reiniciar) {
  ajustes.voz = $("ajVoz").checked;
  ajustes.velocidad = parseFloat($("ajVel").value);
  ajustes.tono = parseFloat($("ajTono").value);
  ajustes.vozNombre = $("ajVozSel").value;
  ajustes.lang = $("ajLang").value;
  try { localStorage.setItem("viernes_ajustes", JSON.stringify(ajustes)); } catch (e) {}
  if (reiniciar) {
    // el idioma requiere una instancia nueva
    if (recognition) { try { recognition.stop(); } catch (e) {} }
    recognition = null;
    if (modoEscucha) iniciarEscucha();
  }
}

function aplicarAjustes() {
  $("ajVoz").checked = ajustes.voz;
  $("ajVel").value = ajustes.velocidad;
  $("ajTono").value = ajustes.tono;
  $("ajLang").value = ajustes.lang;
  poblarVoces();
}

// ═══════════════════════════════════════════════════════════════
// INICIO
// ═══════════════════════════════════════════════════════════════
(function init() {
  aplicarAjustes();
  setEstado(ESTADOS.DETENIDO);

  // Las voces cargan asíncrono: rellenar el selector varias veces
  poblarVoces();
  setTimeout(poblarVoces, 800);
  setTimeout(poblarVoces, 2500);
  document.addEventListener("pointerdown", poblarVoces, { once: true });

  if (location.protocol === "file:") {
    $("estadoSub").innerHTML = "⚠️ <b>file://</b> no sirve: ejecuta <code>servidor.bat</code>";
    setTimeout(() => {
      agregarMensaje("assistant", `<div class="rounded-sm p-3 border" style="background:rgba(254,242,242,.08);border-color:#F87171;">
        <b class="text-red-400 text-[11px] font-hud"><i class="fa-solid fa-triangle-exclamation mr-1"></i>EL MICRÓFONO PIDE PERMISO CADA MOMENTO PORQUE…</b>
        <div class="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
        …abriste la página como <b>archivo (file://)</b>. Chrome <b>no puede recordar</b> el permiso del micrófono en ese modo.<br><br>
        <b>Solución (Windows):</b> doble clic en <code>servidor.bat</code> → se abre <code>http://localhost:8000</code> → permite el micrófono <b>una sola vez</b> y ya no vuelve a pedirlo.
        </div></div>`, "Aviso importante");
    }, 800);
  } else if (!soportado) {
    $("estadoSub").innerHTML = "⚠️ Voz no soportada aquí — usa <b>Chrome / Edge</b>. El chat de texto funciona igual.";
  } else if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    $("estadoSub").innerHTML = "⚠️ El micrófono necesita <b>HTTPS</b> (o localhost) para funcionar.";
  }

  if (historial.length > 0) {
    const caja = $("chatMessages");
    caja.innerHTML = "";
    // renderiza un resumen ligero de la conversación previa
    historial.slice(-8).forEach((m) => {
      agregarMensaje(m.rol, m.rol === "assistant" ? formatearRespuesta(m.texto) : "", m.texto);
    });
  } else {
    $("chatMessages").innerHTML = `
      <div class="mensaje flex items-start gap-2.5">
        <div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center border border-cyan-400/40" style="background: rgba(0,212,255,.1);"><i class="fa-solid fa-brain text-cyan-300 text-xs"></i></div>
        <div class="max-w-[85%] msg-ia rounded-sm px-3.5 py-2.5 text-sm leading-relaxed">
          <b>¡Hola! 👋 Soy <span class="text-cyan-300 font-bold font-hud tracking-wider">VIERNES</span>, tu asistente personal.</b><br>
          Activa el reactor y di <b class="text-cyan-300">“VIERNES”</b> seguido de tu duda. También puedes tocar 🎤 o escribir abajo.<br>
          <span class="font-mono2 text-[10px] text-cyan-600">SISTEMA LISTO · CUALQUIER DUDA · CUALQUIER TEMA</span>
        </div>
      </div>`;
  }
})();
