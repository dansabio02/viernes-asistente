# VIERNES Desktop · Automatización de PC

Convierte a Viernes en una asistente que puede actuar **directamente en tu computadora Windows**: abrir programas, escribir archivos, ejecutar comandos, controlar el mouse y teclado, y mucho más.

---

## 📋 Qué puede hacer Viernes en tu PC

| Habilidad | Comando de ejemplo | Requiere confirmación |
|-----------|-------------------|----------------------|
| **Abrir programas** | "Abre el bloc de notas" | ✅ Sí |
| **Ejecutar comandos** | "Ejecuta el comando dir" | ✅ Sí |
| **Leer archivos** | "Lee el archivo notas.txt" | ❌ No |
| **Escribir archivos** | "Escribir en el archivo todo.txt que compre leche" | ✅ Sí |
| **Listar carpetas** | "¿Qué hay en la carpeta Documentos?" | ❌ No |
| **Crear carpetas** | "Crea una carpeta llamada Proyectos" | ✅ Sí |
| **Info del sistema** | "Dime información de mi PC" | ❌ No |
| **Control de mouse** | (vía comandos) | ✅ Sí |
| **Escribir texto** | (vía comandos) | ✅ Sí |
| **Presionar teclas** | (vía comandos) | ✅ Sí |
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

**Comandos bloqueados (nunca se ejecutan):**
- `format`, `del`, `rmdir`, `shutdown`, `restart`, `reg delete`, `diskpart`, etc.

---

## 🛠️ Arquitectura técnica

```
┌─────────────────────────────────────────────────────────────┐
│  Viernes Desktop (Electron)                                 │
│  ├─ Renderer: app.js + HTML/CSS (la interfaz que conoces)   │
│  ├─ Proceso Principal: main.js (Node.js, acceso al SO)      │
│  ├─ Preload: preload.js (puente seguro IPC)                 │
│  └─ Habilidades PC: pc-skills.js (detección de intenciones) │
└─────────────────────────────────────────────────────────────┘
```

- **Electron** permite reutilizar todo el código HTML/JS/CSS existente
- **IPC (Inter-Process Communication)** separa la UI del acceso al sistema
- **contextBridge** expone solo las APIs necesarias, sin exponer Node.js completo al renderer

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
