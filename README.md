# 🗓️ VIERNES · Asistente Personal

Tu asistente que **siempre está escuchando**. Di la palabra mágica **"VIERNES"** seguido de tu duda, y te responde en voz alta. Cualquier tema: horas, fechas, preguntas, ideas, traducciones, cálculos…

🌐 **En vivo (HTTPS):** <https://dansabio02.github.io/viernes-asistente/> — ahí el micrófono pide permiso **una sola vez** y la escucha no se interrumpe.

## ✨ Características

- 🎤 **Modo siempre escuchando** — escucha continuamente (reinicio canónico en `onend` + keepalive cada 15 s) y solo se activa con la palabra mágica **"VIERNES"**
- 🌡️ **Clima en vivo** (Open-Meteo, gratis): "VIERNES, temperatura en Madrid" o "VIERNES, ¿qué clima hace?"
- ⏱️ **Temporizadores**: "VIERNES, recuérdame en 5 minutos"
- 📝 **Notas**: "VIERNES, guarda nota comprar leche" / "VIERNES, mis notas"
- 🧮 **Cálculos**: "VIERNES, ¿cuánto es 12 por 8?"
- 🎩 **Trato de jefe**: cada respuesta te dice "jefe"
- 🔊 **Responde en voz** (texto a voz en español, sin leer emojis) o por texto
- 🎙️ **Voz a la carta**: selector de voz + **tono estilo JARVIS** en Ajustes
- 🎨 **Interfaz J.A.R.V.I.S.**: reactor de arco giratorio, HUD cian, tipografía Orbitron
- 🧠 **Cerebro IA** vía Groq (`gpt-oss-120b` con fallback) + tu propio proxy (Cloudflare Worker)
- ⚡ **Comandos instantáneos locales**: hora, fecha, saludos, "cállate"
- 💾 **Memoria**: recuerda la conversación (hasta 30 mensajes, en tu navegador)
- 📱 **PWA**: instálalo desde Chrome ("Instalar app") y abre instantáneo
- 🔧 **Diagnóstico integrado**: Ajustes → *Probar conexión*

## 🎙️ Personalizar la voz (estilo JARVIS)

En **Ajustes**:
- **Voz**: elige cualquier voz en español instalada en tu sistema (Chrome/Edge traen Microsoft/Google). Para un tono más "JARVIS", prueba *Microsoft Jorge* (es-ES) o sube el **tono a 1.2–1.3**
- **Tono**: de 0.6 (grave) a 1.8 (agudo). El default 1.1 suena claro y sintético
- **Velocidad**: 0.7 (lento) a 1.6 (rápido)

> Truco JARVIS clásico: voz *es-ES* + tono 1.2 + velocidad 1.0.

## 🎨 Tema visual

Reactor de arco con anillos giratorios, **ripples concéntricos**, **ticks de brújula** y **barrido radar**, marco HUD con esquinas, scanlines, tipografía **Orbitron** (títulos) + **Share Tech Mono** (datos). Colores: cian `#00D4FF` sobre negro azulado `#04070F`. El reactor flota suavemente y acelera sus anillos al activarse.

## ⚡ Respuestas rápidas

- Modelo rápido primero (`gpt-oss-20b`), respuestas más cortas (450 tokens), historial reducido a 6 mensajes
- Comandos locales instantáneos (hora, fecha, saludos) sin llamar a la IA
- Captura de voz de 4.5s tras la palabra mágica

## 🚀 Cómo usarlo

### 1. API key de Groq
Crea tu key en <https://console.groq.com/keys> y pégala en **`config.local.js`** (archivo local):

```js
// config.local.js — NO se sube a GitHub
window.GROQ_API_KEY_OVERRIDE = "tu_key_aqui";
```

> ⚠️ `config.local.js` está en `.gitignore`: **nunca se sube**. `config.js` es público y solo lleva la URL del proxy — si pusieras la key ahí, Groq la revocarías al instante (como pasó antes).

### 2. Servir la página
El micrófono requiere **HTTPS** o **localhost**:

- **Local:** `python -m http.server 8000` → abre <http://localhost:8000>
- **Publicado:** súbelo a GitHub Pages (es HTTPS, el micrófono funciona)

### 3. Activar
1. Abre la página en **Chrome o Edge** (unicamente estos tienen reconocimiento de voz)
2. Permite el **micrófono** cuando lo pida
3. Toca el **orbe** → el estado pasa a *Escuchando*
4. Di: **"VIERNES, ¿qué hora es?"** → dos bips, y VIERNES responde en voz

