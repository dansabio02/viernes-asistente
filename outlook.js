/* ============================================================
   VIERNES · Correo y Calendario de Outlook (Microsoft Graph v1.0)
   Corre en el navegador (Graph admite CORS). Sin client secret.
   OAuth 2.0: Authorization Code + PKCE, redirección SPA.
   Uso: registre una app en Microsoft Entra ID (Azure) → "Aplicaciones
   de usuario" tipo SPA, URI de redirección = esta página, y pegue el
   Client ID en Ajustes → Correo.
   Interfaz: idéntica a ViernesMail (listUnread, getMessageMeta,
   getMessage, sendMail, createDraft, markRead, calendarioListar,
   calendarioCrear…) para que la app pueda elegir proveedor.
   ============================================================ */
"use strict";
(() => {

const MS_CLIENT_KEY = "viernes_ms_clientid";
const MS_TOKEN_KEY = "viernes_ms_tokens";

const MS_SCOPES = "offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite";
const MS_AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

/* ── utilidades base64 / PKCE (duplicadas para que ambos módulos vivan solos) ── */
function msB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function msRandom(len) { const a = new Uint8Array(len); crypto.getRandomValues(a); return msB64url(a); }
async function msChallenge(verifier) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return msB64url(new Uint8Array(d));
}
/* ── URI de redirección (la misma página; debe estar registrada como "SPA") ── */
function msRedirectUri() {
  let p = location.pathname;
  if (/\/index\.html?$/i.test(p)) p = p.replace(/\/index\.html?$/i, "/");
  if (!p.endsWith("/")) p += "/";
  return location.origin + p;
}

/* ── almacenamiento ── */
function getClientId() { return localStorage.getItem(MS_CLIENT_KEY) || ""; }
function setClientId(id) { localStorage.setItem(MS_CLIENT_KEY, (id || "").trim()); }
function getTokens() { try { return JSON.parse(localStorage.getItem(MS_TOKEN_KEY) || "null"); } catch (e) { return null; } }
function setTokens(t) { localStorage.setItem(MS_TOKEN_KEY, JSON.stringify(t)); }
function clearTokens() { localStorage.removeItem(MS_TOKEN_KEY); }
function isConnected() { const t = getTokens(); return !!(t && t.access_token); }
function getMe() { const t = getTokens(); return (t && t.me) || ""; }

/* correo dentro de una dirección (recorta "Nombre Apellido <a@b.c>") */
function msSoloEmail(from) {
  const m = String(from || "").match(/<([^>]+)>/);
  if (m) return m[1].trim();
  const m2 = String(from || "").match(/[\w.+-]+@[\w.-]+/);
  return m2 ? m2[0] : String(from || "");
}
function msHtmlToText(html) {
  const d = document.createElement("div"); d.innerHTML = html || "";
  return (d.textContent || "").replace(/\s+/g, " ").trim();
}
function msFecha(str) {
  // "2026-11-07T20:15:00Z" → "7 nov, 2:15 p.m." legible
  try { return new Date(str).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
  catch (e) { return str || ""; }
}

/* ── flujo OAuth ── */
async function authorize() {
  const clientId = getClientId();
  if (!clientId) throw new Error("Falta el Client ID de Microsoft. Configúrelo en Ajustes → Correo.");
  const verifier = msRandom(64);
  const challenge = await msChallenge(verifier);
  const state = msRandom(16);
  sessionStorage.setItem("ms_verifier", verifier);
  sessionStorage.setItem("ms_state", state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: msRedirectUri(),
    // SPA exige fragment: el código llega después del # (query solo vale para apps Web)
    response_mode: "fragment",
    response_type: "code",
    scope: MS_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: state,
    prompt: "consent",
  });
  location.href = MS_AUTH + "?" + params.toString();
}

/* Se llama al cargar la página. Devuelve true si procesó un callback de Microsoft. */
async function handleCallback() {
  // el código puede venir en fragment (#) si la app es SPA o query (?) si es Web
  const paramsStr = (location.hash || "").replace(/^#/, "") + "&" + String(location.search || "").replace(/^\?/, "");
  const q = new URLSearchParams(paramsStr);
  const code = q.get("code"), state = q.get("state"), error = q.get("error");
  const esNuestro = sessionStorage.getItem("ms_state");
  if (!esNuestro && !code) return false; // no es callback de Outlook
  if (error) {
    const detalle = q.get("error_description") || "";
    sessionStorage.removeItem("ms_state"); sessionStorage.removeItem("ms_verifier");
    history.replaceState(null, "", location.pathname);
    // consejos concretos por código de error conocido
    const AYUDA = {
      AADSTS50194: "arregle el registro en Entra ID: su app VIERNES quedó como 'solo cuentas de esta organización'; cámbiela a 'Cuentas en cualquier directorio organizativo y cuentas Microsoft personales' (o re-registre con esa opción) y sigue con el mismo Client ID",
      AADSTS50011: "el URI de redirección no coincide: en Autenticación cree plataforma SPA con EXACTAMENTE " + msRedirectUri() + " (con barra final)",
      AADSTS9002326: "la plataforma quedó registrada como Web; cámbiela a 'Aplicación de una sola página (SPA)'",
      AADSTS7000218: "la plataforma quedó registrada como Web; cámbiela a 'Aplicación de una sola página (SPA)'",
    };
    const codigo = (detalle.match(/AADSTS\d+/) || [""])[0];
    throw new Error("Microsoft rechazó el acceso: " + error
      + (codigo ? " (" + codigo + ")" : "")
      + (AYUDA[codigo] ? " — " + AYUDA[codigo] : (detalle && !codigo ? " — " + detalle.slice(0, 160) : "")));
  }
  if (!code) return false;
  if (state !== esNuestro) {
    history.replaceState(null, "", location.pathname);
    throw new Error("Estado OAuth inválido. Intente de nuevo.");
  }
  const verifier = sessionStorage.getItem("ms_verifier");
  sessionStorage.removeItem("ms_state"); sessionStorage.removeItem("ms_verifier");
  history.replaceState(null, "", location.pathname);
  const body = new URLSearchParams({
    client_id: getClientId(), code, redirect_uri: msRedirectUri(),
    code_verifier: verifier, grant_type: "authorization_code",
  });
  const r = await fetch(MS_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error("Error al obtener token: " + (j.error_description || j.error || "HTTP " + r.status));
  const tokens = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expiry: Date.now() + ((j.expires_in || 3600) * 1000),
  };
  // el correo viene dentro del id_token (JWT; payload en el 2.º bloque)
  try {
    const payload = b64url2((j.id_token || "").split(".")[1] || "");
    const j2 = JSON.parse(payload || "{}");
    tokens.me = j2.preferred_username || j2.upn || j2.email || "";
  } catch (e) {}
  setTokens(tokens);
  if (!tokens.me) { try { const me = await api("/me?$select=userPrincipalName"); tokens.me = me.userPrincipalName || ""; setTokens(tokens); } catch (e) {} }
  return true;
}
function b64url2(s) {
  if (!s) return "";
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? b64 + "=".repeat(4 - (b64.length % 4)) : b64;
  let bin;
  try { bin = atob(pad); } catch (e) { return ""; }
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { return bin; }
}

async function getValidToken() {
  let t = getTokens();
  if (!t) throw new Error("No hay correo conectado. Conéctese en Ajustes → Correo.");
  if (t.access_token && Date.now() < (t.expiry || 0) - 30000) return t.access_token;
  if (!t.refresh_token) { clearTokens(); throw new Error("Sesión expirada. Vuelva a conectar el correo."); }
  const body = new URLSearchParams({
    client_id: getClientId(), grant_type: "refresh_token",
    refresh_token: t.refresh_token, scope: MS_SCOPES,
  });
  const r = await fetch(MS_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    if (j.error === "invalid_grant") clearTokens();
    throw new Error("No se pudo renovar la sesión de Outlook. Reconecte el correo.");
  }
  t.access_token = j.access_token;
  t.expiry = Date.now() + ((j.expires_in || 3600) * 1000);
  if (j.refresh_token) t.refresh_token = j.refresh_token;
  setTokens(t);
  return t.access_token;
}

async function api(path, opts = {}) {
  const token = await getValidToken();
  const r = await fetch(GRAPH + path, {
    ...opts,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401) { clearTokens(); throw new Error("Sesión expirada. Reconecte el correo."); }
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("Outlook HTTP " + r.status + ": " + t.slice(0, 120)); }
  if (r.status === 202 || r.status === 204) return {};
  return r.json();
}

/* ── CORREO: la MISMA forma de respuesta que Gmail ── */
async function listUnread(max = 15) {
  const j = await api("/me/mailFolders/Inbox/messages?$filter=" + encodeURIComponent("isRead eq false") +
    "&$top=" + max + "&$select=id&$orderby=" + encodeURIComponent("receivedDateTime desc"));
  return (j.value || []).map((m) => ({ id: m.id }));
}
async function getMessageMeta(id) {
  const j = await api("/me/messages/" + encodeURIComponent(id) + "?$select=id,subject,from,receivedDateTime,bodyPreview");
  return {
    id: j.id,
    from: (j.from && j.from.emailAddress && (j.from.emailAddress.name || j.from.emailAddress.address)) || "",
    subject: j.subject || "",
    date: msFecha(j.receivedDateTime),
    snippet: j.bodyPreview || "",
  };
}
async function getMessage(id) {
  const j = await api("/me/messages/" + encodeURIComponent(id) + "?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview");
  const cuerpo = j.body && (j.body.contentType === "html" ? msHtmlToText(j.body.content) : (j.body.content || ""));
  return {
    id: j.id,
    from: (j.from && j.from.emailAddress && (j.from.emailAddress.name || j.from.emailAddress.address)) || "",
    to: (j.toRecipients || []).map((x) => x.emailAddress && x.emailAddress.address).join(", "),
    subject: j.subject || "",
    date: msFecha(j.receivedDateTime),
    snippet: j.bodyPreview || "",
    body: cuerpo,
  };
}
function msDestinatarios(to) {
  // admite "a@b.c" o "Nombre <a@b.c>"
  return [{ emailAddress: { address: msSoloEmail(to) } }];
}
async function sendMail(to, subject, body) {
  const mensaje = {
    subject: subject || "(sin asunto)",
    body: { contentType: "Text", content: String(body || "") },
    toRecipients: msDestinatarios(to),
  };
  await api("/me/sendMail", { method: "POST", body: JSON.stringify({ message: mensaje, saveToSentItems: true }) });
  return { ok: true };
}
async function createDraft(to, subject, body) {
  const j = await api("/me/messages", { method: "POST", body: JSON.stringify({
    subject: subject || "(sin asunto)",
    body: { contentType: "Text", content: String(body || "") },
    toRecipients: msDestinatarios(to),
  }) });
  return { id: j.id };
}
async function markRead(id) {
  await api("/me/messages/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ isRead: true }) });
  return { ok: true };
}

/* ── CALENDARIO (La misma forma que el de Gmail: fechas ISO → objetos Date) ── */
async function calendarioListar(desdeISO, hastaISO, max = 15) {
  const j = await api("/me/calendarview?startDateTime=" + encodeURIComponent(desdeISO) +
    "&endDateTime=" + encodeURIComponent(hastaISO) + "&$top=" + max + "&$select=id,subject,start,end,isAllDay&$orderby=start/asc",
    { headers: { "Prefer": 'outlook.timezone="UTC"' } });
  const iso = (x) => (x && (x.dateTime ? x.dateTime + (x.timeZone === "UTC" ? "Z" : "") : x.date + "T00:00:00"));
  return (j.value || []).map((e) => {
    const ini = iso(e.start), fin = iso(e.end);
    return {
      id: e.id,
      titulo: e.subject || "(sin título)",
      inicio: ini ? new Date(ini) : null,
      fin: fin && (!e.isAllDay || fin.indexOf("T") >= 0) ? new Date(fin) : null,
      todoElDia: !!e.isAllDay,
    };
  });
}
async function calendarioCrear({ titulo, inicio, fin, descripcion, todoElDia }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ev = { subject: titulo, body: { contentType: "Text", content: descripcion || "" } };
  if (todoElDia) {
    const d = inicio.toISOString().slice(0, 10);
    ev.start = { dateTime: d, timeZone: tz };
    ev.end = { dateTime: fin ? fin.toISOString().slice(0, 10) : new Date(inicio.getTime() + 864e5).toISOString().slice(0, 10), timeZone: tz };
    ev.isAllDay = true;
  } else {
    ev.start = { dateTime: inicio.toISOString().replace(/\.\d+Z$/, ""), timeZone: "UTC" };
    ev.end = { dateTime: (fin || new Date(inicio.getTime() + 36e5)).toISOString().replace(/\.\d+Z$/, ""), timeZone: "UTC" };
  }
  const j = await api("/me/events", { method: "POST", body: JSON.stringify(ev) });
  return { id: j.id, htmlLink: j.webLink };
}

async function disconnect() {
  clearTokens(); // Microsoft no expone revocación directa para clientes públicos; basta tirar la sesión local
}

/* ── exponer (la función interna vive sola; window.ViernesOutlook es el único nombre público) ── */
window.ViernesOutlook = {
  getClientId, setClientId,
  getRedirectUri: msRedirectUri,
  isConnected, getMe,
  authorize, handleCallback, getValidToken,
  listUnread, getMessageMeta, getMessage,
  sendMail, createDraft, markRead, disconnect,
  calendarioListar, calendarioCrear,
};
})();
