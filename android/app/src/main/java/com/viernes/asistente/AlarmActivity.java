package com.viernes.asistente;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/* Pantalla de alarma: se muestra sobre la pantalla de bloqueo, suena hasta que se apague. */
public class AlarmActivity extends Activity {

    private MediaPlayer sonido;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        String txt = getIntent().getStringExtra("txt");
        if (txt == null || txt.isEmpty()) txt = "Despierte, es su alarma.";

        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setGravity(Gravity.CENTER);
        raiz.setPadding(64, 64, 64, 64);
        raiz.setBackgroundColor(0xFF04070F);

        TextView titulo = new TextView(this);
        titulo.setText("⏰ ALARMA");
        titulo.setTextSize(34);
        titulo.setTextColor(0xFF48E9FF);
        titulo.setGravity(Gravity.CENTER);

        TextView detalle = new TextView(this);
        detalle.setText(txt);
        detalle.setTextSize(22);
        detalle.setTextColor(0xFFFFFFFF);
        detalle.setGravity(Gravity.CENTER);

        Button apagar = new Button(this);
        apagar.setText("Apagar");
        apagar.setOnClickListener(v -> terminar());

        raiz.addView(titulo);
        raiz.addView(detalle);
        raiz.addView(apagar);
        setContentView(raiz);

        iniciarSonido();
    }

    private void iniciarSonido() {
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            sonido = new MediaPlayer();
            sonido.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            sonido.setDataSource(this, uri);
            sonido.setLooping(true);
            sonido.prepare();
            sonido.start();
        } catch (Exception e) {
            sonido = null;
        }
    }

    private void terminar() {
        if (sonido != null) {
            try { sonido.stop(); } catch (Exception e) {}
            sonido.release();
            sonido = null;
        }
        finish();
    }

    @Override
    protected void onDestroy() {
        terminar();
        super.onDestroy();
    }
}
