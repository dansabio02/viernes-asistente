/* ============================================================
   VIERNES · OÍDO PERSONAL (Voice ID, al estilo de los Echo)
   Igual que Amazon enseña a Alexa la voz de cada usuario
   ("Voice Profile"), VIERNES puede aprender la firma numérica
   de la voz de su jefe. Cada frase que llega al micrófono se
   compara contra esa firma: si la voz no es la suya (TV,
   celular, otra persona), la frase se descarta y VIERNES
   no responde.
   Motor: NeXt-TDNN (verificación de hablante) corriendo en el
   navegador con onnxruntime-web; modelo "mobile-128" (~5 MB,
   descargado una vez y guardado en caché). Sin llaves ni
   cuentas; la voz NUNCA sale del teléfono.
   FILOSOFÍA FAIL-OPEN: si falta el modelo, el micrófono o hay
   cualquier error, la frase SE ATIENDE. El oído personal nunca
   deja a VIERNES sordo.
   Interfaz: window.ViernesVozId
     activo()            → true si encendido + perfil + motor sano
     esElJefe()          → true/false (fail-open devuelve true)
     ultimoResultado     → { sim, umbral, razon } de la última
                           verificación (para el registro)
     enseniar(aviso)     → inscribe 3 muestras de la voz
     borrar(), estado(), iniciar(), cerrar()
     _internos           → ganchos de prueba (QA sin micrófono)
   ============================================================ */
"use strict";
(() => {

const LS_PERFIL = "viernes_vozid";
const LS_ON = "viernes_vozid_on";
const LS_UMBRAL = "viernes_vozid_umbral";
const MODELO = "mobile-128";            // NeXt-TDNN liviano (~5 MB)
const URL_ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js";
const URL_SV = "https://cdn.jsdelivr.net/npm/@jaehyun-ko/speaker-verification@5.0.0/dist/speaker-verification.js";
const UMBRALES = { laxo: 0.45, normal: 0.58, estricto: 0.68 };
const SEG_RING = 12;                    // segundos de audio conservados
const SEG_VERIFICAR = 6;                // ventana que se verifica
const SEG_MUESTRA = 5;                  // segundos por muestra de inscripción

let verificador = null, cargando = null, failSesion = false;
let ctxAudio = null, stream = null, nodo = null, fuente = null, mudo = null;
let ring = null, ringPos = 0, pausado = false;
let ultimo = null;

/* ── Perfil y ajustes ── */
function perfil() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_PERFIL) || "null");
    return (p && Array.isArray(p.muestras) && p.muestras.length) ? p : null;
  } catch (e) { return null; }
}
function guardarPerfil(p) { try { localStorage.setItem(LS_PERFIL, JSON.stringify(p)); } catch (e) {} }
function encendido() { try { return localStorage.getItem(LS_ON) === "1"; } catch (e) { return false; } }
function umbral() {
  const u = UMBRALES[String(localStorage.getItem(LS_UMBRAL) || "normal")];
  return typeof u === "number" ? u : UMBRALES.normal;
}
function activo() { return encendido() && !!perfil() && !failSesion; }

/* ── Carga perezosa del motor (scripts de CDN + modelo) ── */
function cargarScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("no cargó " + src.slice(0, 60)));
    document.head.appendChild(s);
  });
}
async function preparar() {
  if (verificador) return verificador;
  if (cargando) return cargando;
  cargando = (async () => {
    if (!window.ort) await cargarScript(URL_ORT);
    if (!window.SpeakerVerification) await cargarScript(URL_SV);
    const v = new window.SpeakerVerification();
    await v.initialize(MODELO); // baja ~5 MB la primera vez; luego queda en caché
    verificador = v;
    return v;
  })();
  try { return await cargando; }
  catch (e) { cargando = null; throw e; }
}
/* En QA el verificador puede ser un mock: no se sustituye. */
let modoMock = false;

