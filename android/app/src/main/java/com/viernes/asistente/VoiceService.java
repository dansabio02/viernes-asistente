package com.viernes.asistente;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;

/* Escucha continua en primer plano: sigue activa con la pantalla bloqueada.
   Android exige la notificación fija mientras el micrófono está en uso. */
public class VoiceService extends Service {

    public interface Escuchador {
        void onTexto(String texto);
    }

    public static volatile Escuchador escuchador;
    public static volatile boolean activo = false;

    private static final String CANAL = "viernes_voz";
    private static final int NOTIF_ID = 1;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer reco;
    private Intent intentReco;

    @Override
    public void onCreate() {
        super.onCreate();
        crearCanal();
        intentReco = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intentReco.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intentReco.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-MX");
        intentReco.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        intentReco.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = construirNotificacion();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIF_ID, n);
        }
        if (!activo) {
            activo = true;
            crearReconocedor();
            escuchar(0);
        }
        return START_STICKY;
    }

    private void crearReconocedor() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return;
        reco = SpeechRecognizer.createSpeechRecognizer(this);
        reco.setRecognitionListener(new RecognitionListener() {
            @Override public void onResults(android.os.Bundle results) {
                ArrayList<String> textos = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (textos != null && !textos.isEmpty() && escuchador != null) {
                    escuchador.onTexto(textos.get(0));
                }
                escuchar(200);
            }
            @Override public void onError(int error) {
                // Silencio o reconocedor ocupado: reiniciar sin ruido
                escuchar(error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ? 1000 : 400);
            }
            @Override public void onReadyForSpeech(android.os.Bundle params) {}
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() {}
            @Override public void onPartialResults(android.os.Bundle partialResults) {}
            @Override public void onEvent(int eventType, android.os.Bundle params) {}
        });
    }

    private void escuchar(long retrasoMs) {
        main.postDelayed(() -> {
            if (!activo || reco == null) return;
            try {
                reco.startListening(intentReco);
            } catch (Exception e) {
                // Si el reconocedor quedó trabado, lo recreamos
                reco.destroy();
                crearReconocedor();
            }
        }, retrasoMs);
    }

    private void crearCanal() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CANAL, "Escucha de VIERNES", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("VIERNES escucha con la pantalla bloqueada");
            getSystemService(NotificationManager.class).createNotificationChannel(c);
        }
    }

    private Notification construirNotificacion() {
        Intent abrir = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, abrir, PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CANAL)
                : new Notification.Builder(this);
        return b.setContentTitle("VIERNES está escuchando")
                .setContentText("Diga «Viernes» para hablarle")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        activo = false;
        main.removeCallbacksAndMessages(null);
        if (reco != null) { reco.destroy(); reco = null; }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
