/* ============================================================
   VIERNES · Correo (Gmail API vía OAuth 2.0 + PKCE)
   Corre en el navegador (la Gmail API admite CORS). Sin client secret.
   Requiere un Client ID OAuth "Aplicación web" de Google Cloud Console.
   ============================================================ */
"use strict";

const GMAIL_CLIENT_KEY = "viernes_gmail_clientid";
const GMAIL_TOKEN_KEY = "viernes_gmail_tokens";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const CAL_API = "https://www.googleapis.com/calendar/v3";

/* ── utilidades base64 / PKCE ── */
function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function strToB64url(str) {
  return bytesToB64url(new TextEncoder().encode(str));
}
function b64urlToStr(s) {
  if (!s) return "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
  let bin;
  try { bin = atob(pad); } catch (e) { return ""; }
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { return bin; }
}
function randomB64url(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return bytesToB64url(arr);
}
async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToB64url(new Uint8Array(digest));
}

/* ── URI de redirección (derivada de la página actual) ── */
function getRedirectUri() {
  let p = location.pathname;
  if (/\/index\.html?$/i.test(p)) p = p.replace(/\/index\.html?$/i, "/");
  if (!p.endsWith("/")) p += "/";
  return location.origin + p;
}

/* ── almacenamiento ── */
function getClientId() { return localStorage.getItem(GMAIL_CLIENT_KEY) || ""; }
function setClientId(id) { localStorage.setItem(GMAIL_CLIENT_KEY, (id || "").trim()); }
function getTokens() { try { return JSON.parse(localStorage.getItem(GMAIL_TOKEN_KEY) || "null"); } catch (e) { return null; } }
function setTokens(t) { localStorage.setItem(GMAIL_TOKEN_KEY, JSON.stringify(t)); }
function clearTokens() { localStorage.removeItem(GMAIL_TOKEN_KEY); }

function isConnected() { const t = getTokens(); return !!(t && t.access_token); }
function getMe() { const t = getTokens(); return (t && t.me) || ""; }

/* ── flujo OAuth ── */
async function authorize() {
  const clientId = getClientId();
  if (!clientId) throw new Error("Falta el Client ID de Google. Configúrelo en Ajustes → Correo.");
  const verifier = randomB64url(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomB64url(16);
  sessionStorage.setItem("gmail_verifier", verifier);
  sessionStorage.setItem("gmail_state", state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state,
    access_type: "offline",
    prompt: "consent",
  });
  location.href = AUTH_ENDPOINT + "?" + params.toString();
}

// Se llama al cargar la página. Devuelve true si procesó un callback.
async function handleCallback() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code"), state = q.get("state"), error = q.get("error");
  if (error) { history.replaceState(null, "", location.pathname); throw new Error("Acceso denegado: " + error); }
  if (!code) return false;
  if (state !== sessionStorage.getItem("gmail_state")) {
    history.replaceState(null, "", location.pathname);
    throw new Error("Estado OAuth inválido. Intente de nuevo.");
  }
  const verifier = sessionStorage.getItem("gmail_verifier");
  sessionStorage.removeItem("gmail_state"); sessionStorage.removeItem("gmail_verifier");
  history.replaceState(null, "", location.pathname); // limpiar la URL
  const body = new URLSearchParams({
    code, client_id: getClientId(), redirect_uri: getRedirectUri(),
    code_verifier: verifier, grant_type: "authorization_code",
  });
  const r = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("Error al obtener token: " + (j.error_description || j.error || "HTTP " + r.status));
  const tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expiry: Date.now() + ((j.expires_in || 3600) * 1000),
  };
  setTokens(tokens);
  try { tokens.me = (await getProfile()).emailAddress; setTokens(tokens); } catch (e) {}
  return true;
}

async function getValidToken() {
  let t = getTokens();
  if (!t) throw new Error("No hay correo conectado. Conéctese en Ajustes → Correo.");
  if (t.access_token && Date.now() < (t.expiry || 0) - 30000) return t.access_token;
  if (!t.refresh_token) { clearTokens(); throw new Error("Sesión expirada. Vuelva a conectar el correo."); }
  const body = new URLSearchParams({
    client_id: getClientId(), grant_type: "refresh_token", refresh_token: t.refresh_token,
  });
  const r = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    if (j.error === "invalid_grant") clearTokens();
    throw new Error("No se pudo renovar la sesión. Reconecte el correo.");
  }
  t.access_token = j.access_token;
  t.expiry = Date.now() + ((j.expires_in || 3600) * 1000);
  if (j.refresh_token) t.refresh_token = j.refresh_token;
  setTokens(t);
  return t.access_token;
}

async function api(path, opts = {}) {
  const token = await getValidToken();
  const r = await fetch(API + path, {
    ...opts,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401) { clearTokens(); throw new Error("Sesión expirada. Reconecte el correo."); }
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("Gmail HTTP " + r.status + ": " + t.slice(0, 120)); }
  return r.json();
}

/* ── operaciones Gmail ── */
async function getProfile() { return api("/profile"); }
async function listUnread(max = 15) {
  const j = await api("/messages?maxResults=" + max + "&q=is:unread");
  return j.messages || [];
}

