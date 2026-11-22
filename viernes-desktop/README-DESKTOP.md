# VIERNES Desktop · Automatización de PC

Convierte a Viernes en una asistente que puede actuar **directamente en tu computadora Windows**: abrir programas, escribir archivos, ejecutar comandos, controlar el mouse y teclado, y mucho más.

---

## 📋 Qué puede hacer Viernes en tu PC

| Habilidad | Comando de ejemplo | Requiere confirmación |
|-----------|-------------------|----------------------|
| **Abrir programas** | "Abre el bloc de notas" | ✅ Sí |
| **Ejecutar comandos** | "Ejecuta el comando dir" | ✅ Sí |
| **Leer archivos** | "Lee el archivo notas.txt" | ❌ No |
| **Escribir archivos** | "Escribir en todo.txt que compre leche" | ✅ Sí |
| **Listar carpetas** | "¿Qué hay en la carpeta Documentos?" | ❌ No |
| **Crear carpetas** | "Crea una carpeta llamada Proyectos" | ✅ Sí |
| **Info del sistema** | "Dime información de mi PC" | ❌ No |
| **Listar ventanas** | "¿Qué ventanas hay abiertas?" | ❌ No |
| **Activar ventana** | "Activa la ventana de Bloc de notas" | ✅ Sí |
| **Ventana activa** | "¿Cuál es la ventana activa?" | ❌ No |
| **Copiar (Ctrl+C)** | "Copia esto" | ❌ No |
| **Pegar (Ctrl+V)** | "Pega" | ❌ No |
| **Seleccionar todo** | "Seleccionar todo" | ❌ No |
| **Cambiar ventana** | "Cambiar de aplicación" | ❌ No |
| **Portapapeles (leer)** | "¿Qué hay en el portapapeles?" | ❌ No |
| **Portapapeles (escribir)** | "Copia al portapapeles hola mundo" | ✅ Sí |
| **Control de mouse** | (vía comandos) | ✅ Sí |
| **Escribir texto** | (vía comandos) | ✅ Sí |
| **Presionar teclas** | (vía comandos) | ✅ Sí |
| **Teclas combinadas** | (Ctrl+C, Ctrl+V, Alt+Tab) | ❌ No |
| **Notificaciones** | (internas) | ❌ No |

---

## 🚀 Cómo instalar y ejecutar

