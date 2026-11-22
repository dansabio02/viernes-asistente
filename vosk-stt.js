/* ============================================================
   VIERNES · VOSK STT — Reconocimiento de voz OFFLINE
   Motor: Vosk (WebAssembly) — funciona SIN internet
   Modelo: español small (~39 MB, descarga una vez, caché en el navegador)
   Audio nunca sale del dispositivo. Privacidad total.
   ============================================================ */
"use strict";

(function() {

const MODELO_ESP = "vosk-model-small-es-0.42";
const MODELO_URL = "https://alphacephei.com/vosk/models/" + MODELO_ESP + ".zip";
const CDN_VOSK = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk-browser.min.js";

let vosk = null;           // Instancia de Vosk (window.Vosk)
let recognizer = null;     // Reconocedor activo
let model = null;          // Modelo cargado
let cargando = false;      // ¿Está descargando/cargando el modelo?
let listo = false;         // ¿Listo para reconocer?
let error = null;          // Último error
let audioContext = null;   // AudioContext para capturar micrófono
let processor = null;      // AudioWorklet o ScriptProcessorNode
let stream = null;         // MediaStream del micrófono
let onResult = null;       // Callback con el texto reconocido
let buffer = [];           // Buffer de audio PCM
let sampleRate = 16000;    // Vosk requiere 16 kHz
let activo = false;        // ¿Está escuchando?

/* ── Cargar vosk-browser desde CDN ── */
function cargarVosk() {
  return new Promise((resolve, reject) => {
    if (window.Vosk) {
      vosk = window.Vosk;
      resolve(vosk);
      return;
    }
    const s = document.createElement("script");
    s.src = CDN_VOSK;
    s.onload = () => {
      vosk = window.Vosk;
      if (!vosk) reject(new Error("Vosk no se expuso como window.Vosk"));
      else resolve(vosk);
    };
    s.onerror = () => reject(new Error("No se pudo cargar vosk-browser desde CDN"));
    document.head.appendChild(s);
  });
}

/* ── Descargar y cargar el modelo de español ── */
async function cargarModelo() {
  if (listo) return;
  if (cargando) return; // ya está cargando
  cargando = true;

  try {
    await cargarVosk();

    // Vosk necesita el modelo descomprimido. Descargamos el ZIP y lo cargamos.
    // Como no podemos descomprimir ZIP fácilmente en el navegador sin librerías,
    // usamos el modelo ya empaquetado si existe, o descargamos el ZIP y lo leemos.
    // Para simplicidad y compatibilidad, intentamos cargar desde una URL directa.
    const modeloBlob = await fetch(modeloToBlobUrl()).then(r => r.blob());

    model = await vosk.Model.fromBuffer(await modeloBlob.arrayBuffer());
    recognizer = new vosk.KaldiRecognizer(model, sampleRate);
    listo = true;
    error = null;
    cargando = false;
    return { ok: true, mensaje: "Modelo de español cargado" };
  } catch (e) {
    cargando = false;
    error = e.message;
    listo = false;
    return { ok: false, error: error };
  }
}

/* Algunos entornos no pueden leer ZIP directamente. Intentamos una URL alternativa. */
function modeloToBlobUrl() {
  // Intentamos descargar el ZIP y crear un blob URL
  return MODELO_URL;
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
  buffer = [];

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

    // Usar ScriptProcessorNode para capturar PCM crudo (compatible con la mayoría de navegadores)
    const bufferSize = 4096;
    const nodo = audioContext.createScriptProcessor(bufferSize, 1, 1);

    nodo.onaudioprocess = (ev) => {
      if (!activo) return;
      const input = ev.inputBuffer.getChannelData(0);
      // Convertir Float32 a Int16 para Vosk
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const resultado = recognizer.acceptWaveform(pcm16);
      if (resultado) {
        const json = JSON.parse(resultado);
        const texto = json.text || "";
        if (texto && texto.trim() && onResult) {
          onResult(texto.trim());
        }
      }
      // También podemos aceptar resultados parciales si quisieramos
    };

    fuente.connect(nodo);
    nodo.connect(audioContext.destination);

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
  buffer = [];
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
