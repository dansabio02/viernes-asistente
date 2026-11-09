/* ============================================================
   VIERNES · MEMORIA (base de datos de recordatorios, notas,
   mensajes y aprendizajes)
   Dos niveles:
     · LOCAL: IndexedDB en el navegador — funciona sin internet,
       es inmediato y respeta el teléfono del jefe.
     · NUBE: la misma memoria en su Cloudflare (worker + D1/KV),
       para que VIERNES la use desde cualquier dispositivo y del
       atajo remoto. Si la nube no responde, queda en cola local
       y se sincroniza solo.
   Interfaz: window.ViernesMemoria
     configurar(buildUrl)   ← app.js entrega el constructor de URL+PIN
     almacenar(tipo, texto, meta) → {id, t}
     buscar(q, {tipos, limit}) → items[]
     ultimos({tipos, limit})   → items[]
     borrar(id), vaciar(), cuentas(), estado()
   ============================================================ */
"use strict";
(() => {

const DB_NAME = "viernes";
const STORE = "memoria";
let db = null;          // IndexedDB connection
let construirURL = null; // (ruta+query) → URL completa con PIN (lo pone app.js)
let ultimaNube = null;   // "ok" | "sin-nube" | Date del último éxito

/* ── LOCAL: IndexedDB ── */
function abrirDB() {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open(DB_NAME, 2);
      rq.onupgradeneeded = (e) => {
        const bd = e.target.result;
        if (!bd.objectStoreNames.contains(STORE)) {
          const st = bd.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("t", "t");
          st.createIndex("tipo", "tipo");
        } else {
          const st = e.target.transaction.objectStore(STORE);
          if (!st.indexNames.contains("t")) st.createIndex("t", "t");
          if (!st.indexNames.contains("tipo")) st.createIndex("tipo", "tipo");
        }
      };
      rq.onsuccess = (e) => { db = e.target.result; res(true); };
      rq.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function putLocal(item) {
  return new Promise((res) => {
    if (!db) return res(false);
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function todosLocal() {
  return new Promise((res) => {
    if (!db) return res([]);
    try {
      const rq = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => res([]);
    } catch (e) { res([]); }
  });
}
function borrarLocal(id) {
  return new Promise((res) => {
    if (!db) return res(false);
    try {
      const rq = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
      rq.onsuccess = () => res(true); rq.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}
function vaciarLocal() {
  return new Promise((res) => {
    if (!db) return res(false);
    try {
      const rq = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
      rq.onsuccess = () => res(true); rq.onerror = () => res(false);
    } catch (e) { res(false); }
  });
}

/* ── NUBE: espejo en el worker (D1/KV). Sin bloquear nada. ── */
const COLA_KEY = "viernes_mem_cola";
function cola() { try { return JSON.parse(localStorage.getItem(COLA_KEY) || "[]"); } catch (e) { return []; } }
function guardarCola(c) { try { localStorage.setItem(COLA_KEY, JSON.stringify(c.slice(-200))); } catch (e) {} }

async function aNube(ruta, metodo, cuerpo) {
  if (!construirURL) throw new Error("Memoria sin canal");
  const r = await fetch(construirURL("/mem" + ruta), {
    method: metodo || "GET",
    headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error("nube " + r.status);
  return r.json();
}

/* ── API ── */
const V = {
  get conexionNube() { return ultimaNube; },
  inicializar: abrirDB,

  configurar(fn) { construirURL = fn; if (fn) V.sincronizar(); },

  /** Guarda una memoria (nota, recordatorio, mensaje, aprendizaje…). Nunca lanza. */
  async almacenar(tipo, texto, meta) {
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      t: Date.now(),
      tipo: String(tipo || "nota"),
      texto: String(texto || "").slice(0, 600),
      meta: meta || null,
    };
    await putLocal(item);
    // nube en segundo plano; si falla, a la cola
    aNube("", "POST", item)
      .then(() => { ultimaNube = Date.now(); })
      .catch(() => { const c = cola(); c.push(item); guardarCola(c); ultimaNube = "sin-nube"; });
    return item;
  },

  /** Busca por palabras (todas deben aparecer) en local + nube, sin duplicar. */
  async buscar(q, opciones = {}) {
    const palabras = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9áéíóúñü]+/).filter((p) => p.length > 2);
    const tiposs = opciones.tipos || null;
    const limite = opciones.limit || 10;
    const encontradas = new Map();
    const pasa = (it) => {
      if (tiposs && !tiposs.includes(it.tipo)) return false;
      if (!palabras.length) return true;
      const bajo = String(it.texto).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return palabras.every((p) => bajo.includes(p));
    };
    // local primero (instantáneo)
    try {
      for (const it of (await todosLocal()).filter(pasa)) encontradas.set(it.id, it);
    } catch (e) {}
    // nube después (contiene lo escrito desde otros dispositivos)
    try {
      const j = await aNube("/buscar?limit=" + limite, "POST", { q: palabras.join(" "), tipos: tiposs });
      if (j && Array.isArray(j.items)) { ultimaNube = Date.now(); for (const it of j.items) if (pasa(it)) encontradas.set(it.id, it); }
    } catch (e) { ultimaNube = "sin-nube"; }
    // cola local no subida (si la nube aún no la recibe)
    for (const it of cola()) if (pasa(it)) encontradas.set(it.id, it);
    return [...encontradas.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, limite);
  },

  /** últimOs guardados por fecha. */
  async ultimos(opciones = {}) {
    const tiposs = opciones.tipos || null;
    const limite = opciones.limit || 8;
    const encontradas = new Map();
    try {
      let loc = (await todosLocal()).filter((it) => !tiposs || tiposs.includes(it.tipo));
      loc.sort((a, b) => (b.t || 0) - (a.t || 0));
      for (const it of loc.slice(0, limite)) encontradas.set(it.id, it);
    } catch (e) {}
    try {
      const q2 = "/?limit=" + limite + (tiposs ? "&tipos=" + encodeURIComponent(tiposs.join(",")) : "");
      const j = await aNube(q2, "GET");
      if (j && Array.isArray(j.items)) { ultimaNube = Date.now(); for (const it of j.items) if (!tiposs || tiposs.includes(it.tipo)) encontradas.set(it.id, it); }
    } catch (e) { ultimaNube = "sin-nube"; }
    return [...encontradas.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, limite);
  },

  async borrar(id) {
    const okLocal = await borrarLocal(id);
    guardarCola(cola().filter((it) => it.id !== id));
    try { await aNube("?id=" + encodeURIComponent(id), "DELETE"); } catch (e) {}
    return okLocal;
  },

  async vaciar() {
    await vaciarLocal();
    guardarCola([]);
    try { await aNube("/vaciar", "POST", { confirmar: "si" }); } catch (e) {}
    return true;
  },

  async cuentas() {
    const loc = await todosLocal();
    const porTipo = {};
    for (const it of loc) porTipo[it.tipo] = (porTipo[it.tipo] || 0) + 1;
    return { total: loc.length, tipos: porTipo };
  },

  /** Sube a la nube lo que quedó en cola local (offline). */
  async sincronizar() {
    const pend = cola();
    if (!pend.length) { return 0; }
    const restantes = [];
    let subidas = 0;
    for (const it of pend) {
      try { await aNube("", "POST", it); subidas++; }
      catch (e) { restantes.push(it); }
    }
    guardarCola(restantes);
    if (subidas) { ultimaNube = Date.now(); }
    else if (pend.length) { ultimaNube = "sin-nube"; }
    return subidas;
  },
};

window.ViernesMemoria = V;
})();
