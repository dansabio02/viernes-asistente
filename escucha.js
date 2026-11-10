/* ============================================================
   VIERNES · OÍDO FRONTAL (replica la escucha del Echo Dot en software)
   ------------------------------------------------------------
   Amazon usa micrófonos + beamforming + cancelación de eco +
   reducción de ruido + modelo de la palabra «Alexa». En el
   navegador no se puede meter audio procesado dentro del
   reconocedor de Google, pero SÍ se puede vigilar el sonido
   real de la habitación con SU PROPIA línea de audio y usar
   ese análisis para decidir si lo que dijo el reconocedor
   fue voz HUMANA frente al micrófono o solo ruido/TV/eco.

   Qué mide cada 35 ms (misma cadena conceptual del Echo):
     · SNR: nivel de voz sobre el piso de ruido del cuarto
       (piso ADAPTATIVO: se recalcula con los últimos 10 s
       y NO aprende del habla, solo del fondo).
     · Espectro de voz: energía en 200–3000 Hz contra el
       total; la música/TV suele quedarse en graves (<120 Hz)
       o en silbidos (>5 kHz), la voz humana no.
     · Variabilidad silábica: la voz humana silabea (las
       sílabas suben y bajan ~4 veces por segundo); un
       ventilador, el aire acondicionado o el tráfico son
       CONSTANTES → variabilidad baja.
     · Eco propio: mientras VIERNES habla por el altavoz,
       sus marcos se marcan y no cuentan como voz externa.
   Una voz se considera REAL si se sostiene ≥100 ms con todo
   lo de arriba; el app solo acepta comandos/activaciones si
   hubo voz así en los últimos ~2 s.
   Sintonía fina (localStorage "viernes_escucha_cfg"):
     { margenSnr, bandaMin, scoreMin } si algún día el cuarto
   es más ruidoso de lo normal.

   Interfaz: window.ViernesEscucha
     abrir()          → abre la línea de audio (promesa bool)
     cerrar()         → la cierra
     vozReciente(ms)  → ¿hubo voz humana sostenida ahí?
     escucharMudo(b)  → marcar eco propio (VIERNES está hablando)
     niveles()        → métricas para diagnóstico
   ============================================================ */
"use strict";
(() => {

const CFG_DEFAULT = { margenSnr: 6, bandaMin: 0.42, scoreMin: 0.55, marcoMs: 35, apagado: false };
let cfg = { ...CFG_DEFAULT };
try { Object.assign(cfg, JSON.parse(localStorage.getItem("viernes_escucha_cfg") || "{}")); } catch (e) {}

let stream = null, ctx = null, fuente = null, analizador = null;
let timer = null, abierta = false;
let abiertaDesde = 0; // para saber si lleva suficiente tiempo abierto como para juzgarlo
let vioVoz = false;   // sesión completa: ¿el oído LLEGÓ a detectar voz humana alguna vez?
let pisoDb = -85, ultimoPiso = 0;
let tdData = null, fqData = null, fqFrecuencia = 23.4; // Hz por bin (se fija al abrir)
let frames = [];   // {t, db, snr, band, vari, score, voz}
let tsVoz = [];    // timestamp de voz HUMANA sostenida (sin eco)
let mudo = false;  // VIERNES está hablando por el altavoz
let racha = 0;

const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (arr, p) => {
  if (!arr.length) return pisoDb;
  const ordenada = arr.slice().sort((a, b) => a - b);
  return ordenada[Math.min(ordenada.length - 1, Math.floor(ordenada.length * p))];
};

/* ── Apertura y cierre ── */
async function abrir() {
  if (abierta) return true;
  if (cfg.apagado) return false; // interruptor manual: {"apagado":true} en viernes_escucha_cfg
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },   // quita su propia voz del altavoz (AEC del Echo)
        noiseSuppression: { ideal: true },   // filtra ventiladores/ruido de fondo (NS del Echo)
        autoGainControl: { ideal: true },    // nivela la señal como el AGC del Echo
        channelCount: { ideal: 1 },
      },
    });
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") { try { await ctx.resume(); } catch (e) {} }
    fuente = ctx.createMediaStreamSource(stream);
    analizador = ctx.createAnalyser();
    analizador.fftSize = 2048;
    analizador.smoothingTimeConstant = 0.2;
    fuente.connect(analizador); // NUNCA al destino: solo escucha, no suena
    tdData = new Float32Array(analizador.fftSize);
    fqData = new Uint8Array(analizador.frequencyBinCount);
    fqFrecuencia = ctx.sampleRate / analizador.fftSize;
    abierta = true;
    abiertaDesde = Date.now();
    frames = []; tsVoz = []; racha = 0;
    clearInterval(timer);
    timer = setInterval(medir, cfg.marcoMs);
    return true;
  } catch (e) {
    abierta = false;
    return false;
  }
}
function cerrar() {
  clearInterval(timer); timer = null;
  if (stream) { stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} }); stream = null; }
  if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
  fuente = null; analizador = null;
  abierta = false; abiertaDesde = 0; frames = []; tsVoz = []; racha = 0;
}