/* ── Captura de micrófono (anillo de audio crudo) ── */
async function abrir() {
  if (stream) return true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
    if (ctxAudio.state === "suspended") { try { await ctxAudio.resume(); } catch (e) {} }
    fuente = ctxAudio.createMediaStreamSource(stream);
    nodo = ctxAudio.createScriptProcessor(4096, 1, 1);
    ring = new Float32Array(Math.floor(ctxAudio.sampleRate * SEG_RING));
    ringPos = 0;
    nodo.onaudioprocess = (ev) => {
      // No capturar mientras VIERNES suena (su propia voz NO es el jefe)
      if (pausado || (window.ViernesSoniendo && window.ViernesSoniendo())) return;
      const e = ev.inputBuffer.getChannelData(0);
      for (let i = 0; i < e.length; i++) { ring[ringPos] = e[i]; ringPos = (ringPos + 1) % ring.length; }
    };
    mudo = ctxAudio.createGain(); mudo.gain.value = 0; // silencio: solo para activar el nodo
    fuente.connect(nodo); nodo.connect(mudo); mudo.connect(ctxAudio.destination);
    return true;
  } catch (e) { failSesion = true; return false; }
}
function cerrar() {
  try { if (nodo) nodo.disconnect(); } catch (e) {}
  try { if (fuente) fuente.disconnect(); } catch (e) {}
  try { if (mudo) mudo.disconnect(); } catch (e) {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  try { if (ctxAudio) ctxAudio.close(); } catch (e) {}
  stream = nodo = fuente = mudo = ctxAudio = ring = null;
}

/* ── Últimos N segundos del anillo, con silencio recortado ── */
function segmentoVoz(segundos) {
  if (!ring || !ctxAudio) return null;
  const total = ring.length;
  const n = Math.min(total, Math.ceil(ctxAudio.sampleRate * (segundos || SEG_VERIFICAR)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ring[(ringPos - n + i + total) % total];
  return recortarSilencio(out, ctxAudio.sampleRate);
}
/* Recorta el silencio de los extremos; null si no hay voz clara. */
function recortarSilencio(pcm, rate) {
  const frame = Math.max(1, Math.floor(rate * 0.02));
  const nf = Math.floor(pcm.length / frame);
  if (nf < 40) return null;
  const rms = new Array(nf);
  for (let f = 0; f < nf; f++) {
    let s = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) s += pcm[i] * pcm[i];
    rms[f] = Math.sqrt(s / frame);
  }
  const pico = Math.max.apply(null, rms);
  if (pico < 0.012) return null; // silencio total
  const tRms = Math.max(0.008, pico * 0.12);
  let a = -1, b = -1;
  for (let f = 0; f < nf && a < 0; f++) if (rms[f] >= tRms) a = f;
  for (let f = nf - 1; f >= 0 && b < 0; f--) if (rms[f] >= tRms) b = f;
  if (a < 0 || b < a) return null;
  const dur = (b - a + 1) * frame / rate;
  if (dur < 1.0) return null; // muy corto para juzgar una voz
  return pcm.slice(a * frame, (b + 1) * frame);
}

/* ── PCM crudo → WAV mono 16 kHz (formato que espera el modelo) ── */
function wav16k(pcm, rate) {
  const OBJ = 16000;
  let senal = pcm, r = rate;
  if (Math.abs(rate - OBJ) > 1) {
    const n = Math.max(1, Math.floor(pcm.length * OBJ / rate));
    senal = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * rate / OBJ, j = Math.floor(x), f = x - j;
      const s0 = pcm[Math.min(j, pcm.length - 1)], s1 = pcm[Math.min(j + 1, pcm.length - 1)];
      senal[i] = s0 + (s1 - s0) * f;
    }
    r = OBJ;
  }
  const buf = new ArrayBuffer(44 + senal.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + senal.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, r, true); v.setUint32(28, r * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, senal.length * 2, true);
  for (let i = 0; i < senal.length; i++) {
    const s = Math.max(-1, Math.min(1, senal[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/* ── Verificación: ¿esta voz es la del jefe? ── */
async function esElJefe() {
  const p = perfil();
  if (!encendido() || !p || failSesion) { ultimo = { razon: "inactivo" }; return true; }
  if (!stream) { const ok = await abrir(); if (!ok) { ultimo = { razon: "sin microfono" }; return true; } }
  try {
    await Promise.race([
      preparar(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("modelo tardó")), 30000)),
    ]);
  } catch (e) { failSesion = true; ultimo = { razon: "motor caído" }; return true; }
  const seg = segmentoVoz(SEG_VERIFICAR);
  if (!seg) { ultimo = { razon: "sin voz clara" }; return true; }
  try {
    const blob = wav16k(seg, ctxAudio.sampleRate);
    const r = await Promise.race([
      verificador.getEmbedding(blob),
      new Promise((_, rej) => setTimeout(() => rej(new Error("verificación tardó")), 4000)),
    ]);
    if (!r || !r.embedding) { ultimo = { razon: "sin embedding" }; return true; }
    let mejor = -1;
    for (const m of p.muestras) {
      const s = verificador.compareEmbeddings(r.embedding, new Float32Array(m));
      if (s > mejor) mejor = s;
    }
    const u = umbral();
    ultimo = { sim: mejor, umbral: u };
    return mejor >= u;
  } catch (e) { ultimo = { razon: "error: " + e.message }; return true; }
}

/* ── Inscripción: 3 muestras de ~5 s hablando normal ── */
async function enseniar(aviso) {
  if (!stream) { const ok = await abrir(); if (!ok) return { ok: false, error: "no pude abrir el micrófono" }; }
  try { await preparar(); } catch (e) { return { ok: false, error: "no bajó el modelo de voz" }; }
  const muestras = [];
  for (let i = 1; i <= 3; i++) {
    let hecha = false;
    for (let intento = 0; intento < 2 && !hecha; intento++) {
      if (aviso) aviso(i, SEG_MUESTRA * 1000, intento > 0);
      pausado = false;
      if (ring) ring.fill(0);
      await new Promise((res) => setTimeout(res, (SEG_MUESTRA + 1) * 1000));
      const seg = segmentoVoz(SEG_MUESTRA + 1);
      if (!seg) continue;
      try {
        const r = await Promise.race([
          verificador.getEmbedding(wav16k(seg, ctxAudio.sampleRate)),
          new Promise((_, rej) => setTimeout(() => rej(new Error("tardo")), 4000)),
        ]);
        if (r && r.embedding) { muestras.push(Array.from(r.embedding)); hecha = true; }
      } catch (e) {}
    }
    if (!hecha) return { ok: false, error: "no se escuchó su voz en la muestra " + i };
  }
  guardarPerfil({ t: Date.now(), muestras });
  return { ok: true, n: muestras.length };
}

/* ── Estado para la interfaz ── */
function estado() {
  const p = perfil();
  return {
    encendido: encendido(),
    tienePerfil: !!p,
    nMuestras: p ? p.muestras.length : 0,
    fecha: p ? p.t : 0,
    motorCargado: !!verificador,
    umbral: umbral(),
    sana: !failSesion,
  };
}
async function iniciar() {
  try { await preparar(); } catch (e) { failSesion = true; return false; }
  const ok = await abrir();
  if (!ok) failSesion = true;
  return ok;
}

/* Ganchos de prueba (QA sin micrófono) */
const _internos = {
  recortarSilencio, wav16k, segmentoVoz,
  ponerRing(arr, rate) { ring = arr; ctxAudio = { sampleRate: rate }; ringPos = 0; },
  limpiarRing() { ring = null; ctxAudio = null; },
  ponerPerfil(muestras) { guardarPerfil({ t: Date.now(), muestras }); },
  quitarPerfil() { try { localStorage.removeItem(LS_PERFIL); } catch (e) {} },
  ponerVerificador(v) { verificador = v; modoMock = true; cargando = Promise.resolve(v); },
  quitarMock() { verificador = null; modoMock = false; cargando = null; },
  fingirStream() { stream = { getTracks: () => [] }; }, // QA: omite getUserMedia
  encender(on) { try { localStorage.setItem(LS_ON, on ? "1" : "0"); } catch (e) {} },
  forzarFallo(on) { failSesion = !!on; },
};

window.ViernesVozId = {
  activo, esElJefe, enseniar, iniciar, cerrar, estado,
  get ultimoResultado() { return ultimo; },
  borrar() { try { localStorage.removeItem(LS_PERFIL); } catch (e) {} },
  _internos,
};
})();
