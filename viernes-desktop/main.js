"use strict";

const { app, BrowserWindow, ipcMain, dialog, notification, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { exec, execSync, spawn } = require("child_process");
const robot = require("robotjs");

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE SEGURIDAD
// ═════════════════════════════════════════════════════════════════════════════

// Comandos bloqueados (nunca se ejecutan, sin confirmación)
const COMANDOS_BLOQUEADOS = [
  /format/i, /del\s/i, /rmdir/i, /rd\s/i, /shutdown/i, /restart/i,
  /reg\s+delete/i, /net\s+user/i, /net\s+localgroup/i, /bcdedit/i,
  /diskpart/i, /fsutil/i, /takeown/i, /icacls/i
];

// Rutas sensibles que requieren confirmación explícita
const RUTAS_SENSIBLES = [
  "C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)",
  "C:\\Users\\Public", "C:\\$Recycle.Bin", "C:\\System Volume Information"
];

let mainWindow = null;
let ventanaConfirmacion = null;

// ═════════════════════════════════════════════════════════════════════════════
// VENTANA PRINCIPAL
// ═════════════════════════════════════════════════════════════════════════════

function crearVentanaPrincipal() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false
    },
    icon: path.join(__dirname, "..", "icon.svg"),
    show: false,
    autoHideMenuBar: true,
    title: "VIERNES - Asistente Personal"
  });

  // Cargar la app web local (index.html del proyecto principal)
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  crearVentanaPrincipal();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentanaPrincipal();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ═════════════════════════════════════════════════════════════════════════════
// UTILIDADES DE SEGURIDAD
// ═════════════════════════════════════════════════════════════════════════════

function comandoEstaBloqueado(comando) {
  return COMANDOS_BLOQUEADOS.some((patron) => patron.test(comando));
}

function rutaEsSensible(ruta) {
  return RUTAS_SENSIBLES.some((r) => ruta.toUpperCase().startsWith(r.toUpperCase()));
}

function esRutaSegura(ruta) {
  if (!ruta || typeof ruta !== "string") return false;
  const normalizada = path.normalize(ruta);
  // No permitir rutas absolutas fuera del usuario sin confirmación
  if (path.isAbsolute(normalizada) && rutaEsSensible(normalizada)) return false;
  return true;
}

// ═════════════════════════════════════════════════════════════════════════════
// IPC - HABILIDADES DE PC
// ═════════════════════════════════════════════════════════════════════════════

