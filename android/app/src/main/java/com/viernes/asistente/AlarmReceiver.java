package com.viernes.asistente;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

/* Se ejecuta a la hora de la alarma: abre la pantalla de alarma y muestra la notificación. */
public class AlarmReceiver extends BroadcastReceiver {

    public static final String CANAL = "viernes_alarmas";

    @Override
    public void onReceive(Context c, Intent in) {
        if (!AlarmScheduler.ACCION.equals(in.getAction())) return;

        String id = in.getStringExtra("id");
        String txt = in.getStringExtra("txt");
        if (id == null) return;
        if (txt == null) txt = "";
        boolean diario = in.getBooleanExtra("diario", false);

        long ahora = System.currentTimeMillis();
        JSONObject guardada = AlarmStore.buscar(c, id);
        if (diario && guardada != null) {
            long siguiente = AlarmScheduler.siguienteDia(guardada.optLong("t"), ahora);
            try {
                AlarmStore.agregar(c, id, siguiente, txt, true);
            } catch (Exception e) {
                AlarmStore.quitar(c, id);
            }
            AlarmScheduler.programar(c, id, siguiente, txt, true);
        } else {
            AlarmStore.quitar(c, id);
        }

        Intent pantalla = new Intent(c, AlarmActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("txt", txt);
        PendingIntent pi = PendingIntent.getActivity(c, id.hashCode(), pantalla,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel canal = new NotificationChannel(CANAL, "Alarmas de VIERNES", NotificationManager.IMPORTANCE_HIGH);
            canal.setSound(null, null);
            nm.createNotificationChannel(canal);
        }
        Notification.Builder b = new Notification.Builder(c, CANAL)
                .setContentTitle("⏰ VIERNES · Alarma")
                .setContentText(txt.isEmpty() ? "Despierte, es su alarma." : txt)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_MAX)
                .setFullScreenIntent(pi, true)
                .setAutoCancel(true);
        nm.notify(id.hashCode(), b.build());

        try {
            c.startActivity(pantalla);
        } catch (Exception e) {
            // Android puede bloquear abrir pantallas desde segundo plano: queda la notificación de pantalla completa
        }
    }
}
