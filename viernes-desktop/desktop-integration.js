"use strict";

/* ============================================================
   VIERNES DESKTOP · INTEGRACIÓN CON APP.JS
   Intercepta enviarTexto para detectar peticiones de PC
   y ejecutarlas localmente antes de consultar a Groq.
   ============================================================ */

(function() {
  let enviarTextoOriginal = null;
  let pcSkillsCargado = false;
  let callbackConfirmacion = null;

  function esperarPCSkills() {
    return new Promise((resolve) => {
      let intentos = 0;
      const maxIntentos = 50; // ~10 segundos máximo
      const verificar = () => {
        intentos++;
        if (window.ViernesPCSkills && window.ViernesPC) {
          resolve(true);
        } else if (intentos >= maxIntentos) {
          // No estamos en Electron: las habilidades de PC no están disponibles
          resolve(false);
        } else {
          setTimeout(verificar, 200);
        }
      };
      verificar();
    });
  }

  function esperarEnviarTexto() {
    return new Promise((resolve) => {
      const verificar = () => {
        if (typeof window.enviarTexto === "function") {
          resolve(window.enviarTexto);
        } else {
          setTimeout(verificar, 200);
        }
      };
      verificar();
    });
  }

  function mostrarConfirmacionPC(accion, parametros, accionId) {
    // Crear un diálogo de confirmación en pantalla
    const dialogo = document.createElement("div");
    dialogo.id = "dialogo-confirmar-pc";
    dialogo.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Rajdhani', sans-serif;
    `;

    let textoAccion = "";
    switch (accion) {
      case "escribir_archivo":
        textoAccion = "Escribir en el archivo: " + (parametros.ruta || "desconocido");
        break;
      case "ejecutar_comando":
        textoAccion = "Ejecutar comando: " + (parametros.comando || "desconocido");
        break;
      case "crear_carpeta":
        textoAccion = "Crear carpeta: " + (parametros.ruta || "desconocido");
        break;
      default:
        textoAccion = "Acción: " + accion;
    }

    dialogo.innerHTML = `
      <div style="
        background: #070d18;
        border: 1.5px solid var(--border-strong, rgba(72,233,255,.42));
        border-radius: 16px;
        padding: 24px;
        max-width: 500px;
        color: var(--text, #e8f4ff);
        box-shadow: 0 20px 60px rgba(0,0,0,.8);
      ">
        <h2 style="margin:0 0 12px; color: var(--accent-2, #00d4ff); font-family: Orbitron, sans-serif;">⚠️ Viernes quiere actuar en tu PC</h2>
        <p style="margin:0 0 18px; font-size: 1rem; line-height: 1.5;">${textoAccion}</p>
        <div style="display: flex; gap: 12px;">
          <button id="btn-pc-si" style="
            flex: 1; padding: 12px 20px; background: var(--green, #00ff9f);
            color: #02121c; border: none; border-radius: 10px;
            font-family: Rajdhani, sans-serif; font-weight: 700; cursor: pointer;
          ">Sí, ejecutar</button>
          <button id="btn-pc-no" style="
            flex: 1; padding: 12px 20px; background: rgba(255,255,255,.05);
            color: var(--muted, #7d8aa0); border: 1px solid var(--border);
            border-radius: 10px; font-family: Rajdhani, sans-serif; cursor: pointer;
          ">Cancelar</button>
        </div>
        <p style="margin:12px 0 0; font-size: .75rem; color: var(--muted);">
          Esta acción afectará tu computadora. Solo acepta si confías en la orden.
        </p>
      </div>
    `;

    document.body.appendChild(dialogo);

    return new Promise((resolve) => {
      const btnSi = dialogo.querySelector("#btn-pc-si");
      const btnNo = dialogo.querySelector("#btn-pc-no");

      const limpiar = () => {
        try { document.body.removeChild(dialogo); } catch (e) {}
      };

      btnSi.onclick = () => { limpiar(); resolve(true); };
      btnNo.onclick = () => { limpiar(); resolve(false); };

      // Clic fuera para cancelar
      dialogo.onclick = (e) => {
        if (e.target === dialogo) { limpiar(); resolve(false); }
      };
    });
  }

  async function integrarConApp() {
    const pcDisponible = await esperarPCSkills();
    if (!pcDisponible) {
      // No estamos en Electron: las habilidades de PC no están disponibles.
      // No sobreescribimos enviarTexto; Viernes funciona normalmente en el navegador.
      return;
    }
    const enviarTextoFn = await esperarEnviarTexto();
    pcSkillsCargado = true;

    // Sobreescribir enviarTexto para interceptar peticiones de PC
    window.enviarTexto = async function(texto) {
      // 1. Verificar si es una petición de PC
      const peticion = await window.ViernesPCSkills.interceptarPeticionPC(texto);

      if (peticion && peticion.esPC) {
        if (peticion.requiereConfirmacion) {
          const aceptado = await mostrarConfirmacionPC(
            peticion.accion,
            peticion.parametros,
            peticion.accionId
          );
          if (!aceptado) {
            // Usuario canceló
            if (typeof window.hablarLocal === "function") {
              await window.hablarLocal("Acción cancelada.");
            } else if (typeof window.hablar === "function") {
              await window.hablar("Acción cancelada.");
            }
            return;
          }
        }

        // 2. Ejecutar la acción de PC
        const resultado = await window.ViernesPCSkills.ejecutarHabilidadPC(
          peticion.accion,
          peticion.parametros
        );

        // 3. Formatear y responder
        const formateado = window.ViernesPCSkills.formatearRespuestaPC(
          peticion.accion,
          resultado
        );

        // 4. Hablar la respuesta
        if (typeof window.hablarLocal === "function") {
          await window.hablarLocal(formateado.texto);
        } else if (typeof window.hablar === "function") {
          await window.hablar(formateado.texto);
        }

        // 5. Log en consola
        if (typeof window.log === "function") {
          window.log("PC: " + peticion.accion + " → " + (resultado.exito ? "OK" : "FALLO"), resultado.exito ? "ok" : "error");
        }

        return; // No continuar con Groq
      }

      // 3. Si no es de PC, continuar con el enviarTexto original
      return enviarTextoOriginal.call(this, texto);
    };

    // Guardar referencia al original (ya sobreescrito, pero lo teníamos antes)
    // Nota: enviarTextoOriginal se captura antes de la sobreescritura
  }

  // Iniciar integración cuando el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      // Capturar el enviarTexto original ANTES de que se sobreescriba
      setTimeout(() => {
        enviarTextoOriginal = window.enviarTexto;
        integrarConApp();
      }, 1000);
    });
  } else {
    setTimeout(() => {
      enviarTextoOriginal = window.enviarTexto;
      integrarConApp();
    }, 1000);
  }

})();
