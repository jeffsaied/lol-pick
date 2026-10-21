package br.jeff.pickauto;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Botao do aviso (ex.: "Aceitar"): chama o PC. So funciona no mesmo Wi-Fi do PC. */
public class AcaoReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        PendingResult fim = goAsync();
        String url = Conexao.noPcAtual(c, i.getStringExtra("url")), metodo = i.getStringExtra("metodo"), rotulo = i.getStringExtra("rotulo");
        int aviso = i.getIntExtra("aviso", 0);
        new Thread(() -> {
            String resultado;
            try {
                if (url == null) throw new IllegalStateException("endereço que não é do PC");
                JSONObject r = Conexao.pedir(metodo == null ? "POST" : metodo, url, "{}");
                resultado = r.optBoolean("ok") ? rotulo + ": feito" : rotulo + ": não deu (" + r.optString("erro", "erro") + ")";
            } catch (Exception e) {
                resultado = rotulo + ": não alcancei o PC (precisa estar no mesmo Wi-Fi)";
            }
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            nm.notify(aviso, new Notification.Builder(c, AvisosService.CANAL_AVISOS)
                    .setSmallIcon(R.drawable.ic_sino)
                    .setContentTitle("Pick Automático")
                    .setContentText(resultado)
                    .setAutoCancel(true)
                    .setTimeoutAfter(15000)
                    .build());
            fim.finish();
        }).start();
    }
}
