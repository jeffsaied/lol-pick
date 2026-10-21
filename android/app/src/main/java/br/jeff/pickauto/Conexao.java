package br.jeff.pickauto;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** O que o QR do PC entrega (endereco do PC, chave, topico e servidor dos avisos) e as chamadas ao PC. */
final class Conexao {
    final String pc;      // http://192.168.x.x:8787
    final String chave;   // a chave da pagina (k=)
    final String topico;  // canal dos avisos
    final String servidor; // servidor que repassa os avisos fora de casa

    private Conexao(String pc, String chave, String topico, String servidor) {
        this.pc = pc; this.chave = chave; this.topico = topico; this.servidor = servidor;
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("conexao", Context.MODE_PRIVATE);
    }

    static Conexao ler(Context c) {
        SharedPreferences p = prefs(c);
        String pc = p.getString("pc", null), k = p.getString("k", null), t = p.getString("t", null);
        if (pc == null || k == null || t == null) return null;
        return new Conexao(pc, k, t, p.getString("s", "https://ntfy.sh"));
    }

    /** pickauto://conectar?u=...&k=...&t=...&s=... ; devolve null se o texto nao for um QR do Pick Automatico. */
    static Conexao doQr(Context c, String texto) {
        if (texto == null || !texto.startsWith("pickauto://conectar")) return null;
        Uri u = Uri.parse(texto);
        String pc = u.getQueryParameter("u"), k = u.getQueryParameter("k"), t = u.getQueryParameter("t");
        String s = u.getQueryParameter("s");
        if (pc == null || k == null || t == null || t.isEmpty()) return null;
        if (s == null || s.isEmpty()) s = "https://ntfy.sh";
        prefs(c).edit().putString("pc", pc).putString("k", k).putString("t", t).putString("s", s).remove("ultimo").apply();
        return new Conexao(pc, k, t, s);
    }

    static void esquecer(Context c) { prefs(c).edit().clear().apply(); }

    static String ultimoAviso(Context c) { return prefs(c).getString("ultimo", null); }
    static void guardarUltimo(Context c, String id) { prefs(c).edit().putString("ultimo", id).apply(); }

    String pagina() { return pc + "/?k=" + Uri.encode(chave); }

    /** GET/POST em /api/app do PC (so funciona no mesmo Wi-Fi). Corpo null = GET. */
    JSONObject app(JSONObject corpo) throws Exception {
        return pedir(corpo == null ? "GET" : "POST", pc + "/api/app?k=" + Uri.encode(chave),
                corpo == null ? null : corpo.toString());
    }

    static JSONObject pedir(String metodo, String endereco, String corpo) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(endereco).openConnection();
        h.setConnectTimeout(3000);
        h.setReadTimeout(6000);
        h.setRequestMethod(metodo);
        if (corpo != null) {
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = h.getOutputStream()) { o.write(corpo.getBytes(StandardCharsets.UTF_8)); }
        }
        int codigo = h.getResponseCode();
        InputStream in = codigo >= 400 ? h.getErrorStream() : h.getInputStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        if (in != null) { byte[] buf = new byte[4096]; int n; while ((n = in.read(buf)) > 0) b.write(buf, 0, n); in.close(); }
        h.disconnect();
        String txt = b.toString("UTF-8");
        JSONObject j = txt.trim().startsWith("{") ? new JSONObject(txt) : new JSONObject();
        if (!j.has("ok")) j.put("ok", codigo < 400);
        return j;
    }
}