### Requisitos previos
- **Windows 10 o 11**
- **Node.js** (descarga desde https://nodejs.org/)
- El proyecto base de Viernes en `viernes-asistente/`

### Pasos de instalación

1. **Instala Node.js** si no lo tienes:
   - Ve a https://nodejs.org/
   - Descarga e instala la versión LTS
   - Reinicia tu terminal después de instalar

2. **Ejecuta el instalador de Viernes Desktop:**
   - Haz doble clic en `viernes-desktop\instalar-electron.bat`
   - El script instalará las dependencias automáticamente

3. **Ejecuta Viernes Desktop:**
   - Opción 1 en el instalador: `npm start`
   - O ejecuta directamente: `cd viernes-desktop && npm start`

4. **Opcional - Construye el instalador para Windows:**
   - Opción 2 en el instalador: `npm run build`
   - El instalador (.exe) se generará en `viernes-desktop/dist/`

---

## 🔒 Seguridad

Todas las acciones que modifican tu computadora requieren **confirmación explícita**:

```
⚠️ Viernes quiere actuar en tu PC
Escribir en el archivo: C:\Users\Daniel\notas.txt

[Sí, ejecutar]  [Cancelar]
```

**Acciones que SIEMPRE piden confirmación:**
- Abrir programas
- Ejecutar comandos de terminal
- Escribir o modificar archivos
- Crear carpetas
- Controlar mouse y teclado
- Escribir en el portapapeles
- Activar/enfocar ventanas

**Comandos bloqueados (nunca se ejecutan):**
- `format`, `del`, `rmdir`, `shutdown`, `restart`, `reg delete`, `diskpart`, etc.

**Comandos bloqueados (nunca se ejecutan):**
- `format`, `del`, `rmdir`, `shutdown`, `restart`, `reg delete`, `diskpart`, etc.

---

## 🎤 Motor de reconocimiento de voz

Viernes ofrece dos motores de reconocimiento de voz. Selecciona uno en **Ajustes → Motor de reconocimiento de voz**:

| Motor | ¿Necesita internet? | Modelo | Precisión | Ideal para |
|-------|---------------------|--------|-----------|------------|
| **Google Web Speech** | ✅ Sí | Servidor de Google | Alta | Cuando tienes internet estable |
| **Vosk (offline)** | ❌ No | español small (~39 MB) | Media | Cuando no hay internet o el servidor de Google falla |

### Vosk (reconocimiento offline)

Vosk descarga un modelo de español (~39 MB) la primera vez que lo activas. El modelo queda en caché del navegador y todo el procesamiento se hace **localmente en tu dispositivo** — tu audio nunca sale de tu PC/celular.

**Limitaciones de Vosk:**
- Primera descarga: ~39 MB (una sola vez)
- Usa ~300 MB de RAM durante el reconocimiento
- Precisión menor que Google para frases largas y complejas
- Requiere WebAssembly (Chrome/Edge modernos)
- Funciona mejor con comandos cortos y claros

**Si el micrófono no funciona con Google Web Speech:**
1. Ve a **Ajustes → Motor de reconocimiento de voz**
2. Selecciona **"Vosk (offline, sin internet)"**
3. Espera a que descargue el modelo (puede tardar según tu conexión)
4. Vuelve a activar el micrófono

---

## 🛠️ Arquitectura técnica

```
┌─────────────────────────────────────────────────────────────┐
│  Viernes Desktop (Electron)                                 │
│  ├─ Renderer: app.js + HTML/CSS (la interfaz que conoces)   │
│  ├─ Proceso Principal: main.js (Node.js, acceso al SO)      │
│  ├─ Preload: preload.js (puente seguro IPC)                 │
│  ├─ Habilidades PC: pc-skills.js (detección de intenciones) │
│  └─ Integración: desktop-integration.js (puente con app.js) │
└─────────────────────────────────────────────────────────────┘
```

- **Electron** permite reutilizar todo el código HTML/JS/CSS existente
- **IPC (Inter-Process Communication)** separa la UI del acceso al sistema
- **contextBridge** expone solo las APIs necesarias, sin exponer Node.js completo al renderer
- **robotjs** controla mouse, teclado y ventanas de Windows
- **PowerShell** maneja el portapapeles del sistema

---

## 📁 Estructura de archivos

```
viernes-asistente/
├── app.js                    (cerebro existente - sin cambios)
├── index.html                (incluye scripts de escritorio)
├── styles.css                (estilos existentes)
├── viernes-desktop/
│   ├── package.json          (configuración de Electron)
│   ├── main.js               (proceso principal + habilidades Node)
│   ├── preload.js            (puente seguro IPC)
│   ├── pc-skills.js          (detección de intenciones de PC)
│   ├── desktop-integration.js (integración con enviarTexto)
│   ├── instalar-electron.bat (script de instalación)
│   └── README-DESKTOP.md     (este archivo)
```

---

## 🔮 Próximas fases (planificadas)

- **Fase 2:** Automatización de UI (control de ventanas, clics en apps específicas)
- **Fase 3:** Integración con Excel, Word, navegador web
- **Fase 4:** Secuencias de tareas ("abre Excel, crea una tabla, envíala por correo")
- **Fase 5:** Control remoto desde el teléfono (APK → Escritorio)

---

## ⚠️ Nota importante

Esta versión de escritorio requiere instalar software con permisos de administrador en tu computadora. Solo úsala si confías en el código y entiendes los riesgos. Todas las acciones peligrosas requieren tu confirmación explícita antes de ejecutarse.
