/* ============================================================
   VIERNES · VOSK STT — Reconocimiento de voz OFFLINE
   Motor: Vosk (WebAssembly) — funciona SIN internet
   Modelo: español small (~39 MB, descarga una vez, caché en el navegador)
   Audio nunca sale del dispositivo. Privacidad total.
   ============================================================ */
"use strict";

(function() {

const MODELO_ESP = "vosk-model-small-es-0.42";
const MODELO_URL = "https://alphacephei.com/vosk/models/" + MODELO_ESP + ".tar.gz";
const CDN_VOSK = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js";

let Vosk = null;           // Clase Vosk global
let model = null;          // Modelo cargado
let recognizer = null;     // Reconocedor activo
let cargando = false;      // ¿Está descargando/cargando el modelo?
let listo = false;         // ¿Listo para reconocer?
let error = null;          // Último error
let audioContext = null;   // AudioContext para capturar micrófono
let processor = null;      // ScriptProcessorNode
let stream = null;         // MediaStream del micrófono
let onResult = null;       // Callback con el texto reconocido
let activo = false;        // ¿Está escuchando?

/* ── Cargar vosk-browser desde CDN ── */
function cargarVosk() {
  return new Promise((resolve, reject) => {
    if (window.Vosk) {
      Vosk = window.Vosk;
      resolve(Vosk);
      return;
    }
    const s = document.createElement("script");
    s.src = CDN_VOSK;
    s.onload = () => {
      Vosk = window.Vosk;
      if (!Vosk) reject(new Error("Vosk no se expuso como window.Vosk"));
      else resolve(Vosk);
    };
    s.onerror = () => reject(new Error("No se pudo cargar vosk-browser desde CDN"));
    document.head.appendChild(s);
  });
}

/* ── Descargar y cargar el modelo de español ── */
async function cargarModelo() {
  if (listo) return { ok: true, mensaje: "Ya listo" };
  if (cargando) return { ok: false, error: "Ya se está cargando el modelo" };

  cargando = true;
  error = null;

  try {
    await cargarVosk();

    // Vosk-browser carga el modelo desde una URL .tar.gz
    // Usamos Vosk.createModel que maneja la carga asíncrona y el Web Worker
    model = await Vosk.createModel(MODELO_URL);

    if (!model.ready) {
      throw new Error("El modelo no está listo después de cargar");
    }

    recognizer = model.KaldiRecognizer();

    // Configurar eventos de resultado
    recognizer.on("result", (message) => {
      if (!activo) return;
      const texto = (message.result && message.result.text) || "";
      if (texto && texto.trim() && onResult) {
        onResult(texto.trim());
      }
    });

    recognizer.on("partialresult", (message) => {
      // Resultados parciales opcionales - no los usamos para evitar ruido
    });

    listo = true;
    cargando = false;
    return { ok: true, mensaje: "Modelo de español cargado (Vosk offline)" };
  } catch (e) {
    cargando = false;
    error = e.message;
    listo = false;
    model = null;
    recognizer = null;
    return { ok: false, error: error };
  }
}

/* ── Iniciar reconocimiento ── */
async function iniciar(callback) {
  if (!listo) {
    const r = await cargarModelo();
    if (!r.ok) return r;
  }
  if (activo) return { ok: true, mensaje: "Ya está escuchando" };

  onResult = callback;
  activo = true;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const fuente = audioContext.createMediaStreamSource(stream);

    // ScriptProcessorNode para capturar PCM crudo
    const bufferSize = 4096;
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (ev) => {
      if (!activo) return;
      const input = ev.inputBuffer.getChannelData(0);
      // Vosk-browser acepta AudioBuffer directamente
      recognizer.acceptWaveform(input);
    };

    fuente.connect(processor);
    processor.connect(audioContext.destination);

    return { ok: true, mensaje: "Vosk escuchando (offline)" };
  } catch (e) {
    activo = false;
    error = e.message;
    return { ok: false, error: error };
  }
}

/* ── Detener reconocimiento ── */
function detener() {
  activo = false;
  try { if (processor) processor.disconnect(); } catch (e) {}
  try { if (audioContext) audioContext.close(); } catch (e) {}
  try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  processor = null;
  audioContext = null;
  stream = null;
  return { ok: true, mensaje: "Vosk detenido" };
}

/* ── Estado ── */
function estado() {
  return {
    listo: listo,
    activo: activo,
    cargando: cargando,
    error: error,
    motor: "vosk-offline",
    modelo: MODELO_ESP
  };
}

/* ── Exponer API ── */
window.VoskSTT = {
  iniciar,
  detener,
  estado,
  cargarModelo,
  get listo() { return listo; },
  get activo() { return activo; },
  get error() { return error; }
};

})();