## 🎮 Controles

| Acción | Cómo |
|---|---|
| Activar/desactivar escucha | Toca el orbe |
| Hablar ahora (sin palabra mágica) | Botón 🎤 |
| Escribir | Caja de texto inferior |
| Silenciar a VIERNES | Di *"cállate"* o quita 🔊 en Ajustes |
| Probar la voz | Ajustes → *Probar voz* |

## ⚠️ Limitaciones del navegador

- **Solo Chrome / Edge** tienen reconocimiento de voz (Firefox y Safari muestran el chat de texto, que funciona igual)
- La pestaña debe estar **abierta**; si el navegador la suspende en segundo plano, la escucha se pausa
- El reconocimiento de Chrome usa su servicio en la nube (necesita internet)
- Por privacidad, todo corre en **tu navegador**: la conversación solo viaja a Groq

## 🔧 Solución de problemas

**"No pude conectar con la IA"** — toca **Ajustes → 🔧 Probar conexión** para ver exactamente qué ruta falla.

| Diagnóstico | Causa | Solución |
|---|---|---|
| `API key: NO configurada` | `config.js` vacía | Pega tu key en `config.js` |
| `Directo → bloqueado por CORS` | Normal: Groq no permite llamadas desde el navegador | Usa un proxy (ver abajo) |
| `HTTP 403 Access denied` | **La key está revocada** (Groq desactiva las keys filtradas en repos públicos) | Crea una **nueva** key en [console.groq.com/keys](https://console.groq.com/keys) |
| Proxies públicos → 500/403 | Los proxies gratuitos son inestables | Despliega tu propio Worker (recomendado) |

### Si el micrófono pide permiso una y otra vez

**La causa #1 (90% de los casos): abriste el archivo directo (`file://`).** Chrome no puede recordar el permiso ahí. Solución:

1. **Doble clic en `servidor.bat`** (Windows) → abre `http://localhost:8000` automáticamente
2. Permite el micrófono **una sola vez**

Otras causas:
3. **Usa siempre la misma URL y puerto**: `localhost:8000` ≠ `127.0.0.1:8000` ≠ otro puerto — cada uno es un origen distinto
4. Ve a `chrome://settings/content/microphone` y asegúrate de que el sitio esté en **Permitir**, no en "Preguntar cada vez"
5. Toca *AJUSTES → 🔧 Probar conexión* para ver el protocolo y el estado del permiso

**Protecciones del código** (patrón canónico de Artyom.js / MDN): **una sola instancia** de reconocimiento con `continuous: true`, **reinicio inmediato en `onend`** (sin retardos ni throttles: un reinicio diferido es lo que rompe la escucha constante), permiso calentado sin ocupar el micrófono (un stream abierto puede dejar al reconocedor mudo), pausa mientras VIERNES habla y un **keepalive** cada 15 s (Chrome a veces corta la sesión sin avisar; el stop forzado la reanuda al instante).

### La solución estable: tu propio proxy (gratis, 5 min)

Groq bloquea las llamadas directas del navegador (CORS), y los proxies públicos fallan a menudo. La opción robusta es un **Cloudflare Worker** que guarda tu key en el servidor:

1. Crea cuenta gratis en [dash.cloudflare.com](https://dash.cloudflare.com)
2. **Workers & Pages → Create → Create Worker**
3. Pega el código de `proxy-worker.js`
4. En *Variables* agrega el secreto `GROQ_API_KEY` con tu key
5. **Deploy** y copia la URL (`https://viernes-proxy.tu-usuario.workers.dev`)
6. En `config.js` descomenta:
   ```js
   window.VIERNES_PROXY_URL = "https://viernes-proxy.tu-usuario.workers.dev";
   ```

Con esto la key **nunca sale del servidor** y VIERNES funciona desde cualquier dispositivo.

## 📁 Estructura

```
viernes-asistente/
├── index.html            # interfaz (orbe, chat, ajustes)
├── viernes.js            # motor: wake word, STT, TTS, Groq
├── config.js             # tu API key (local, no se sube)
├── config.example.js     # plantilla
├── manifest.webmanifest  # PWA
├── sw.js                 # service worker (carga instantánea)
└── icon.svg              # ícono naranja con "V"
```

## 🔒 Seguridad

- La API key vive solo en `config.js` (local). Para un despliegue público, crea una key ** aparte** en <https://console.groq.com/keys> con límites bajos.
- El micrófono solo se activa cuando tú tocas el orbe (los navegadores exigen un gesto del usuario).
