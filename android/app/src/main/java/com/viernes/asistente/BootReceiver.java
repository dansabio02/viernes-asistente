package com.viernes.asistente;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/* Tras reiniciar el teléfono, las alarmas guardadas se vuelven a programar. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent in) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(in.getAction())) {
            AlarmScheduler.reprogramarTodas(c);
        }
    }
}
