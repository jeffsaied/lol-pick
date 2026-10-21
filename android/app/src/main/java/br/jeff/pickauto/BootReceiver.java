package br.jeff.pickauto;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Liga o recebimento de avisos quando o celular liga ou o app e atualizado. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        try { AvisosService.ligar(c); } catch (Exception ignorado) { }
    }
}
