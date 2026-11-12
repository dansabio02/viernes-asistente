package com.viernes.asistente;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/* Alarmas guardadas en el teléfono: {id, t (ms epoch), txt, rep ("daily" o "")}. */
public class AlarmStore {

    private static final String PREFS = "viernes_alarmas";
    private static final String KEY = "lista";

    public static synchronized JSONArray leer(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            return new JSONArray(p.getString(KEY, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private static void escribir(Context c, JSONArray a) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, a.toString()).apply();
    }

    public static synchronized void agregar(Context c, String id, long t, String txt, boolean diario) throws Exception {
        JSONArray viejas = leer(c);
        JSONArray nuevas = new JSONArray();
        for (int i = 0; i < viejas.length(); i++) {
            JSONObject o = viejas.getJSONObject(i);
            if (!id.equals(o.optString("id"))) nuevas.put(o);
        }
        nuevas.put(new JSONObject()
                .put("id", id)
                .put("t", t)
                .put("txt", txt)
                .put("rep", diario ? "daily" : ""));
        escribir(c, nuevas);
    }

    public static synchronized void quitar(Context c, String id) {
        JSONArray viejas = leer(c);
        JSONArray nuevas = new JSONArray();
        for (int i = 0; i < viejas.length(); i++) {
            JSONObject o = viejas.optJSONObject(i);
            if (o != null && !id.equals(o.optString("id"))) nuevas.put(o);
        }
        escribir(c, nuevas);
    }

    public static synchronized JSONObject buscar(Context c, String id) {
        JSONArray a = leer(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return o;
        }
        return null;
    }
}
