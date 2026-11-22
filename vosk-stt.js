/* ============================================================
   VIERNES · VOSK STT — Reconocimiento de voz OFFLINE
   Motor: Vosk (WebAssembly) — funciona SIN internet
   Modelo: español small (~39 MB, descarga una vez, caché en el navegador)
   Audio nunca sale del dispositivo. Privacidad total.
   ============================================================ */
"use strict";

(function() {

const MODELO_URL = "https://viernes-proxy.danielnaula156.workers.dev/vosk-model";
const CDN_VOSK = "https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js";
const CDN_JSZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

let Vosk = null;
let JSZipLib = null;
let model = null;
let recognizer = null;
let cargando = false;
let listo = false;
let error = null;
let audioContext = null;
let processor = null;
let stream = null;
let onResult = null;
let activo = false;

/* ── Cargar librerías desde CDN ── */
function cargarVosk() {
  return new Promise((resolve, reject) => {
    if (window.Vosk) { Vosk = window.Vosk; resolve(); return; }
    const s = document.createElement("script");
    s.src = CDN_VOSK;
    s.onload = () => { Vosk = window.Vosk; resolve(); };
    s.onerror = () => reject(new Error("No se cargó vosk-browser"));
    document.head.appendChild(s);
  });
}

function cargarJSZip() {
  return new Promise((resolve, reject) => {
    if (window.JSZip) { JSZipLib = window.JSZip; resolve(); return; }
    const s = document.createElement("script");
    s.src = CDN_JSZIP;
    s.onload = () => { JSZipLib = window.JSZip; resolve(); };
    s.onerror = () => reject(new Error("No se cargó JSZip"));
    document.head.appendChild(s);
  });
}

/* ── Crear tar.gz desde archivos extraídos del zip ──
   Vosk-browser necesita .tar.gz. El modelo de Vosk viene como .zip,
   así que extraemos y re-empaquetamos como tar.gz en memoria. */
function crearCabeceraTar(nombre, tamano) {
  const buf = new Uint8Array(512);
  const nombBytes = new TextEncoder().encode(nombre);
  const nomLen = Math.min(nombBytes.length, 100);
  buf.set(nombBytes.slice(0, nomLen), 0);
  // Tipo de archivo: '0' = archivo normal
  buf[156] = 0x30; // '0'
  // Tamaño en octal (12 bytes)
  const tamOct = tamano.toString(8);
  for (let i = 0; i < tamOct.length; i++) buf[124 + 11 - i] = tamOct.charCodeAt(tamOct.length - 1 - i);
  // Checksum (8 bytes, calculado sobre los 512 bytes con espacios en el campo de checksum)
  let suma = 0;
  for (let i = 0; i < 512; i++) suma += buf[i];
  // Campo de checksum: 6 dígitos octales + null + space
  const chkOct = suma.toString(8);
  for (let i = 0; i < chkOct.length; i++) buf[148 + 6 - i] = chkOct.charCodeAt(chkOct.length - 1 - i);
  buf[154] = 0x20; // space
  buf[155] = 0x00; // null
  return buf;
}

async function crearTarGz(files) {
  const partes = [];
  for (const f of files) {
    const cab = crearCabeceraTar(f.name, f.data.byteLength);
    partes.push(cab);
    partes.push(f.data);
    // Rellenar hasta múltiplo de 512
    const rem = f.data.byteLength % 512;
    if (rem > 0) partes.push(new Uint8Array(512 - rem));
  }
  // Dos bloques de ceros al final
  partes.push(new Uint8Array(1024));
  const tarBytes = new Uint8Array(partes.reduce((s, p) => s + p.byteLength, 0));
  let off = 0;
  for (const p of partes) { tarBytes.set(p, off); off += p.byteLength; }

  // Comprimir con gzip usando CompressionStream (disponible en Workers y navegadores modernos)
  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(tarBytes);
  writer.close();
  const gzipped = await new Response(stream.readable).arrayBuffer();
  return gzipped;
}

/* ── Descargar, extraer y cargar el modelo ── */
async function cargarModelo() {
  if (listo) return { ok: true, mensaje: "Ya listo" };
  if (cargando) return { ok: false, error: "Ya se está cargando el modelo" };

  cargando = true;
  error = null;

  try {
    await cargarVosk();
    await cargarJSZip();

    // 1. Descargar el modelo .zip desde el proxy worker
    const zipRes = await fetch(MODELO_URL);
    if (!zipRes.ok) throw new Error("No se pudo descargar el modelo: " + zipRes.status);
    const zipBytes = await zipRes.arrayBuffer();

    // 2. Extraer con JSZip
    const zip = await JSZipLib.loadAsync(zipBytes);
    const files = [];
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue;
      files.push({ name, data: await zip.files[name].arrayBuffer() });
    }

    // 3. Crear .tar.gz en memoria
    const tarGz = await crearTarGz(files);

    // 4. Crear URL blob para pasar a Vosk.createModel()
    const blob = new Blob([tarGz], { type: "application/gzip" });
    const blobUrl = URL.createObjectURL(blob);

    // 5. Cargar modelo en Vosk
    model = await Vosk.createModel(blobUrl);
    if (!model.ready) throw new Error("El modelo no quedó listo");

    recognizer = model.KaldiRecognizer();

    recognizer.on("result", (message) => {
      if (!activo) return;
      const texto = (message.result && message.result.text) || "";
      if (texto && texto.trim() && onResult) {
        onResult(texto.trim());
      }
    });

    recognizer.on("partialresult", (message) => {
      // Resultados parciales opcionales
    });

    listo = true;
    cargando = false;
    // Liberar el blob URL después de cargar el modelo
    URL.revokeObjectURL(blobUrl);
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

    const bufferSize = 4096;
    processor = audioContext.createScriptProcessor(bufferSize, 1, 1);

    processor.onaudioprocess = (ev) => {
      if (!activo) return;
      const input = ev.inputBuffer.getChannelData(0);
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
    modelo: "vosk-model-small-es-0.42"
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