function getHeader(payload, name) {
  const hs = (payload && payload.headers) || [];
  const h = hs.find(x => (x.name || "").toLowerCase() === name.toLowerCase());
  return h ? h.value || "" : "";
}
function decodeRfc2047(h) {
  return (h || "")
    .replace(/=\?[^?]+\?[bB]\?([^?]*)\?=/g, (_, s) => b64urlToStr(s))
    .replace(/=\?[^?]+\?[qQ]\?([^?]*)\?=/g, (_, s) => decodeURIComponent(s.replace(/_/g, " ")));
}
function htmlToText(html) {
  const d = document.createElement("div"); d.innerHTML = html;
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}
function extractBody(payload) {
  if (!payload) return "";
  if (payload.body && payload.body.data) return b64urlToStr(payload.body.data);
  if (payload.parts) {
    const walk = (parts) => {
      for (const p of parts) {
        if (p.mimeType === "text/plain" && p.body && p.body.data) return b64urlToStr(p.body.data);
      }
      for (const p of parts) {
        if (p.mimeType === "text/html" && p.body && p.body.data) return htmlToText(b64urlToStr(p.body.data));
      }
      for (const p of parts) { if (p.parts) { const r = walk(p.parts); if (r) return r; } }
      return "";
    };
    return walk(payload.parts);
  }
  return payload.snippet || "";
}

async function getMessageMeta(id) {
  const j = await api("/messages/" + id + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date");
  const p = j.payload || {};
  return {
    id: j.id, threadId: j.threadId,
    from: decodeRfc2047(getHeader(p, "From")),
    subject: decodeRfc2047(getHeader(p, "Subject")),
    date: decodeRfc2047(getHeader(p, "Date")),
    snippet: j.snippet || "",
  };
}
async function getMessage(id) {
  const j = await api("/messages/" + id + "?format=full");
  const p = j.payload || {};
  return {
    id: j.id, threadId: j.threadId,
    from: decodeRfc2047(getHeader(p, "From")),
    to: decodeRfc2047(getHeader(p, "To")),
    subject: decodeRfc2047(getHeader(p, "Subject")),
    date: decodeRfc2047(getHeader(p, "Date")),
    snippet: j.snippet || "",
    body: extractBody(p),
  };
}

function buildRaw(to, subject, body) {
  let raw = "";
  raw += "To: " + to + "\r\n";
  raw += "Subject: " + subject + "\r\n";
  raw += "MIME-Version: 1.0\r\n";
  raw += "Content-Type: text/plain; charset=\"UTF-8\"\r\n";
  raw += "\r\n" + body;
  return strToB64url(raw);
}

async function sendMail(to, subject, body) {
  const raw = buildRaw(to, subject, body);
  return api("/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
}
async function createDraft(to, subject, body) {
  const raw = buildRaw(to, subject, body);
  return api("/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) });
}
async function markRead(id) {
  return api("/messages/" + id + "/modify", { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) });
}
async function disconnect() {
  const t = getTokens();
  if (t && t.access_token) {
    try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t.access_token)); } catch (e) {}
  }
  clearTokens();
}

/* ── CALENDARIO DE GOOGLE (misma sesión OAuth; pide permiso nuevo al usarse) ── */
async function apiCal(path, opts = {}) {
  const token = await getValidToken();
  const r = await fetch(CAL_API + path, {
    ...opts,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401) { clearTokens(); throw new Error("Sesión expirada. Reconecte el correo."); }
  if (r.status === 403 && (await r.text().catch(() => "")).includes("Calendar API has not been used")) {
    throw new Error("Habilite la Calendar API en su proyecto de Google Cloud.");
  }
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("Calendario HTTP " + r.status + ": " + t.slice(0, 120)); }
  return r.json();
}
// Eventos de un rango (ISO completo): [{id, titulo, inicio(Date), fin(Date), todoElDia}]
async function calendarioListar(desdeISO, hastaISO, max = 15) {
  const j = await apiCal("/calendars/primary/events?timeMin=" + encodeURIComponent(desdeISO) +
    "&timeMax=" + encodeURIComponent(hastaISO) + "&maxResults=" + max + "&singleEvents=true&orderBy=startTime");
  return (j.items || []).map((e) => ({
    id: e.id,
    titulo: e.summary || "(sin título)",
    inicio: e.start && e.start.dateTime ? new Date(e.start.dateTime) : (e.start && e.start.date ? new Date(e.start.date + "T00:00:00") : null),
    fin: e.end && e.end.dateTime ? new Date(e.end.dateTime) : null,
    todoElDia: !!(e.start && e.start.date && !e.start.dateTime),
  }));
}
async function calendarioCrear({ titulo, inicio, fin, descripcion, todoElDia }) {
  const ev = { summary: titulo, description: descripcion || "" };
  if (todoElDia) {
    ev.start = { date: inicio.toISOString().slice(0, 10) };
    ev.end = { date: fin ? fin.toISOString().slice(0, 10) : new Date(inicio.getTime() + 864e5).toISOString().slice(0, 10) };
  } else {
    ev.start = { dateTime: inicio.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    ev.end = { dateTime: (fin || new Date(inicio.getTime() + 36e5)).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  }
  const j = await apiCal("/calendars/primary/events", { method: "POST", body: JSON.stringify(ev) });
  return { id: j.id, htmlLink: j.htmlLink };
}

/* ── exponer ── */
window.ViernesMail = {
  getClientId, setClientId, getRedirectUri,
  isConnected, getMe,
  authorize, handleCallback, getValidToken,
  getProfile, listUnread, getMessageMeta, getMessage,
  sendMail, createDraft, markRead, disconnect,
  calendarioListar, calendarioCrear,
};
