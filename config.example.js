// Ejemplo de configuración — dos archivos:
//
// 1) config.js (PÚBLICO, se sube a GitHub): solo la URL del proxy.
//    NUNCA pongas ahí tu API key.
//    window.VIERNES_PROXY_URL = "https://viernes-proxy.tu-usuario.workers.dev";
//
// 2) config.local.js (LOCAL, en .gitignore): tu API key de Groq.
//    window.GROQ_API_KEY_OVERRIDE = "tu_api_key_de_groq_aqui";
