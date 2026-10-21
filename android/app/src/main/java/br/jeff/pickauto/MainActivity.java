package br.jeff.pickauto;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

/** Tela de conectar (QR do PC) e, depois, as mesmas opcoes do painel do PC. */
public class MainActivity extends Activity {
    static final int OURO = Color.parseColor("#C8AA6E"), TEXTO = Color.parseColor("#E8E3D5"),
            FRACO = Color.parseColor("#8696A8"), PAINEL = Color.parseColor("#121C28"),
            BORDA = Color.parseColor("#26334D"), VERDE = Color.parseColor("#2ECC71"), VERMELHO = Color.parseColor("#E74C3C");

    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView status, detalhe;
    private Switch swAceitar, swRunas, swAvisos, swFixo;
    private boolean pintando; // evita mandar ao PC quando so estamos mostrando o que ele disse
    private boolean visivel;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        AvisosService.criarCanais(this);
        tratar(getIntent());
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); tratar(i); }

    private void tratar(Intent i) {
        // a camera do celular abriu o QR do PC direto no app
        if (i != null && i.getData() != null && "pickauto".equals(i.getData().getScheme())) {
            conectou(Conexao.doQr(this, i.getData().toString()));
            return;
        }
        if (i != null && i.getStringExtra("abrir") != null && Conexao.ler(this) != null) {
            startActivity(new Intent(this, PaginaActivity.class).putExtra("url", i.getStringExtra("abrir")));
        }
        montar();
    }

    private void conectou(Conexao c) {
        if (c == null) { Toast.makeText(this, "Esse não é o QR do Pick Automático", Toast.LENGTH_LONG).show(); montar(); return; }
        Toast.makeText(this, "Conectado ao PC", Toast.LENGTH_SHORT).show();
        pedirPermissaoAvisos();
        AvisosService.ligar(this);
        montar();
    }

    private void pedirPermissaoAvisos() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    // ---------- telas ----------
    private void montar() {
        if (Conexao.ler(this) == null) telaConectar(); else telaPrincipal();
    }

    private LinearLayout coluna() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(22);
        l.setPadding(p, dp(36), p, p);
        return l;
    }

    private void telaConectar() {
        LinearLayout l = coluna();
        l.setGravity(Gravity.CENTER_HORIZONTAL);
        l.addView(texto("PICK AUTOMÁTICO", 13, OURO, true));
        TextView t = texto("Conecte ao seu PC", 26, TEXTO, true); t.setPadding(0, dp(10), 0, dp(10)); l.addView(t);
        l.addView(texto("No PC, no painel do Pick Automático, toque em ? e em \"Ligar um celular\". "
                + "Toque no botão abaixo e aponte a câmera para o QR que aparece lá.", 16, FRACO, false));
        Button b = botao("Escanear o QR do PC", true);
        b.setOnClickListener(v -> {
            IntentIntegrator ii = new IntentIntegrator(this);
            ii.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
            ii.setPrompt("Aponte para o QR do Pick Automático no PC");
            ii.setBeepEnabled(false);
            ii.setOrientationLocked(false);
            ii.initiateScan();
        });
        l.addView(b, margem(0, 28));
        l.addView(texto("Os avisos chegam em qualquer rede (Wi-Fi ou 4G). Aceitar a partida e escolher o campeão funcionam no mesmo Wi-Fi do PC.",
                13, FRACO, false), margem(0, 22));
        setContentView(l);
    }

    private void telaPrincipal() {
        Conexao c = Conexao.ler(this);
        LinearLayout l = coluna();
        l.addView(texto("PICK AUTOMÁTICO", 13, OURO, true));
        status = texto("Procurando o PC…", 24, TEXTO, true); status.setPadding(0, dp(8), 0, dp(4)); l.addView(status);
        detalhe = texto(c.pc.replace("http://", ""), 14, FRACO, false); l.addView(detalhe);

        LinearLayout cartao = new LinearLayout(this);
        cartao.setOrientation(LinearLayout.VERTICAL);
        cartao.setBackground(fundo(PAINEL, BORDA, 16));
        cartao.setPadding(dp(16), dp(6), dp(16), dp(6));
        swAceitar = chave(cartao, "Aceitar a partida sozinho", "O PC aceita quando a fila encontra", "aceitarSozinho");
        swRunas = chave(cartao, "Runas automáticas", "Monta a página de runas do campeão escolhido", "puxarRunas");
        swAvisos = chave(cartao, "Avisos no celular", "O sino: partida encontrada, seleção e partida iniciada", "avisarCelular");
        swFixo = chave(cartao, "Painel do PC sempre aberto", "O clipe: o painel não vira bolinha", "painelFixo");
        l.addView(cartao, margem(0, 20));

        Button selecao = botao("Abrir a seleção de campeões", true);
        selecao.setOnClickListener(v -> startActivity(new Intent(this, PaginaActivity.class)));
        l.addView(selecao, margem(0, 20));

        Button teste = botao("Mandar um aviso de teste", false);
        teste.setOnClickListener(v -> mandar(new JSONObject(), "teste"));
        l.addView(teste, margem(0, 10));

        Button sair = botao("Desconectar deste PC", false);
        sair.setTextColor(FRACO);
        sair.setOnClickListener(v -> {
            AvisosService.desligar(this);
            Conexao.esquecer(this);
            montar();
        });
        l.addView(sair, margem(0, 10));

        ScrollView sv = new ScrollView(this);
        sv.addView(l);
        setContentView(sv);
        pedirPermissaoAvisos();
        AvisosService.ligar(this);
        atualizar();
    }

    private Switch chave(LinearLayout pai, String titulo, String sub, String campo) {
        LinearLayout linha = new LinearLayout(this);
        linha.setOrientation(LinearLayout.HORIZONTAL);
        linha.setGravity(Gravity.CENTER_VERTICAL);
        linha.setPadding(0, dp(12), 0, dp(12));
        LinearLayout txt = new LinearLayout(this);
        txt.setOrientation(LinearLayout.VERTICAL);
        txt.addView(texto(titulo, 16, TEXTO, true));
        txt.addView(texto(sub, 13, FRACO, false));
        linha.addView(txt, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        Switch s = new Switch(this);
        s.setEnabled(false);
        s.setOnCheckedChangeListener((CompoundButton v, boolean ligado) -> {
            if (pintando) return;
            JSONObject j = new JSONObject();
            try { j.put(campo, ligado); } catch (Exception ignorado) { }
            mandar(j, null);
        });
        linha.addView(s);
        pai.addView(linha);
        return s;
    }

    // ---------- conversa com o PC ----------
    private void mandar(JSONObject corpo, String acao) {
        Conexao c = Conexao.ler(this);
        if (c == null) return;
        new Thread(() -> {
            try {
                if (acao != null) corpo.put("acao", acao);
                JSONObject r = c.app(corpo);
                ui.post(() -> {
                    pintar(r, true);
                    if ("teste".equals(acao)) Toast.makeText(this, "Aviso de teste enviado", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception e) {
                ui.post(() -> { pintar(null, false); Toast.makeText(this, "Não alcancei o PC (mesmo Wi-Fi?)", Toast.LENGTH_LONG).show(); });
            }
        }).start();
    }

    private final Runnable laco = new Runnable() {
        @Override public void run() {
            if (!visivel || status == null) return;
            Conexao c = Conexao.ler(MainActivity.this);
            if (c == null) return;
            new Thread(() -> {
                JSONObject r = null;
                try { r = c.app(null); } catch (Exception ignorado) { }
                JSONObject fr = r;
                ui.post(() -> pintar(fr, fr != null));
            }).start();
            ui.postDelayed(this, 3000);
        }
    };

    private void atualizar() { ui.removeCallbacks(laco); ui.post(laco); }

    private void pintar(JSONObject r, boolean alcancou) {
        if (status == null) return;
        pintando = true;
        boolean ok = alcancou && r != null && r.optBoolean("ok");
        for (Switch s : new Switch[]{swAceitar, swRunas, swAvisos, swFixo}) s.setEnabled(ok);
        if (!ok) {
            status.setText("PC fora de alcance");
            status.setTextColor(VERMELHO);
            detalhe.setText("As opções mudam no mesmo Wi-Fi do PC, com o Pick Automático ligado. Os avisos continuam chegando.");
        } else {
            swAceitar.setChecked(r.optBoolean("aceitarSozinho"));
            swRunas.setChecked(r.optBoolean("puxarRunas"));
            swAvisos.setChecked(r.optBoolean("avisarCelular"));
            swFixo.setChecked(r.optBoolean("painelFixo"));
            status.setTextColor(VERDE);
            String fase = r.optString("phase", "None");
            if (!r.optBoolean("lol")) { status.setText("PC conectado"); detalhe.setText("O LoL não está aberto"); }
            else {
                status.setText(fase(fase));
                String fila = r.optString("fila", "");
                detalhe.setText(fila.isEmpty() ? "LoL aberto" : fila);
            }
        }
        pintando = false;
    }

    private static String fase(String f) {
        switch (f) {
            case "Lobby": return "No saguão";
            case "Matchmaking": return "Procurando partida";
            case "ReadyCheck": return "Partida encontrada!";
            case "ChampSelect": return "Seleção de campeões";
            case "InProgress": case "GameStart": return "Em partida";
            case "EndOfGame": case "PreEndOfGame": case "WaitingForStats": return "Fim de jogo";
            default: return "No cliente do LoL";
        }
    }

    @Override protected void onResume() { super.onResume(); visivel = true; if (status != null) atualizar(); }
    @Override protected void onPause() { super.onPause(); visivel = false; ui.removeCallbacks(laco); }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        IntentResult r = IntentIntegrator.parseActivityResult(req, res, data);
        if (r != null) { if (r.getContents() != null) conectou(Conexao.doQr(this, r.getContents())); return; }
        super.onActivityResult(req, res, data);
    }

    // ---------- pecas de tela ----------
    private TextView texto(String s, int sp, int cor, boolean negrito) {
        TextView t = new TextView(this);
        t.setText(s); t.setTextSize(sp); t.setTextColor(cor);
        if (negrito) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button botao(String s, boolean principal) {
        Button b = new Button(this);
        b.setText(s); b.setAllCaps(false); b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(principal ? Color.parseColor("#1A1408") : TEXTO);
        b.setBackground(principal ? fundo(OURO, OURO, 14) : fundo(Color.TRANSPARENT, BORDA, 14));
        b.setPadding(dp(16), dp(14), dp(16), dp(14));
        return b;
    }

    private GradientDrawable fundo(int cor, int borda, int raio) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(cor); g.setStroke(dp(1), borda); g.setCornerRadius(dp(raio));
        return g;
    }

    private LinearLayout.LayoutParams margem(int lados, int topo) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMargins(dp(lados), dp(topo), dp(lados), 0);
        return p;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
