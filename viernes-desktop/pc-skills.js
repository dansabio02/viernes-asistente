"use strict";

/* ============================================================
   VIERNES DESKTOP · HABILIDADES DE PC
   Conecta el cerebro de Viernes con la automatización de Windows.
   Todas las acciones peligrosas requieren confirmación del usuario.
   ============================================================ */

const PC_SKILLS = {
  nombre: "Automatización de PC",
  version: "1.1.0",
  habilidades: [
    "abrir_programa", "ejecutar_comando", "leer_archivo",
    "escribir_archivo", "listar_carpeta", "crear_carpeta",
    "mover_mouse", "clic_raton", "escribir_texto", "presionar_tecla",
    "tecla_combinada", "listar_ventanas", "activar_ventana", "ventana_activa",
    "obtener_portapapeles", "establecer_portapapeles",
    "notificar", "info_sistema"
  ]
};

/* ── Detección de intenciones de PC ──
   Analiza el texto del usuario y determina si es una petición de PC. */
function detectarIntencionPC(texto) {
  const n = texto.toLowerCase();
  const resultado = { esPC: false, accion: null, parametros: {}, confianza: 0 };

  // ── ABRIR PROGRAMA ──
  const mAbrir = n.match(/(?:abre|inicia|lanzar|ejecutar|abrir|corre)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+)/i);
  if (mAbrir) {
    const programa = mAbrir[1].trim();
    // Filtrar palabras de relleno
    const programaLimpio = programa.replace(/^(programa|aplicacion|aplicación)\s+/i, "").trim();
    if (programaLimpio.length > 0) {
      resultado.esPC = true;
      resultado.accion = "abrir_programa";
      resultado.parametros = { nombre: programaLimpio };
      resultado.confianza = 0.9;
      return resultado;
    }
  }

  // ── LEER ARCHIVO ──
  const mLeer = n.match(/(?:lee|lee el|leer|abre el archivo|abre archivo|mostrar\s+(?:el\s+)?archivo)\s+(.+)/i);
  if (mLeer) {
    resultado.esPC = true;
    resultado.accion = "leer_archivo";
    resultado.parametros = { ruta: mLeer[1].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── ESCRIBIR ARCHIVO ──
  const mEscribir = n.match(/(?:escribe|escribir|guarda|guardar|anota|apunta)\s+(?:en\s+el\s+archivo\s+|en\s+archivo\s+)?(.+)(?:\s+(?:con\s+el\s+contenido\s+|con\s+|diciendo\s+|que\s+diga\s+))(.+)/i);
  if (mEscribir) {
    resultado.esPC = true;
    resultado.accion = "escribir_archivo";
    resultado.parametros = { ruta: mEscribir[1].trim(), contenido: mEscribir[2].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── LISTAR CARPETA ──
  const mListar = n.match(/(?:que\s+hay\s+en\s+la\s+carpeta|listar\s+carpeta|contenido\s+de\s+la\s+carpeta|archivos\s+en\s+)(?:la\s+)?(.+)/i);
  if (mListar) {
    resultado.esPC = true;
    resultado.accion = "listar_carpeta";
    resultado.parametros = { ruta: mListar[1].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── CREAR CARPETA ──
  const mCrear = n.match(/(?:crea|crear|haz\s+una\s+carpeta|nueva\s+carpeta)\s+(?:la\s+)?(?:carpeta\s+)?(.+)/i);
  if (mCrear) {
    resultado.esPC = true;
    resultado.accion = "crear_carpeta";
    resultado.parametros = { ruta: mCrear[1].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── INFO SISTEMA ──
  if (/informacion\s+(?:del\s+)?sistema|sobre\s+mi\s+pc|mi\s+computadora|especificaciones|cuant\s+ram|procesador/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "info_sistema";
    resultado.parametros = {};
    resultado.confianza = 0.9;
    return resultado;
  }

  // ── EJECUTAR COMANDO ── (último recurso, menor confianza)
  const mComando = n.match(/(?:ejecuta|ejecutar|corre|correr|run)\s+(?:el\s+)?comando\s+(.+)/i);
  if (mComando) {
    resultado.esPC = true;
    resultado.accion = "ejecutar_comando";
    resultado.parametros = { comando: mComando[1].trim() };
    resultado.confianza = 0.7;
    return resultado;
  }

  // ── LISTAR VENTANAS ──
  if (/que\s+ventanas\s+hay\s+abiertas|listar\s+ventanas|ventanas\s+abiertas|cuales\s+ventanas/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "listar_ventanas";
    resultado.parametros = {};
    resultado.confianza = 0.9;
    return resultado;
  }

  // ── ACTIVAR VENTANA ──
  const mActivarVentana = n.match(/(?:activa|activar|pone\s+en\s+primer\s+plano|enfoca|abre\s+la\s+ventana\s+de)\s+(?:la\s+)?ventana\s+(?:de\s+)?(.+)/i);
  if (mActivarVentana) {
    resultado.esPC = true;
    resultado.accion = "activar_ventana";
    resultado.parametros = { titulo: mActivarVentana[1].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── VENTANA ACTIVA ──
  if (/cual\s+es\s+la\s+ventana\s+activa|que\s+ventana\s+esta\s+abierta|ventana\s+activa/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "ventana_activa";
    resultado.parametros = {};
    resultado.confianza = 0.9;
    return resultado;
  }

  // ── COPIAR (Ctrl+C) ──
  if (/copiar|ctrl\s*\+?\s*c|copia\s+esto/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "tecla_combinada";
    resultado.parametros = { modificador: "ctrl", tecla: "c" };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── PEGAR (Ctrl+V) ──
  if (/pegar|ctrl\s*\+?\s*v/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "tecla_combinada";
    resultado.parametros = { modificador: "ctrl", tecla: "v" };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── SELECCIONAR TODO (Ctrl+A) ──
  if (/seleccionar\s+todo|ctrl\s*\+?\s*a/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "tecla_combinada";
    resultado.parametros = { modificador: "ctrl", tecla: "a" };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── OBTENER PORTAPAPELES ──
  if (/que\s+hay\s+en\s+el\s+portapapeles|contenido\s+del\s+portapapeles|portapapeles/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "obtener_portapapeles";
    resultado.parametros = {};
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── ESTABLECER PORTAPAPELES ──
  const mPortapapeles = n.match(/(?:copia\s+al\s+portapapeles|escribe\s+en\s+el\s+portapapeles|portapapeles\s+con)\s+(.+)/i);
  if (mPortapapeles) {
    resultado.esPC = true;
    resultado.accion = "establecer_portapapeles";
    resultado.parametros = { texto: mPortapapeles[1].trim() };
    resultado.confianza = 0.85;
    return resultado;
  }

  // ── ALT+TAB ──
  if (/cambiar\s+ventana|alt\s*\+?\s*tab|cambiar\s+de\s+aplicacion/i.test(n)) {
    resultado.esPC = true;
    resultado.accion = "tecla_combinada";
    resultado.parametros = { modificador: "alt", tecla: "tab" };
    resultado.confianza = 0.85;
    return resultado;
  }

  return resultado;
}

/* ── Ejecutar habilidad de PC ──
   Llama a window.ViernesPC para ejecutar la acción en Windows.
   Maneja confirmaciones para acciones peligrosas. */
async function ejecutarHabilidadPC(accion, parametros) {
  if (!window.ViernesPC || typeof window.ViernesPC[accion] !== "function") {
    return { exito: false, error: "Habilidad de PC no disponible: " + accion };
  }

  try {
    const resultado = await window.ViernesPC[accion](parametros);
    return resultado;
  } catch (e) {
    return { exito: false, error: e.message };
  }
}

/* ── Formatear respuesta de habilidad de PC ──
   Convierte el resultado técnico en texto natural para Viernes. */
function formatearRespuestaPC(accion, resultado) {
  if (resultado.exito) {
    switch (accion) {
      case "abrir_programa":
        return { texto: resultado.mensaje || "Programa abierto.", tipo: "exito" };
      case "leer_archivo":
        return {
          texto: "He leído el archivo: " + (resultado.contenido || "").slice(0, 500) +
            (resultado.contenido && resultado.contenido.length > 500 ? "..." : ""),
          tipo: "exito",
          datos: resultado
        };
      case "escribir_archivo":
        return { texto: resultado.mensaje || "Archivo guardado.", tipo: "exito" };
      case "listar_carpeta":
        const items = resultado.items || [];
        const nombres = items.map((i) => (i.esCarpeta ? "📁 " : "📄 ") + i.nombre).join(", ");
        return {
          texto: "En la carpeta hay " + items.length + " elementos: " + nombres.slice(0, 300) +
            (nombres.length > 300 ? "..." : ""),
          tipo: "exito",
          datos: resultado
        };
      case "crear_carpeta":
        return { texto: resultado.mensaje || "Carpeta creada.", tipo: "exito" };
      case "info_sistema":
        return {
          texto: "Sistema: " + resultado.computadora + ", usuario: " + resultado.usuario +
            ", plataforma: " + resultado.plataforma + " " + resultado.arquitectura,
          tipo: "exito",
          datos: resultado
        };
      case "notificar":
        return { texto: "Notificación enviada.", tipo: "exito" };
      case "mover_mouse":
        return { texto: "Mouse movido.", tipo: "exito" };
      case "clic_raton":
        return { texto: "Clic realizado.", tipo: "exito" };
      case "escribir_texto":
        return { texto: "Texto escrito.", tipo: "exito" };
      case "presionar_tecla":
        return { texto: "Tecla presionada.", tipo: "exito" };
      case "tecla_combinada":
        return { texto: "Combinación de teclas enviada: " + (resultado.mensaje || ""), tipo: "exito" };
      case "listar_ventanas": {
        const ventanas = resultado.ventanas || [];
        if (ventanas.length === 0) {
          return { texto: "No hay ventanas abiertas.", tipo: "exito" };
        }
        const nombres = ventanas.slice(0, 10).map((v) => v.titulo).join(", ");
        return {
          texto: "Hay " + ventanas.length + " ventana(s) abierta(s): " + nombres +
            (ventanas.length > 10 ? " y más..." : ""),
          tipo: "exito",
          datos: resultado
        };
      }
      case "activar_ventana":
        return { texto: resultado.mensaje || "Ventana activada.", tipo: "exito" };
      case "ventana_activa":
        return {
          texto: "Ventana activa: " + (resultado.titulo || "desconocida"),
          tipo: "exito",
          datos: resultado
        };
      case "obtener_portapapeles":
        return {
          texto: "Contenido del portapapeles: " + (resultado.contenido || "(vacio)").slice(0, 300) +
            (resultado.contenido && resultado.contenido.length > 300 ? "..." : ""),
          tipo: "exito",
          datos: resultado
        };
      case "establecer_portapapeles":
        return { texto: resultado.mensaje || "Portapapeles actualizado.", tipo: "exito" };
      default:
        return { texto: "Acción completada.", tipo: "exito" };
    }
  } else {
    return {
      texto: "No pude completar la acción: " + (resultado.error || "error desconocido"),
      tipo: "error"
    };
  }
}

/* ── Middleware para integrar con enviarTexto de app.js ──
   Llama esta función al inicio de enviarTexto para interceptar peticiones de PC. */
async function interceptarPeticionPC(texto) {
  const intencion = detectarIntencionPC(texto);
  if (!intencion.esPC) return null;

  // Para acciones peligrosas, requerir confirmación
  const accionesPeligrosas = ["escribir_archivo", "ejecutar_comando", "crear_carpeta", "establecer_portapapeles"];
  if (accionesPeligrosas.includes(intencion.accion)) {
    // Marcar para confirmación - el UI debe mostrar un diálogo
    intencion.requiereConfirmacion = true;
    intencion.accionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    return intencion;
  }

  // Ejecutar directamente
  const resultado = await ejecutarHabilidadPC(intencion.accion, intencion.parametros);
  return {
    esPC: true,
    accion: intencion.accion,
    resultado: resultado,
    respuestaFormateada: formatearRespuestaPC(intencion.accion, resultado),
    requiereConfirmacion: false
  };
}

window.ViernesPCSkills = {
  PC_SKILLS,
  detectarIntencionPC,
  ejecutarHabilidadPC,
  formatearRespuestaPC,
  interceptarPeticionPC
};