/* ── Medición por marco ── */
function banda(fq, deHz, aHz) {
  const i0 = Math.max(0, Math.floor(deHz / fqFrecuencia));
  const i1 = Math.min(fq.length - 1, Math.ceil(aHz / fqFrecuencia));
  let e = 0;
  for (let i = i0; i <= i1; i++) e += (fq[i] / 255) * (fq[i] / 255);
  return e;
}
function medir() {
  if (!abierta || !analizador || document.hidden) return;
  const t = Date.now();
  analizador.getFloatTimeDomainData(tdData);
  let s = 0;
  for (let i = 0; i < tdData.length; i++) s += tdData[i] * tdData[i];
  const rms = Math.sqrt(s / tdData.length);
  const db = Math.max(-100, 20 * Math.log10(rms + 1e-9));

  analizador.getByteFrequencyData(fqData);
  const total = banda(fqData, 40, 8000) + 1e-9;
  const vozE = banda(fqData, 200, 3000);
  const grave = banda(fqData, 40, 120);
  const silbido = banda(fqData, 5000, 8000);
  const bandaVoz = vozE / total, ratioGrave = grave / total, ratioSilbido = silbido / total;

  frames.push({ t, db, mudo, voz: false });
  if (frames.length > 320) frames.splice(0, frames.length - 320);

  // Piso de ruido ADAPTATIVO: percentil 15 de los últimos 10 s,
  // recalculado cada 1.5 s y SIN usar la voz del momento.
  if (t - ultimoPiso > 1500) {
    const fondo = frames.filter((f) => t - f.t < 10000 && !f.voz);
    const dbs = fondo.map((f) => f.db);
    if (dbs.length > 40) pisoDb = pct(dbs, 0.15);
    ultimoPiso = t;
  }

  // Variabilidad silábica: desviación/nivel de los últimos 12 marcos (~420 ms)
  const ultimos = frames.slice(-12).map((f) => f.db);
  const media = ultimos.reduce((a, b) => a + b, 0) / ultimos.length;
  const varianza = ultimos.reduce((a, b) => a + (b - media) * (b - media), 0) / ultimos.length;
  const cv = Math.sqrt(varianza) / Math.max(2, media + 100);

  const snrDb = db - pisoDb;
  // Puntaje de voz humana 0..1 (ponderado, como un mini-modelo)
  const fSnr = limitar((snrDb - 3) / 11, 0, 1);
  const fBand = limitar((bandaVoz - 0.33) / 0.4, 0, 1);
  const fVari = limitar((cv - 0.12) / 0.28, 0, 1);
  const penalSilbido = limitar((ratioSilbido - 0.25) / 0.35, 0, 1);  // aire/hiss puro
  const penalGrave = limitar((ratioGrave - 0.42) / 0.3, 0, 1);       // música/TV en graves
  let score = 0.42 * fSnr + 0.24 * fBand + 0.26 * fVari - 0.12 * penalSilbido - 0.14 * penalGrave;
  score = limitar(score, 0, 1.2);
  const f = frames[frames.length - 1];
  f.snr = snrDb; f.band = bandaVoz; f.vari = cv; f.score = score;
  f.voz = score >= cfg.scoreMin && snrDb >= 2.5;
  if (mudo) f.voz = false; // su propia voz pasando por el altavoz no cuenta
  if (f.voz && !f.mudo) racha++; else racha = 0;
  if (racha >= 3) { // ~105 ms sostenidos: voz real, no un golpe ni un blip
    tsVoz.push(t);
    vioVoz = true;
    if (tsVoz.length > 12) tsVoz.splice(0, tsVoz.length - 12);
  }
}

/* ── Consultas para el app ── */
function vozReciente(ms) {
  if (!abierta) return false;
  const ventana = Number(ms) || 1800;
  const ahora = Date.now();
  const ultSost = tsVoz.length ? tsVoz[tsVoz.length - 1] : -Infinity;
  if (ahora - ultSost <= ventana) return true;
  // también basta suficiente masa de voz en la ventana
  const visibles = frames.filter((f) => ahora - f.t <= ventana);
  if (!visibles.length) return false;
  const conVoz = visibles.filter((f) => f.voz).length;
  return conVoz / visibles.length >= 0.45;
}
function niveles() {
  const now = Date.now();
  const visibles = frames.filter((f) => now - f.t <= 1200);
  const ultimo = visibles[visibles.length - 1];
  return {
    abierta: abierta,
    nivelDb: ultimo ? Math.round(ultimo.db * 10) / 10 : null,
    pisoDb: Math.round(pisoDb * 10) / 10,
    snrDb: ultimo && ultimo.snr != null ? Math.round(ultimo.snr * 10) / 10 : null,
    score: ultimo && ultimo.score != null ? Math.round(ultimo.score * 100) / 100 : null,
    mudo: mudo,
    voz: vozReciente(1800),
  };
}
function escucharMudo(v) { mudo = !!v; if (v) racha = 0; }
/* ¿el oído llegó a detectar voz humana en TODA la sesión? y ¿cuánto lleva abierto? */
function algoVio() { return vioVoz; }
function abiertaHace() { return abierta ? Math.floor((Date.now() - abiertaDesde) / 1000) : -1; }

window.ViernesEscucha = {
  get abierta() { return abierta; },
  abrir, cerrar, vozReciente, niveles, escucharMudo, algoVio, abiertaHace,
};
})();
