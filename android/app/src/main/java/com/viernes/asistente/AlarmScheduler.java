package com.viernes.asistente;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/* Programa las alarmas en AlarmManager: disparan aunque el teléfono esté bloqueado. */
public class AlarmScheduler {

    public static final String ACCION = "com.viernes.asistente.ALARMA";
    private static final long DIA_MS = 24L * 60 * 60 * 1000;

    public static void programar(Context c, String id, long t, String txt, boolean diario) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = pendiente(c, id, txt, diario);
        // Android 12+: los exactos requieren permiso; sin él, se usa uno aproximado
        if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
        } else {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, t, pi);
        }
    }

    public static void cancelar(Context c, String id) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        am.cancel(pendiente(c, id, "", false));
    }

    /* Tras reiniciar el teléfono, vuelve a programar todo lo que sigue pendiente. */
    public static void reprogramarTodas(Context c) {
        JSONArray a = AlarmStore.leer(c);
        long ahora = System.currentTimeMillis();
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o == null) continue;
            long t = o.optLong("t");
            boolean diario = "daily".equals(o.optString("rep"));
            if (t > ahora) {
                programar(c, o.optString("id"), t, o.optString("txt"), diario);
            }
        }
    }

    static PendingIntent pendiente(Context c, String id, String txt, boolean diario) {
        Intent i = new Intent(c, AlarmReceiver.class)
                .setAction(ACCION)
                .putExtra("id", id)
                .putExtra("txt", txt)
                .putExtra("diario", diario);
        return PendingIntent.getBroadcast(c, id.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static long siguienteDia(long t, long ahora) {
        long nuevo = t;
        while (nuevo <= ahora) nuevo += DIA_MS;
        return nuevo;
    }
}
