/* ============================================================
   VIERNES · Reconocimiento de hablante (Picovoice Eagle)
   On-device (WASM), gratuito hasta 3 hablantes.
   Requiere AccessKey de console.picovoice.ai
   ============================================================ */
"use strict";

const EAGLE_MODEL = "https://cdn.jsdelivr.net/gh/Picovoice/eagle@master/lib/common/eagle_params.pv";
const EAGLE_LIB = "https://unpkg.com/@picovoice/eagle-web@3.0.1/dist/esm/index.js";

const LS_KEY = "viernes_voces";       // perfiles de voz guardados
const LS_ACCESSKEY = "viernes_pv_key"; // AccessKey de Picovoice

let eagle = null, profiler = null;

/* ── utilidades ── */
function getAccessKey() {
  return localStorage.getItem(LS_ACCESSKEY) || "";
}
function setAccessKey(k) {
  localStorage.setItem(LS_ACCESSKEY, k);
}
function getPerfiles() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) { return {}; }
}
function guardarPerfil(nombre, base64) {
  const p = getPerfiles();
  p[nombre] = base64;
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) {}
}
function borrarPerfil(nombre) {
  const p = getPerfiles(); delete p[nombre];
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) {}
}

/* ── captura de audio PCM 16kHz mono (Int16Array) ── */
async function grabarPCM(segundos) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => {
    const f32 = e.inputBuffer.getChannelData(0);
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    chunks.push(i16);
  };
  src.connect(proc); proc.connect(ctx.destination);
  await ctx.resume();
  await new Promise((r) => setTimeout(r, segundos * 1000));
  proc.disconnect(); src.disconnect(); ctx.close();
  stream.getTracks().forEach((t) => t.stop());
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Int16Array(total);
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/* ── cargar librería Eagle (import dinámico) ── */
async function cargarEagle() {
  if (eagle) return eagle;
  const mod = await import(EAGLE_LIB);
  if (!mod.Eagle || !mod.EagleProfiler) throw new Error("Librería Eagle incompleta");
  return mod;
}

/* ── inscripción (enrollment) ── */
async function inscribirVoz(nombre, segundos = 15) {
  const key = getAccessKey();
  if (!key) throw new Error("Falta el AccessKey de Picovoice. Configúralo en Ajustes.");
  const mod = await cargarEagle();
  const p = await mod.EagleProfiler.create(key, { publicPath: EAGLE_MODEL });
  profiler = p;
  let pct = 0, intentos = 0;
  // enroll hasta 100% (máx 30 s de audio)
  while (pct < 100 && intentos < 6) {
    const pcm = await grabarPCM(Math.min(segundos, 5));
    pct = await p.enroll(pcm);
    intentos++;
  }
  if (pct < 100) { await p.release(); throw new Error("Inscripción incompleta (" + Math.round(pct) + "%). Hable más claro."); }
  const perfil = await p.export();
  const b64 = (perfil.toBase64 ? perfil.toBase64() : perfil);
  await p.release(); profiler = null;
  guardarPerfil(nombre, b64);
  return Math.round(pct);
}

/* ── verificación (recognition) ── */
async function verificarVoz(segundos = 5) {
  const key = getAccessKey();
  if (!key) throw new Error("Falta AccessKey de Picovoice.");
  const perfiles = getPerfiles();
  const nombres = Object.keys(perfiles);
  if (!nombres.length) throw new Error("No hay voces inscritas.");
  const mod = await cargarEagle();
  const e = await mod.Eagle.create(key, { publicPath: EAGLE_MODEL });
  const pcm = await grabarPCM(segundos);
  let mejor = null;
  for (const nombre of nombres) {
    const profile = { toBase64: () => perfiles[nombre] };
    const scores = await e.process(pcm, profile);
    if (scores && scores.length) {
      const s = scores[0];
      if (!mejor || s > mejor.score) mejor = { nombre, score: s };
    }
  }
  await e.release(); eagle = null;
  return mejor; // { nombre, score } o null
}

/* ── autoprueba robusta ── */
async function autotest() {
  const res = { ok: true, pasos: [] };
  try {
    res.pasos.push({ ok: true, txt: "AccessKey: " + (getAccessKey() ? "presente" : "FALTA") });
    const mod = await cargarEagle();
    res.pasos.push({ ok: true, txt: "Librería Eagle cargada (v" + (mod.Eagle.version || "?") + ")" });
    const key = getAccessKey() || "INVALID_KEY_FOR_TEST";
    const e = await mod.Eagle.create(key, { publicPath: EAGLE_MODEL });
    res.pasos.push({ ok: true, txt: "Modelo cargado y motor creado" });
    await e.release();
  } catch (e) {
    res.ok = false;
    res.pasos.push({ ok: false, txt: "Error: " + e.message });
  }
  return res;
}

/* ── exponer ── */
window.ViernesVoice = {
  getAccessKey, setAccessKey, getPerfiles, borrarPerfil,
  inscribirVoz, verificarVoz, autotest, grabarPCM
};