// ── 1. ABRIR PROGRAMA ──
ipcMain.handle("viernes:abrir-programa", async (event, nombrePrograma) => {
  if (!nombrePrograma || typeof nombrePrograma !== "string") {
    return { exito: false, error: "Nombre de programa inválido" };
  }

  // Verificar si el programa está en la lista de bloqueados
  if (comandoEstaBloqueado(nombrePrograma)) {
    return { exito: false, error: "Este programa está bloqueado por seguridad" };
  }

  try {
    // Intentar abrir con shell.openPath (método nativo de Windows)
    await shell.openPath(nombrePrograma);
    return { exito: true, mensaje: `Programa "${nombrePrograma}" abierto` };
  } catch (e) {
    // Si falla, intentar con comando start de Windows
    try {
      await new Promise((resolve, reject) => {
        exec(`start "" "${nombrePrograma}"`, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return { exito: true, mensaje: `Programa "${nombrePrograma}" abierto` };
    } catch (e2) {
      return { exito: false, error: `No se pudo abrir "${nombrePrograma}": ${e2.message}` };
    }
  }
});

// ── 2. EJECUTAR COMANDO ──
ipcMain.handle("viernes:ejecutar-comando", async (event, comando) => {
  if (!comando || typeof comando !== "string") {
    return { exito: false, error: "Comando inválido" };
  }

  if (comandoEstaBloqueado(comando)) {
    return { exito: false, error: "Este comando está bloqueado por seguridad del sistema" };
  }

  try {
    const resultado = await new Promise((resolve, reject) => {
      exec(comando, { timeout: 30000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
        if (error) {
          resolve({ exito: false, error: error.message, salida: stderr || "" });
        } else {
          resolve({ exito: true, salida: stdout || "", errores: stderr || "" });
        }
      });
    });
    return resultado;
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 3. LEER ARCHIVO ──
ipcMain.handle("viernes:leer-archivo", async (event, rutaArchivo) => {
  if (!rutaArchivo || typeof rutaArchivo !== "string") {
    return { exito: false, error: "Ruta de archivo inválida" };
  }

  try {
    if (!fs.existsSync(rutaArchivo)) {
      return { exito: false, error: "El archivo no existe" };
    }

    const stats = fs.statSync(rutaArchivo);
    if (stats.size > 5 * 1024 * 1024) {
      return { exito: false, error: "Archivo demasiado grande (máximo 5 MB)" };
    }

    const contenido = fs.readFileSync(rutaArchivo, "utf8");
    return { exito: true, contenido, nombre: path.basename(rutaArchivo), tamaño: stats.size };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 4. ESCRIBIR ARCHIVO ──
ipcMain.handle("viernes:escribir-archivo", async (event, rutaArchivo, contenido) => {
  if (!rutaArchivo || typeof rutaArchivo !== "string") {
    return { exito: false, error: "Ruta de archivo inválida" };
  }

  if (rutaEsSensible(rutaArchivo)) {
    return { exito: false, error: "No se puede escribir en rutas del sistema por seguridad" };
  }

  try {
    const dir = path.dirname(rutaArchivo);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(rutaArchivo, contenido, "utf8");
    return { exito: true, mensaje: `Archivo "${path.basename(rutaArchivo)}" guardado` };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 5. LISTAR CARPETA ──
ipcMain.handle("viernes:listar-carpeta", async (event, rutaCarpeta) => {
  if (!rutaCarpeta || typeof rutaCarpeta !== "string") {
    return { exito: false, error: "Ruta de carpeta inválida" };
  }

  try {
    if (!fs.existsSync(rutaCarpeta)) {
      return { exito: false, error: "La carpeta no existe" };
    }

    const entradas = fs.readdirSync(rutaCarpeta, { withFileTypes: true });
    const items = entradas.map((entrada) => ({
      nombre: entrada.name,
      esCarpeta: entrada.isDirectory(),
      ruta: path.join(rutaCarpeta, entrada.name)
    }));

    return { exito: true, items, ruta: rutaCarpeta };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 6. CREAR CARPETA ──
ipcMain.handle("viernes:crear-carpeta", async (event, rutaCarpeta) => {
  if (!rutaCarpeta || typeof rutaCarpeta !== "string") {
    return { exito: false, error: "Ruta de carpeta inválida" };
  }

  if (rutaEsSensible(rutaCarpeta)) {
    return { exito: false, error: "No se puede crear carpetas en rutas del sistema" };
  }

  try {
    fs.mkdirSync(rutaCarpeta, { recursive: true });
    return { exito: true, mensaje: `Carpeta "${path.basename(rutaCarpeta)}" creada` };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 7. NOTIFICACIÓN WINDOWS ──
ipcMain.handle("viernes:notificar", async (event, titulo, cuerpo) => {
  try {
    const noti = new Notification({
      title: titulo || "VIERNES",
      body: cuerpo || "",
      icon: path.join(__dirname, "..", "icon.png")
    });
    noti.show();
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 8. INFORMACIÓN DEL SISTEMA ──
ipcMain.handle("viernes:info-sistema", async () => {
  try {
    const platform = process.platform;
    const arch = process.arch;
    const nodeVersion = process.version;
    const electronVersion = process.versions.electron;

    // Obtener nombre de usuario
    let usuario = "usuario";
    try { usuario = execSync("whoami", { encoding: "utf8" }).trim(); } catch (e) {}

    // Obtener nombre de la computadora
    let computadora = "PC";
    try { computadora = execSync("hostname", { encoding: "utf8" }).trim(); } catch (e) {}

    return {
      exito: true,
      plataforma: platform,
      arquitectura: arch,
      usuario,
      computadora,
      versionNode: nodeVersion,
      versionElectron: electronVersion
    };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 9. CONTROL DE MOUSE Y TECLADO (robotjs) ──
ipcMain.handle("viernes:mover-mouse", async (event, x, y) => {
  try {
    robot.moveMouse(parseInt(x), parseInt(y));
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

ipcMain.handle("viernes:clic-raton", async (event, boton = "izquierdo") => {
  try {
    robot.mouseClick(boton === "derecho" ? "right" : "left");
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

ipcMain.handle("viernes:escribir-texto", async (event, texto) => {
  try {
    robot.typeString(texto);
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

ipcMain.handle("viernes:presionar-tecla", async (event, tecla) => {
  try {
    robot.keyTap(tecla);
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 10. OBTENER POSICIÓN DEL MOUSE ──
ipcMain.handle("viernes:posicion-mouse", async () => {
  try {
    const pos = robot.getMousePos();
    return { exito: true, x: pos.x, y: pos.y };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 11. LISTAR VENTANAS ABIERTAS ──
ipcMain.handle("viernes:listar-ventanas", async () => {
  try {
    const ventanas = robot.getAllWindows();
    const lista = ventanas.map((w) => ({
      titulo: w.title || "(sin titulo)",
      x: w.bounds.x,
      y: w.bounds.y,
      ancho: w.bounds.width,
      alto: w.bounds.height
    }));
    return { exito: true, ventanas: lista };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 12. ACTIVAR/ENFOCAR VENTANA ──
ipcMain.handle("viernes:activar-ventana", async (event, tituloVentana) => {
  if (!tituloVentana || typeof tituloVentana !== "string") {
    return { exito: false, error: "Titulo de ventana invalido" };
  }
  try {
    const ventanas = robot.getAllWindows();
    const ventana = ventanas.find((w) => w.title && w.title.toLowerCase().includes(tituloVentana.toLowerCase()));
    if (!ventana) {
      return { exito: false, error: "No se encontro ninguna ventana con el titulo: " + tituloVentana };
    }
    // robotjs no tiene focus directo, usamos moveMouse + click para dar foco
    const centroX = ventana.bounds.x + Math.floor(ventana.bounds.width / 2);
    const centroY = ventana.bounds.y + Math.floor(ventana.bounds.height / 2);
    robot.moveMouse(centroX, centroY);
    robot.mouseClick();
    return { exito: true, mensaje: "Ventana activada: " + ventana.title };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 13. TECLA COMBINADA (Ctrl+C, Ctrl+V, Alt+Tab, etc.) ──
ipcMain.handle("viernes:tecla-combinada", async (event, modificador, tecla) => {
  if (!modificador || !tecla) {
    return { exito: false, error: "Modificador y tecla son requeridos" };
  }
  try {
    const mods = modificador.toLowerCase();
    let keyDown;
    if (mods.includes("ctrl")) keyDown = "control";
    else if (mods.includes("alt")) keyDown = "alt";
    else if (mods.includes("shift")) keyDown = "shift";
    else keyDown = modificador;

    robot.keyToggle(keyDown, "down");
    robot.keyTap(tecla);
    robot.keyToggle(keyDown, "up");
    return { exito: true, mensaje: "Combinacion enviada: " + modificador + "+" + tecla };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 14. OBTENER CONTENIDO DEL PORTAPAPELES ──
ipcMain.handle("viernes:obtener-portapapeles", async () => {
  try {
    const { execSync } = require("child_process");
    const resultado = execSync('powershell -Command "Get-Clipboard"', { encoding: "utf8", timeout: 5000 });
    return { exito: true, contenido: resultado.toString().trim() };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 15. ESTABLECER CONTENIDO DEL PORTAPAPELES ──
ipcMain.handle("viernes:establecer-portapapeles", async (event, texto) => {
  if (!texto || typeof texto !== "string") {
    return { exito: false, error: "Texto invalido para portapapeles" };
  }
  try {
    const { execSync } = require("child_process");
    const textoEscapado = texto.replace(/'/g, "''");
    execSync(`powershell -Command "Set-Clipboard -Value '${textoEscapado}'"`, { encoding: "utf8", timeout: 5000 });
    return { exito: true, mensaje: "Portapapeles actualizado" };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});

// ── 16. OBTENER VENTANA ACTIVA ──
ipcMain.handle("viernes:ventana-activa", async () => {
  try {
    const ventanaActiva = robot.getActiveWindow();
    if (!ventanaActiva) {
      return { exito: false, error: "No hay ventana activa" };
    }
    return {
      exito: true,
      titulo: ventanaActiva.title || "(sin titulo)",
      x: ventanaActiva.bounds.x,
      y: ventanaActiva.bounds.y,
      ancho: ventanaActiva.bounds.width,
      alto: ventanaActiva.bounds.height
    };
  } catch (e) {
    return { exito: false, error: e.message };
  }
});
