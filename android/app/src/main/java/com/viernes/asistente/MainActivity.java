package com.viernes.asistente;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://dansabio02.github.io/viernes-asistente/";
    private static final int REQ_PERMISOS = 10;

    private WebView web;

    /* Puente para la web: window.ViernesNativo.iniciarEscucha() etc. */
    public class PuenteJs {
        @JavascriptInterface
        public void iniciarEscucha() {
            runOnUiThread(() -> startForegroundService(new Intent(MainActivity.this, VoiceService.class)));
        }

        @JavascriptInterface
        public void detenerEscucha() {
            runOnUiThread(() -> stopService(new Intent(MainActivity.this, VoiceService.class)));
        }

        @JavascriptInterface
        public boolean escuchando() {
            return VoiceService.activo;
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pedirPermisos();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);

        web.addJavascriptInterface(new PuenteJs(), "ViernesNativo");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                request.grant(request.getResources());
            }
        });

        /* Lo que dice el usuario llega aquí y se entrega a la página web */
        VoiceService.escuchador = texto -> runOnUiThread(() ->
                web.evaluateJavascript(
                        "if (window.viernesNativoTexto) window.viernesNativoTexto(" + JSONObject.quote(texto) + ");",
                        null));

        web.loadUrl(APP_URL);
    }

    private void pedirPermisos() {
        String[] pedir = {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.POST_NOTIFICATIONS
        };
        for (String p : pedir) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(pedir, REQ_PERMISOS);
                return;
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
