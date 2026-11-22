"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// ═════════════════════════════════════════════════════════════════════════════
// PUENTE SEGURO - API expuesta a window.ViernesPC
// ═════════════════════════════════════════════════════════════════════════════

contextBridge.exposeInMainWorld("ViernesPC", {
  // ── Abrir programa ──
  abrirPrograma: (nombre) => ipcRenderer.invoke("viernes:abrir-programa", nombre),

  // ── Ejecutar comando ──
  ejecutarComando: (comando) => ipcRenderer.invoke("viernes:ejecutar-comando", comando),

  // ── Archivos ──
  leerArchivo: (ruta) => ipcRenderer.invoke("viernes:leer-archivo", ruta),
  escribirArchivo: (ruta, contenido) => ipcRenderer.invoke("viernes:escribir-archivo", ruta, contenido),
  listarCarpeta: (ruta) => ipcRenderer.invoke("viernes:listar-carpeta", ruta),
  crearCarpeta: (ruta) => ipcRenderer.invoke("viernes:crear-carpeta", ruta),

  // ── Notificaciones ──
  notificar: (titulo, cuerpo) => ipcRenderer.invoke("viernes:notificar", titulo, cuerpo),

  // ── Sistema ──
  infoSistema: () => ipcRenderer.invoke("viernes:info-sistema"),

  // ── Control de entrada ──
  moverMouse: (x, y) => ipcRenderer.invoke("viernes:mover-mouse", x, y),
  clicRaton: (boton) => ipcRenderer.invoke("viernes:clic-raton", boton),
  escribirTexto: (texto) => ipcRenderer.invoke("viernes:escribir-texto", texto),
  presionarTecla: (tecla) => ipcRenderer.invoke("viernes:presionar-tecla", tecla),
  teclaCombinada: (modificador, tecla) => ipcRenderer.invoke("viernes:tecla-combinada", modificador, tecla),
  posicionMouse: () => ipcRenderer.invoke("viernes:posicion-mouse"),

  // ── Ventanas ──
  listarVentanas: () => ipcRenderer.invoke("viernes:listar-ventanas"),
  activarVentana: (titulo) => ipcRenderer.invoke("viernes:activar-ventana", titulo),
  ventanaActiva: () => ipcRenderer.invoke("viernes:ventana-activa"),

  // ── Portapapeles ──
  obtenerPortapapeles: () => ipcRenderer.invoke("viernes:obtener-portapapeles"),
  establecerPortapapeles: (texto) => ipcRenderer.invoke("viernes:establecer-portapapeles", texto),

  // ── Escuchar confirmaciones del usuario ──
  onConfirmarAccion: (callback) => {
    const listener = (event, accion, detalles) => callback(accion, detalles);
    ipcRenderer.on("viernes:confirmar-accion", listener);
    return () => ipcRenderer.removeListener("viernes:confirmar-accion", listener);
  },

  // ── Responder a confirmación ──
  responderConfirmacion: (accionId, aceptado) => {
    ipcRenderer.send("viernes:responder-confirmacion", accionId, aceptado);
  }
});

// Exponer también para compatibilidad con el código existente
window.ViernesPC = window.ViernesPC || {};
