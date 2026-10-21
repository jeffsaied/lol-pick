package br.jeff.pickauto;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** A selecao de campeoes (a mesma pagina do site), dentro do app. */
public class PaginaActivity extends Activity {
    private WebView web;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0A1018"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) v.loadData(
                        "<body style='background:#0a1018;color:#e8e3d5;font:18px sans-serif;padding:30px;text-align:center'>"
                        + "<h2>Não alcancei o PC</h2><p style='color:#8696a8'>A seleção de campeões só abre no mesmo Wi-Fi do PC, "
                        + "com o Pick Automático ligado.</p></body>", "text/html; charset=utf-8", "UTF-8");
            }
        });
        setContentView(web);
        String url = getIntent().getStringExtra("url");
        if (url == null) { Conexao c = Conexao.ler(this); if (c != null) url = c.pagina(); }
        if (url != null) web.loadUrl(url); else finish();
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
