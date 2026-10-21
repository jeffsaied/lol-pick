package br.jeff.pickauto;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Fica ligado (como o ntfy faz) segurando uma conexao com o servidor de avisos: quando o PC avisa
 * "partida encontrada", a notificacao aparece na hora, em qualquer rede.
 */
public class AvisosService extends Service {
    static final String CANAL_AVISOS = "avisos";
    static final String CANAL_FIXO = "ligado";
    private volatile boolean rodando;
    private Thread fio;
    private HttpURLConnection atual;

    static void ligar(Context c) {
        if (Conexao.ler(c) == null) return;
        Intent i = new Intent(c, AvisosService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void desligar(Context c) { c.stopService(new Intent(c, AvisosService.class)); }

    static void criarCanais(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel a = new NotificationChannel(CANAL_AVISOS, "Avisos do LoL", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Partida encontrada, seleção de campeões e partida iniciada");
        a.enableVibration(true);
        nm.createNotificationChannel(a);
        NotificationChannel f = new NotificationChannel(CANAL_FIXO, "App ligado", NotificationManager.IMPORTANCE_MIN);
        f.setDescription("Aviso fixo que mantém o app recebendo em segundo plano");
        f.setShowBadge(false);
        nm.createNotificationChannel(f);
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        criarCanais(this);
        PendingIntent abrir = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification fixo = new Notification.Builder(this, CANAL_FIXO)
                .setSmallIcon(R.drawable.ic_sino)
                .setContentTitle("Pick Automático ligado")
                .setContentText("Recebendo os avisos do PC")
                .setContentIntent(abrir)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, fixo, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, fixo);
        if (fio == null || !fio.isAlive()) {
            rodando = true;
            fio = new Thread(this::escutar, "avisos");
            fio.start();
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        rodando = false;
        HttpURLConnection h = atual;
        if (h != null) h.disconnect();
        if (fio != null) fio.interrupt();
        super.onDestroy();
    }

    private void escutar() {
        int espera = 3;
        while (rodando) {
            Conexao c = Conexao.ler(this);
            if (c == null) { stopSelf(); return; }
            try {
                String desde = Conexao.ultimoAviso(this);
                URL u = new URL(c.servidor + "/" + c.topico + "/json" + (desde != null ? "?since=" + desde : "?since=1m"));
                HttpURLConnection h = (HttpURLConnection) u.openConnection();
                atual = h;
                h.setConnectTimeout(15000);
                h.setReadTimeout(90000); // o servidor manda "keepalive" a cada ~45 s
                BufferedReader r = new BufferedReader(new InputStreamReader(h.getInputStream(), StandardCharsets.UTF_8));
                espera = 3;
                String linha;
                while (rodando && (linha = r.readLine()) != null) {
                    if (linha.isEmpty()) continue;
                    JSONObject m = new JSONObject(linha);
                    if (m.has("id") && "message".equals(m.optString("event"))) {
                        Conexao.guardarUltimo(this, m.getString("id"));
                        mostrar(m);
                    }
                }
                r.close();
                h.disconnect();
            } catch (Exception e) {
                // sem rede ou servidor caiu: tenta de novo, esperando cada vez mais (ate 1 min)
            }
            if (!rodando) return;
            try { Thread.sleep(espera * 1000L); } catch (InterruptedException e) { return; }
            espera = Math.min(espera * 2, 60);
        }
    }

    private void mostrar(JSONObject m) {
        if (m.has("click")) Conexao.atualizarEndereco(this, m.optString("click"));
        String titulo = m.optString("title", "Pick Automático");
        String texto = m.optString("message", "");
        int id = (int) (System.currentTimeMillis() & 0x7fffffff);

        // tocar no aviso abre o app (e dele a selecao de campeoes)
        Intent abrir = new Intent(this, MainActivity.class);
        if (m.has("click")) abrir.putExtra("abrir", m.optString("click"));
        PendingIntent pi = PendingIntent.getActivity(this, id, abrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = new Notification.Builder(this, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_sino)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE);

        // botoes que o PC mandou (ex.: "Aceitar" a partida)
        JSONArray acoes = m.optJSONArray("actions");
        if (acoes != null) {
            for (int i = 0; i < acoes.length() && i < 3; i++) {
                JSONObject a = acoes.optJSONObject(i);
                if (a == null || !"http".equals(a.optString("action"))) continue;
                Intent ai = new Intent(this, AcaoReceiver.class)
                        .putExtra("url", a.optString("url"))
                        .putExtra("metodo", a.optString("method", "POST"))
                        .putExtra("rotulo", a.optString("label", "OK"))
                        .putExtra("aviso", id);
                PendingIntent api = PendingIntent.getBroadcast(this, id * 4 + i, ai, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                b.addAction(new Notification.Action.Builder(null, a.optString("label", "OK"), api).build());
            }
        }
        getSystemService(NotificationManager.class).notify(id, b.build());
    }
}
