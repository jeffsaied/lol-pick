'use strict';
// Pick Automatico (lol-pick): le o cliente do LoL no PC, serve a pagina do celular e avisa pelo ntfy.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dica = require('./sugestao');
const site = require('./atualizar-confrontos');
const opgg = require('./desordem');

const DIR = __dirname;
const CFG_FILE = path.join(DIR, 'config.json');
const DEBUG_DIR = path.join(DIR, 'debug');

// ---------- config ----------
function loadConfig() {
  const padrao = {
    port: 8787,
    key: crypto.randomBytes(6).toString('hex'),
    ntfyServer: 'https://ntfy.sh',
    topic: 'lolpick-' + crypto.randomBytes(5).toString('hex'),
    lockfile: 'C:\\Riot Games\\League of Legends\\lockfile',
    confrontosDoSite: true, // baixa os confrontos do counterstats.net a cada 14 dias
    aceitarSozinho: true, // o botao ON/OFF do painel do PC
    painelFixo: false, // o clipe do painel: fica aberto em vez de virar bolinha
    puxarRunas: true, // monta a pagina de runas do campeao escolhido
    avisarCelular: true, // o sino: manda (ou nao) os avisos para o celular pelo ntfy
    configurado: false,
  };
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
  const final = { ...padrao, ...cfg };
  fs.writeFileSync(CFG_FILE, JSON.stringify(final, null, 2));
  if (process.env.LOLPICK_LOCKFILE) final.lockfile = process.env.LOLPICK_LOCKFILE;
  if (process.env.LOLPICK_PORT) final.port = Number(process.env.LOLPICK_PORT);
  if (process.env.LOLPICK_SEM_NTFY) final.topic = '';
  return final;
}
const cfg = loadConfig();

function salvarConfig(mudou) {
  Object.assign(cfg, mudou);
  try {
    const salvo = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    fs.writeFileSync(CFG_FILE, JSON.stringify({ ...salvo, ...mudou }, null, 2));
  } catch {}
}

function ipLocal() {
  const todos = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  const casa = todos.find((i) => /^(192\.168|10\.)/.test(i.address));
  return (casa || todos[0] || { address: '127.0.0.1' }).address;
}
const BASE = `http://${ipLocal()}:${cfg.port}`;
const LINK = `${BASE}/?k=${cfg.key}`;
const APK = path.join(DIR, 'app', 'PickAutomatico.apk'); // o app Android, quando gerado
let appVisto = 0; // ultima vez que o app falou com o PC

// ---------- cliente do LoL (LCU) ----------
let creds = null;
const agentes = { https: new https.Agent({ keepAlive: true }), http: new http.Agent({ keepAlive: true }) };

function lerLockfile() {
  try {
    const [, , port, password, protocol] = fs.readFileSync(cfg.lockfile, 'utf8').trim().split(':');
    return port ? { port: Number(port), password, protocol: protocol === 'http' ? 'http' : 'https' } : null;
  } catch { return null; }
}

// LoL instalado fora do lugar padrao: pega porta e senha da linha de comando do cliente
let doProcesso = { em: 0, v: null };
function credsDoProcesso() {
  if (Date.now() - doProcesso.em < 15000) return doProcesso.v;
  doProcesso.em = Date.now();
  const ps = "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine";
  require('child_process').execFile('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true }, (erro, saida) => {
    const porta = /--app-port=(\d+)/.exec(saida || '');
    const senha = /--remoting-auth-token=([\w-]+)/.exec(saida || '');
    doProcesso.v = porta && senha ? { port: Number(porta[1]), password: senha[1], protocol: 'https' } : null;
  });
  return doProcesso.v;
}

function lcu(method, caminho, body, bruto) {
  return new Promise((resolve) => {
    if (!creds) return resolve({ status: 0 });
    const dados = body === undefined ? null : JSON.stringify(body);
    const mod = creds.protocol === 'http' ? http : https;
    const req = mod.request({
      host: '127.0.0.1', port: creds.port, path: caminho, method,
      agent: agentes[creds.protocol], rejectUnauthorized: false,
      headers: {
        Authorization: 'Basic ' + Buffer.from('riot:' + creds.password).toString('base64'),
        Accept: bruto ? '*/*' : 'application/json',
        ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
      },
    }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes);
        if (bruto) return resolve({ status: res.statusCode, buf, tipo: res.headers['content-type'] });
        let json = null;
        try { json = buf.length ? JSON.parse(buf.toString('utf8')) : null; } catch {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', () => resolve({ status: 0 }));
    req.setTimeout(4000, () => req.destroy());
    if (dados) req.write(dados);
    req.end();
  });
}
const ok = (r) => r.status >= 200 && r.status < 300;
const resposta = (r) => (ok(r) ? { ok: true } : { ok: false, erro: (r.json && r.json.message) || (r.status ? `LoL respondeu ${r.status}` : 'LoL fechado') });

// ---------- dados fixos ----------
const FILAS = {
  400: 'Normal (Draft)', 430: 'Normal (Às Cegas)', 480: 'Swiftplay', 490: 'Quickplay',
  420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 450: 'ARAM', 2400: 'ARAM: Desordem', 900: 'URF',
};
const POS = { top: 'Topo', jungle: 'Selva', middle: 'Meio', bottom: 'Atirador', utility: 'Suporte' };

let champs = new Map(); // id -> { id, name, alias, roles }
let maestria = new Map(); // id -> pontos
const perfis = new Map(); // id -> perfil de jogo (sugestao.js); enche aos poucos, em segundo plano
let carregandoPerfis = false;
let confrontos = null; // confrontos.json ja em ids
let aprimoramentos = new Map(); // id -> { nome, icone } no idioma do cliente
const iconesAug = new Map(); // id -> { buf, tipo }
let itensDoJogo = new Map(); // id -> { nome, icone } no idioma do cliente
const iconesItem = new Map(); // id -> { buf, tipo }
const nomes = new Map(); // summonerId -> nome
const icones = new Map(); // id -> { buf, tipo }

async function carregarCampeoes() {
  const r = await lcu('GET', '/lol-game-data/assets/v1/champion-summary.json');
  if (!ok(r) || !Array.isArray(r.json)) return;
  champs = new Map(r.json.filter((c) => c.id > 0).map((c) => [c.id, { id: c.id, name: c.name, alias: c.alias || '', roles: c.roles || [] }]));
  const m = await lcu('GET', '/lol-champion-mastery/v1/local-player/champion-mastery');
  if (ok(m) && Array.isArray(m.json)) maestria = new Map(m.json.map((x) => [x.championId, x.championPoints || 0]));
  carregarConfrontos();
  carregarPerfis();
  const a = await lcu('GET', '/lol-game-data/assets/v1/cherry-augments.json');
  if (ok(a) && Array.isArray(a.json)) aprimoramentos = new Map(a.json.map((x) => [x.id, { nome: x.nameTRA || '', icone: x.augmentSmallIconPath || '', aram: /^ARAM_/.test(x.augmentNameId || ''), api: String(x.augmentNameId || '').replace(/^ARAM_/, '') }]));
  carregarDescricoes();
  const it = await lcu('GET', '/lol-game-data/assets/v1/items.json');
  if (ok(it) && Array.isArray(it.json)) itensDoJogo = new Map(it.json.map((x) => [x.id, { nome: x.name || '', icone: x.iconPath || '' }]));
}

// o do site (por rota) e o escrito a mao; qualquer um dos dois pode faltar
function carregarConfrontos() {
  const tabelas = [site.ARQUIVO, path.join(DIR, 'confrontos.json')].map((arq) => {
    try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return {}; }
  });
  confrontos = dica.lerConfrontos(tabelas, champs);
  if (confrontos.semId.length) console.log('confrontos: nome que nao e campeao:', confrontos.semId.join(', '));
}

// um pedido por campeao; a dica funciona sem isso (so por papel e maestria) e melhora quando chega
async function carregarPerfis() {
  if (carregandoPerfis) return;
  carregandoPerfis = true;
  const faltam = [...champs.keys()].filter((id) => !perfis.has(id));
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (faltam.length) {
      const id = faltam.pop();
      const r = await lcu('GET', `/lol-game-data/assets/v1/champions/${id}.json`);
      if (ok(r) && r.json) perfis.set(id, dica.perfilDe(r.json));
    }
  }));
  carregandoPerfis = false;
}

function nomeDe(p) {
  if (p.gameName) return p.gameName;
  const id = p.summonerId;
  if (!id) return '';
  if (!nomes.has(id)) {
    nomes.set(id, '');
    lcu('GET', `/lol-summoner/v1/summoners/${id}`).then((r) => {
      if (ok(r) && r.json) nomes.set(id, r.json.gameName || r.json.displayName || '');
    });
  }
  return nomes.get(id);
}

// ---------- ntfy ----------
function avisar(titulo, mensagem, extra) {
  const { sempre, ...resto } = extra || {}; // sempre: o teste do aviso manda mesmo com o sino desligado
  if (!cfg.topic || (!cfg.avisarCelular && !sempre)) return;
  extra = resto;
  fetch(cfg.ntfyServer, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: cfg.topic, title: titulo, message: mensagem, click: LINK, ...extra }),
  }).catch((e) => console.log('ntfy falhou:', e.message));
}

// ---------- versao ----------
const REPO = 'https://github.com/jeffsaied/pick-automatico';
const VERSAO_URL = process.env.LOLPICK_VERSAO_URL || 'https://raw.githubusercontent.com/jeffsaied/pick-automatico/main/versao.txt';
let VERSAO = 0;
try { VERSAO = Number(fs.readFileSync(path.join(DIR, 'versao.txt'), 'utf8')) || 0; } catch {}
let versaoNova = 0; // maior que zero: o GitHub tem versao mais nova que esta
let ultimaChecagem = 0;

// todo erro passa por aqui: se ja saiu versao mais nova, o conserto deve estar nela, entao avisa para atualizar
async function deuErro(onde, msg) {
  console.log(`erro em ${onde}: ${msg}`);
  if (versaoNova || Date.now() - ultimaChecagem < 3600000) return;
  ultimaChecagem = Date.now();
  try {
    const r = await fetch(VERSAO_URL, { signal: AbortSignal.timeout(10000) });
    const n = r.ok ? Number((await r.text()).trim()) : 0;
    if (!(n > VERSAO)) return;
    versaoNova = n;
    console.log(`ha versao nova (${n}); esta e a ${VERSAO}. Baixe em ${REPO}`);
    avisar('Atualize o Pick Automático', `Deu erro (${onde}) e já saiu uma versão mais nova. Baixe no PC.`, { priority: 4, tags: ['warning'], click: REPO });
  } catch {}
}

// ---------- estado ----------
let estado = { lol: false, phase: 'None' };
let assinatura = '';
let faseAnterior = 'None';
let fila = { id: 0, label: '', gameMode: '' };
let partida = { modo: '', champ: 0, posicao: '' }; // modo ARAM ('aram' ou 'desordem'), seu campeao e sua rota, guardados ate a partida acabar
let jogo = null; // com a partida aberta: { aliados, inimigos } em ids de campeao
let jogoEm = 0;
const NOME_MODO = { aram: 'ARAM', desordem: 'ARAM: Desordem' };

// O que cada aprimoramento faz: o cliente do LoL nao traz o texto, o CommunityDragon traz (em portugues).
// Vale 3 dias em aprimoramentos-desc.json. Os numeros sao os da Arena e podem mudar um pouco no ARAM.
const DESC_ARQ = path.join(DIR, 'aprimoramentos-desc.json');
let descricoes = {};
try { descricoes = JSON.parse(fs.readFileSync(DESC_ARQ, 'utf8')); } catch {}
function textoDoAprimoramento(a) {
  const num = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
  return String(a.desc || '')
    .replace(/@([A-Za-z0-9_]+)(\*(-?[\d.]+))?@/g, (_, nome, __, mult) => {
      const v = (a.dataValues || {})[nome];
      return Array.isArray(v) && typeof v[0] === 'number' ? num(v[0] * (mult ? Number(mult) : 1)) : '';
    })
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
async function carregarDescricoes() {
  try {
    if (descricoes.em && Date.now() - descricoes.em < 3 * 24 * 3600 * 1000) return;
    const r = await fetch('https://raw.communitydragon.org/latest/cdragon/arena/pt_br.json');
    if (!r.ok) return;
    const j = await r.json();
    const textos = {};
    for (const a of j.augments || []) if (a.apiName && a.desc) textos[a.apiName] = textoDoAprimoramento(a);
    descricoes = { em: Date.now(), textos };
    fs.writeFileSync(DESC_ARQ, JSON.stringify(descricoes));
  } catch (e) { console.log('descricoes dos aprimoramentos: ' + e.message); }
}
const descricaoDe = (id) => ((descricoes.textos || {})[(aprimoramentos.get(id) || {}).api] || '');
const modoAram = () => (fila.id === 2400 || fila.gameMode === 'KIWI' ? 'desordem' : (fila.id === 450 || fila.gameMode === 'ARAM' ? 'aram' : ''));
let sessaoCS = null; // ultima sessao crua da selecao
let pegaveis = { ids: [], em: 0 };
let ultimoDump = 0;
const clientes = new Set();
let qrLido = false; // o celular ja leu o QR de ligar o ntfy
let cartasVivo = { pid: 0, em: 0 }; // ultimo sinal de vida do cartas.ps1
let runasAlvo = { chave: '', desde: 0 }; // campeao (e rota) que esta com voce agora, e desde quando
let runasFeitas = ''; // a chave para a qual a pagina de runas ja foi montada
let runasAviso = ''; // o que o painel mostra sobre as runas

function montarSelecao(s, opcoes) {
  const eu = s.localPlayerCellId;
  const acoes = (s.actions || []).flat();
  const semAcoes = acoes.length === 0;
  const travados = new Set(acoes.filter((a) => a.type === 'pick' && a.completed).map((a) => a.actorCellId));
  const jogador = (p) => ({
    cell: p.cellId, champ: p.championId || 0, intent: p.championPickIntent || 0,
    name: nomeDe(p) || '', pos: POS[p.assignedPosition] || '', me: p.cellId === eu,
    locked: semAcoes ? !!p.championId : travados.has(p.cellId),
  });
  const meuTime = (s.myTeam || []).map(jogador);
  const inimigos = (s.theirTeam || []).map(jogador);

  const bans = { meus: new Set(s.bans && s.bans.myTeamBans), deles: new Set(s.bans && s.bans.theirTeamBans) };
  const fora = new Set();
  for (const a of acoes) {
    if (!a.completed || !a.championId) continue;
    fora.add(a.championId);
    if (a.type === 'ban') (a.isAllyAction ? bans.meus : bans.deles).add(a.championId);
  }
  for (const b of [...bans.meus, ...bans.deles]) fora.add(b);
  fora.delete(0);

  const minhas = acoes.filter((a) => a.actorCellId === eu && !a.completed);
  const atual = minhas.find((a) => a.isInProgress);
  const plano = atual ? null : minhas.find((a) => a.type === 'pick');
  const acao = (a) => (a ? { id: a.id, type: a.type, champ: a.championId || 0 } : null);

  const aram = !!s.benchEnabled || ['ARAM', 'KIWI'].includes(fila.gameMode);
  const banco = (s.benchChampions || []).map((b) => b.championId);
  const mim = meuTime.find((p) => p.me) || { champ: 0, locked: false };
  // sem lista de cartas: se o LoL so deixa pegar um punhado de campeoes, esse punhado sao as cartas (palpite)
  if (aram && !(opcoes || []).length && pegaveis.ids.length && pegaveis.ids.length <= 10) opcoes = pegaveis.ids;
  const noTime = new Set(meuTime.map((p) => p.champ));
  const ops = (opcoes || []).filter((id) => !noTime.has(id) && !banco.includes(id));
  const pool = aram ? [...new Set([...ops, ...banco])] : (pegaveis.ids.length ? pegaveis.ids : [...champs.keys()]).filter((id) => !fora.has(id));

  return {
    mode: aram ? 'aram' : 'draft',
    meuTime, inimigos,
    bans: { meus: [...bans.meus].filter(Boolean), deles: [...bans.deles].filter(Boolean) },
    fora: [...fora], pegaveis: pegaveis.ids,
    acao: acao(atual), plano: acao(plano),
    eu: { champ: mim.champ, locked: mim.locked },
    banco, opcoes: ops, rerolls: s.rerollsRemaining || 0,
    // ARAM: a colocacao de cada campeao no ranking do modo (op.gg), para mostrar em cima da foto
    lugares: aram ? Object.fromEntries(pool.map((id) => [id, (opgg.campeao(partida.modo, id) || {}).lugar || 0])) : {},
    sugestao: mim.locked && !aram ? { falta: [], leitura: [], champs: [], motivos: {} } : dica.sugerir({
      aliados: meuTime.filter((p) => !p.me).map((p) => p.champ || p.intent).filter(Boolean),
      inimigos: inimigos.map((p) => p.champ).filter(Boolean),
      pool, posicao: ((s.myTeam || []).find((p) => p.cellId === eu) || {}).assignedPosition || '',
      champs, perfis, maestria, confrontos,
      tiers: aram ? opgg.tiers(partida.modo) : null, ondeTier: NOME_MODO[partida.modo] || '',
    }),
    timerFase: (s.timer && s.timer.phase) || '',
  };
}

function publicar(novo, restante) {
  if (versaoNova) novo.atualizar = REPO;
  estado = novo;
  const sig = JSON.stringify(novo);
  if (sig === assinatura) return;
  assinatura = sig;
  const msg = `data: ${JSON.stringify({ ...novo, left: restante || 0 })}\n\n`;
  for (const c of clientes) c.write(msg);
}

async function ciclo() {
  creds = lerLockfile() || (process.env.LOLPICK_LOCKFILE ? null : credsDoProcesso());
  const f = creds ? await lcu('GET', '/lol-gameflow/v1/gameflow-phase') : { status: 0 };
  if (!ok(f) || typeof f.json !== 'string') {
    champs = new Map();
    faseAnterior = 'None';
    publicar({ lol: false, phase: 'None' });
    return 2000;
  }
  const phase = f.json;
  if (!champs.size) await carregarCampeoes();

  if (phase !== faseAnterior || (!fila.id && phase !== 'None')) {
    const g = await lcu('GET', '/lol-gameflow/v1/session');
    const q = (ok(g) && g.json && g.json.gameData && g.json.gameData.queue) || {};
    fila = { id: q.id || 0, gameMode: q.gameMode || '', label: FILAS[q.id] || q.description || q.gameMode || '' };
  }
  if (phase !== faseAnterior) {
    if (phase === 'ReadyCheck') {
      if (cfg.aceitarSozinho) avisar('Partida encontrada e aceita', fila.label || 'Aceita sozinho pelo PC', { priority: 5, tags: ['crossed_swords'] });
      else {
        avisar('Partida encontrada!', fila.label || 'Toque para aceitar', {
          priority: 5, tags: ['crossed_swords'],
          actions: [{ action: 'http', label: 'Aceitar', url: `${BASE}/api/accept?k=${cfg.key}`, method: 'POST' }],
        });
      }
    }
    if (phase === 'ChampSelect') {
      pegaveis = { ids: [], em: 0 };
      partida = { modo: modoAram(), champ: 0, posicao: '' };
      jogo = null;
      runasFeitas = ''; runasAviso = ''; runasAlvo = { chave: '', desde: 0 };
      if (partida.modo) opgg.atualizarLista(partida.modo).catch((e) => deuErro('dados do op.gg', e.message));
      if (perfis.size < champs.size) carregarPerfis();
      avisar('Seleção de campeões', `${fila.label} — toque para abrir`, { priority: 4, tags: ['video_game'] });
    }
    faseAnterior = phase;
  }

  const novo = { lol: true, phase, fila: fila.label, nChamps: champs.size };
  let restante = 0;

  if (phase === 'ReadyCheck') {
    const r = await lcu('GET', '/lol-matchmaking/v1/ready-check');
    novo.aceito = !!(ok(r) && r.json && r.json.playerResponse === 'Accepted');
    if (cfg.aceitarSozinho && ok(r) && r.json && r.json.playerResponse === 'None') novo.aceito = (await comandos.accept()).ok;
  }

  if (phase === 'ChampSelect') {
    const r = await lcu('GET', '/lol-champ-select/v1/session');
    if (ok(r) && r.json) {
      sessaoCS = r.json;
      if (Date.now() - pegaveis.em > 5000) {
        const p = await lcu('GET', '/lol-champ-select/v1/pickable-champion-ids');
        pegaveis = { ids: ok(p) && Array.isArray(p.json) ? p.json : pegaveis.ids, em: Date.now() };
      }
      // opcoes do ARAM (cartas): endpoint nao confirmado, por isso tolera qualquer resposta
      let opcoes = [];
      if (sessaoCS.benchEnabled) {
        const o = await lcu('GET', '/lol-champ-select/v1/subset-champion-list');
        if (ok(o) && Array.isArray(o.json)) opcoes = o.json.filter((x) => typeof x === 'number' && x > 0);
      }
      novo.cs = montarSelecao(sessaoCS, opcoes);
      // runas: no ARAM o campeao muda a toda hora, entao espera ele parar uns segundos; nos outros modos, so ao travar
      const alvo = novo.cs.mode === 'aram' ? novo.cs.eu.champ : (novo.cs.eu.locked ? novo.cs.eu.champ : 0);
      const posicao = ((sessaoCS.myTeam || []).find((p) => p.cellId === sessaoCS.localPlayerCellId) || {}).assignedPosition || '';
      const chaveRunas = alvo ? `${alvo}|${posicao}` : '';
      if (chaveRunas !== runasAlvo.chave) runasAlvo = { chave: chaveRunas, desde: Date.now() };
      if (cfg.puxarRunas && chaveRunas && chaveRunas !== runasFeitas && Date.now() - runasAlvo.desde > (novo.cs.mode === 'aram' ? 2500 : 0)) {
        runasFeitas = chaveRunas;
        puxarRunas(alvo, posicao).catch((e) => { runasAviso = 'Runas: não consegui buscar'; deuErro('runas do op.gg', e.message); });
      }
      partida.posicao = posicao;
      if (novo.cs.eu.champ && novo.cs.eu.champ !== partida.champ) {
        partida.champ = novo.cs.eu.champ;
        if (partida.modo === 'desordem') opgg.atualizarCampeao(partida.champ).catch((e) => deuErro('dados do op.gg', e.message));
      }
      restante = (sessaoCS.timer && sessaoCS.timer.adjustedTimeLeftInPhase) || 0;
      if (Date.now() - ultimoDump > 5000) {
        ultimoDump = Date.now();
        try {
          fs.mkdirSync(DEBUG_DIR, { recursive: true });
          fs.writeFileSync(path.join(DEBUG_DIR, `sessao-fila${fila.id}.json`), JSON.stringify({ fila, opcoes, sessao: sessaoCS }, null, 2));
        } catch {}
      }
    }
  } else {
    sessaoCS = null;
    const emJogo = ['GameStart', 'InProgress', 'Reconnect'].includes(phase);
    if (!emJogo) { partida = { modo: '', champ: 0, posicao: '' }; jogo = null; }
    else {
      if (!partida.champ) await acharPartida(); // o programa foi ligado com a partida ja andando
      if (!jogo || !jogo.avisado) await lerJogo(); // continua lendo ate o mapa aparecer, para avisar na hora certa
    }
  }

  const aoVivo = resumoDoJogo();
  if (aoVivo) novo.jogo = aoVivo;
  publicar(novo, restante);
  return phase === 'ChampSelect' || phase === 'ReadyCheck' ? 400 : 1500;
}

// Monta no cliente a pagina de runas mais usada com o campeao. So mexe na pagina que o proprio programa criou
// (nome comecando por "Pick Automático"); as paginas da pessoa nunca sao apagadas.
async function puxarRunas(champ, posicao) {
  const c = champs.get(champ);
  if (!c) return;
  const r = await opgg.runas(partida.modo, champ, posicao, c.alias);
  if (!r) return;
  const pags = await lcu('GET', '/lol-perks/v1/pages');
  if (!ok(pags) || !Array.isArray(pags.json)) { runasAviso = 'Runas: o LoL não respondeu'; return; }
  for (const p of pags.json.filter((x) => String(x.name || '').startsWith('Pick Automático'))) await lcu('DELETE', `/lol-perks/v1/pages/${p.id}`);
  const nova = await lcu('POST', '/lol-perks/v1/pages', {
    name: `Pick Automático: ${c.name}`, primaryStyleId: r.primaria, subStyleId: r.secundaria, selectedPerkIds: r.ids, current: true,
  });
  runasAviso = ok(nova) ? `Runas de ${c.name} prontas` : 'Runas: sem espaço — apague uma página de runas no LoL';
  console.log(runasAviso + (ok(nova) ? '' : ` (${(nova.json && nova.json.message) || nova.status})`));
}

// sem ter visto a selecao: o modo vem da fila e o seu campeao, da lista de escolhas da partida
async function acharPartida() {
  const g = await lcu('GET', '/lol-gameflow/v1/session');
  const eu = await lcu('GET', '/lol-summoner/v1/current-summoner');
  if (!ok(g) || !ok(eu) || !g.json || !eu.json) return;
  const dados = g.json.gameData || {};
  const todos = [...(dados.playerChampionSelections || []), ...(dados.teamOne || []), ...(dados.teamTwo || [])];
  const meu = todos.find((p) => p.puuid && p.puuid === eu.json.puuid && p.championId);
  if (!meu) return;
  partida = { modo: modoAram(), champ: meu.championId, posicao: String(meu.selectedPosition || '').toLowerCase() };
  if (partida.modo) opgg.atualizarLista(partida.modo).catch((e) => deuErro('dados do op.gg', e.message));
  if (partida.modo === 'desordem') opgg.atualizarCampeao(partida.champ).catch((e) => deuErro('dados do op.gg', e.message));
}

// O jogo aberto conta quem esta na partida numa porta local propria (a "Live Client Data" da Riot), so depois de carregar.
function doJogo(caminho) {
  return new Promise((resolve) => {
    const base = new URL(process.env.LOLPICK_AOVIVO || 'https://127.0.0.1:2999');
    const req = (base.protocol === 'http:' ? http : https).get({ host: base.hostname, port: base.port, path: caminho, rejectUnauthorized: false }, (res) => {
      let txt = '';
      res.on('data', (c) => { txt += c; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(txt) : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(1500, () => req.destroy());
  });
}

// quem esta na partida: tenta a cada 4 s ate o jogo responder, e ai avisa no celular
async function lerJogo() {
  if (Date.now() - jogoEm < 4000) return;
  jogoEm = Date.now();
  const lista = await doJogo('/liveclientdata/playerlist');
  const meuNome = await doJogo('/liveclientdata/activeplayername');
  if (!Array.isArray(lista) || !lista.length || typeof meuNome !== 'string') return;
  const porApelido = new Map();
  for (const c of champs.values()) if (c.alias && !porApelido.has(c.alias.toLowerCase())) porApelido.set(c.alias.toLowerCase(), c.id);
  const idDe = (p) => porApelido.get(String(p.rawChampionName || '').split('_').pop().toLowerCase()) || 0;
  const eu = lista.find((p) => [p.riotId, p.summonerName, `${p.riotIdGameName}#${p.riotIdTagLine}`].includes(meuNome));
  if (!eu) return;
  if (!partida.champ) partida.champ = idDe(eu);
  const jaTinha = !!jogo;
  jogo = {
    aliados: lista.filter((p) => p.team === eu.team && p !== eu).map(idDe).filter(Boolean),
    inimigos: lista.filter((p) => p.team !== eu.team).map(idDe).filter(Boolean),
    avisado: false,
  };
  // a lista de jogadores ja responde na tela de carregamento; o aviso so sai quando o mapa aparece (evento GameStart)
  const eventos = await doJogo('/liveclientdata/eventdata');
  const noMapa = !!(eventos && Array.isArray(eventos.Events) && eventos.Events.some((e) => e.EventName === 'GameStart'));
  const nome = (id) => (champs.get(id) || { name: '' }).name;
  // runas e itens do campeao, caso a selecao tenha sido pulada (Swiftplay) ou o programa tenha ligado depois
  const c = champs.get(partida.champ);
  if (c && !jaTinha) opgg.runas(partida.modo, partida.champ, partida.posicao, c.alias).catch((e) => deuErro('dados do op.gg', e.message));
  if (!noMapa) return;
  jogo.avisado = true;
  avisar('No mapa: partida começou', `Você de ${nome(partida.champ) || '?'} contra ${jogo.inimigos.map(nome).join(', ') || '?'}`, { priority: 3, tags: ['video_game'] });
}

// a partida em poucas linhas, para o painel do PC e a pagina do celular; null fora de partida
function resumoDoJogo() {
  if (!jogo || !['GameStart', 'InProgress', 'Reconnect'].includes(faseAnterior)) return null;
  const nome = (id) => (champs.get(id) || { name: '' }).name;
  const rotas = ['', partida.posicao || '*'];
  const ganha = (a, b) => !!confrontos && rotas.some((r) => confrontos.vence.has(`${r}|${a}>${b}`));
  const eu = partida.champ;
  return {
    eu: { id: eu, nome: nome(eu) },
    inimigos: jogo.inimigos.map((id) => ({ id, nome: nome(id) })),
    leitura: dica.descrever(jogo.inimigos, champs, perfis),
    cuidado: jogo.inimigos.filter((e) => ganha(e, eu) && !ganha(eu, e)).map(nome),
    vantagem: jogo.inimigos.filter((e) => ganha(eu, e) && !ganha(e, eu)).map(nome),
  };
}

async function laco() {
  let espera = 2000;
  try { espera = await ciclo(); } catch (e) { deuErro('leitura do LoL', e.message); }
  setTimeout(laco, espera);
}

// ---------- comandos vindos do celular ----------
function minhaAcao(emAndamento) {
  if (!sessaoCS) return null;
  const minhas = (sessaoCS.actions || []).flat().filter((a) => a.actorCellId === sessaoCS.localPlayerCellId && !a.completed);
  const atual = minhas.find((a) => a.isInProgress);
  return atual || (emAndamento ? null : minhas.find((a) => a.type === 'pick')) || null;
}

const comandos = {
  async accept() {
    return resposta(await lcu('POST', '/lol-matchmaking/v1/ready-check/accept'));
  },
  async hover({ championId }) {
    const a = minhaAcao(false);
    if (!a) return { ok: false, erro: 'Não é sua vez' };
    return resposta(await lcu('PATCH', `/lol-champ-select/v1/session/actions/${a.id}`, { championId }));
  },
  async lock({ championId }) {
    const a = minhaAcao(true);
    if (!a) return { ok: false, erro: 'Não é sua vez' };
    const r = await lcu('PATCH', `/lol-champ-select/v1/session/actions/${a.id}`, { championId });
    if (!ok(r)) return resposta(r);
    return resposta(await lcu('POST', `/lol-champ-select/v1/session/actions/${a.id}/complete`, {}));
  },
  async swap({ championId }) {
    if (!sessaoCS) return { ok: false, erro: 'Fora da seleção' };
    const noBanco = (sessaoCS.benchChampions || []).some((b) => b.championId === championId);
    const a = minhaAcao(true);
    if (!noBanco && a) return comandos.lock({ championId });
    return resposta(await lcu('POST', `/lol-champ-select/v1/session/bench/swap/${championId}`));
  },
  async reroll() {
    return resposta(await lcu('POST', '/lol-champ-select/v1/session/my-selection/reroll'));
  },
};

// o que o painel do PC mostra: na selecao, os melhores campeoes para o time (em qualquer modo); na Desordem, itens e aprimoramentos
function paraOPainel() {
  const nome = (id) => (champs.get(id) || { name: '' }).name;
  const cs = estado.phase === 'ChampSelect' && estado.cs ? estado.cs : null;
  const aram = !!cs && cs.mode === 'aram';
  let melhores = [];
  if (aram) {
    melhores = cs.sugestao.champs.filter((id) => cs.sugestao.motivos[id])
      .filter((id) => ((opgg.campeao(partida.modo, id) || {}).tier || 3) <= 3) // fraco no modo nao entra em "melhores"
      .slice(0, 4).map((id) => ({ id, nome: nome(id), motivo: cs.sugestao.motivos[id].join(', ') }));
  } else if (cs) {
    // nos outros modos e a mesma dica do celular: time, adversario, rota e maestria
    melhores = cs.sugestao.champs.slice(0, 5)
      .map((id) => ({ id, nome: nome(id), motivo: (cs.sugestao.motivos[id] || ['dos seus mais jogados']).join(', ') }));
  }
  const leitura = cs && !aram ? [...(cs.sugestao.falta.length ? ['Falta: ' + cs.sugestao.falta.join(', ')] : []), ...cs.sugestao.leitura].join(' · ') : '';
  let desordem = null;
  // itens mais usados com o seu campeao: na Desordem, os do modo; nos outros, os da pagina de build (por rota)
  const comNome = (ids) => ids.slice(0, 4).map((id) => ({ id, nome: (itensDoJogo.get(id) || {}).nome || '' }));
  const it = !partida.champ ? null : (partida.modo === 'desordem' ? opgg.itens(partida.champ) : (opgg.guardado(partida.modo, partida.champ, partida.posicao) || {}).itens);
  // as linhas mais usadas de cada tabela: inicial e botas, uma; nucleo, tres
  const itens = it && it.nucleo.length ? {
    titulo: `Itens mais usados  ·  ${nome(partida.champ)}`,
    inicial: comNome(it.inicial[0] || []), botas: comNome((it.botas[0] || []).concat(it.botas[1] || [])), nucleo: it.nucleo.slice(0, 3).map(comNome),
  } : null;
  if (partida.modo === 'desordem' && partida.champ) {
    const a = opgg.aprimoramentos(partida.champ);
    desordem = {
      nome: nome(partida.champ), doCampeao: a.doCampeao,
      lista: a.lista.map((x) => ({ id: x.id, tier: x.tier, nome: (aprimoramentos.get(x.id) || {}).nome || x.nome, desc: descricaoDe(x.id) })).filter((x) => x.nome),
    };
  }
  return { modo: NOME_MODO[partida.modo] || '', tituloMelhores: aram ? `Melhores campeões  ·  ${NOME_MODO[partida.modo] || 'ARAM'}` : 'Melhores para este time', leitura, melhores, desordem, itens, jogo: resumoDoJogo() };
}

// as cartas que podem estar na tela agora, com a nota de cada uma: o cartas.ps1 le os nomes na tela e desenha por cima
function cartasNaTela() {
  const nome = (id) => (champs.get(id) || { name: '' }).name;
  const cs = estado.phase === 'ChampSelect' && estado.cs && estado.cs.mode === 'aram' ? estado.cs : null;
  if (cs && partida.modo) {
    const ids = [...new Set([cs.eu.champ, ...cs.opcoes, ...cs.banco].filter(Boolean))];
    return {
      tipo: 'campeoes',
      itens: ids.map((id) => {
        const c = opgg.campeao(partida.modo, id);
        return { nome: nome(id), tier: c ? c.tier : null, ordem: c ? c.lugar || 500 : 999, rotulo: c ? `T${c.tier}  ·  ${c.lugar}º` : 'sem dados', eu: id === cs.eu.champ };
      }).filter((x) => x.nome),
      // os icones do banco (fileira de cima), na ordem da tela: o numero de cada um no ranking do modo
      banco: cs.banco.map((id) => {
        const c = opgg.campeao(partida.modo, id);
        return { rotulo: c && c.lugar ? `${c.lugar}º` : '—', tier: c ? c.tier : null };
      }),
    };
  }
  if (partida.modo === 'desordem' && ['GameStart', 'InProgress', 'Reconnect'].includes(estado.phase)) {
    const doCampeao = nome(partida.champ);
    const comNota = opgg.todosAprimoramentos(partida.champ);
    const temNota = new Set(comNota.map((a) => a.id));
    // os do modo que o op.gg ainda nao avaliou entram sem nota, para a carta ser reconhecida mesmo assim
    const semNota = [...aprimoramentos].filter(([id, a]) => a.aram && a.nome && !temNota.has(id))
      .map(([, a]) => ({ nome: a.nome, tier: null, ordem: 900, rotulo: 'sem nota' }));
    return {
      tipo: 'aprimoramentos',
      itens: semNota.concat(comNota.map((a) => {
        const tier = a.tier === 0 ? 'OP' : `T${a.tier}`;
        return {
          nome: (aprimoramentos.get(a.id) || {}).nome || a.nome, tier: a.tier,
          // primeiro os 10 melhores do campeao, na ordem; depois o resto, pelo tier geral
          ordem: a.lugar || 100 + a.tier * 100 - a.nota,
          rotulo: a.lugar ? `${tier}  ·  ${a.lugar}º do ${doCampeao}` : tier,
        };
      })),
    };
  }
  return { tipo: '', itens: [] };
}

// ---------- servidor da pagina ----------
function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function lerCorpo(req) {
  return new Promise((resolve) => {
    let txt = '';
    req.on('data', (c) => { txt += c; if (txt.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(txt ? JSON.parse(txt) : {}); } catch { resolve({}); } });
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const rota = url.pathname;
  const comChave = url.searchParams.get('k') === cfg.key;

  if (rota === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(DIR, 'index.html')));
  }

  const iconeApp = rota.match(/^\/(icone-(?:192|512)\.png)$/);
  if (iconeApp) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return res.end(fs.readFileSync(path.join(DIR, iconeApp[1])));
  }

  const icone = rota.match(/^\/icon\/(\d+)$/);
  if (icone) {
    const id = Number(icone[1]);
    if (!icones.has(id)) {
      const r = await lcu('GET', `/lol-game-data/assets/v1/champion-icons/${id}.png`, undefined, true);
      if (ok(r)) icones.set(id, { buf: r.buf, tipo: r.tipo || 'image/png' });
    }
    const img = icones.get(id);
    if (!img) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': img.tipo, 'Cache-Control': 'public, max-age=86400' });
    return res.end(img.buf);
  }

  const iconeAug = rota.match(/^\/(aug|item)\/(\d+)$/);
  if (iconeAug) {
    const id = Number(iconeAug[2]);
    const [dados, guardados] = iconeAug[1] === 'aug' ? [aprimoramentos, iconesAug] : [itensDoJogo, iconesItem];
    const a = dados.get(id);
    if (!guardados.has(id) && a && a.icone) {
      const r = await lcu('GET', a.icone, undefined, true);
      if (ok(r)) guardados.set(id, { buf: r.buf, tipo: r.tipo || 'image/png' });
    }
    const img = guardados.get(id);
    if (!img) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': img.tipo, 'Cache-Control': 'public, max-age=86400' });
    return res.end(img.buf);
  }

  // tela de configuracao: so abre no proprio PC
  const noPC = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (noPC && rota === '/pc') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(path.join(DIR, 'pc.html')));
  }
  if (noPC && rota === '/qrcode.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(DIR, 'vendor', 'qrcode.js')));
  }
  if (noPC && rota === '/api/cartas') {
    const pid = Number(url.searchParams.get('pid'));
    if (pid) cartasVivo = { pid, em: Date.now() };
    return json(res, 200, cartasNaTela());
  }
  if (noPC && rota === '/api/pc') {
    if (req.method === 'POST') {
      const acao = url.searchParams.get('acao');
      if (acao === 'teste') avisar('Teste do Pick Automático', 'Se você está lendo isto, o aviso funciona.', { priority: 4, tags: ['bell'], sempre: true });
      if (acao === 'concluir') salvarConfig({ configurado: true });
      if (acao === 'auto') salvarConfig({ aceitarSozinho: url.searchParams.get('ligado') === '1' }); // botao do painel (hud.ps1)
      if (acao === 'fixo') salvarConfig({ painelFixo: url.searchParams.get('ligado') === '1' }); // clipe do painel
      if (acao === 'runas') salvarConfig({ puxarRunas: url.searchParams.get('ligado') === '1' });
      if (acao === 'celular') salvarConfig({ avisarCelular: url.searchParams.get('ligado') === '1' }); // o sino do painel
      if (acao === 'desligar') setTimeout(() => process.exit(0), 200); // pedido do parar.bat
      return json(res, 200, { ok: true });
    }
    return json(res, 200, {
      link: LINK, topic: cfg.topic, ntfyHost: new URL(cfg.ntfyServer).host,
      celulares: [...clientes].filter((c) => c.deFora).length,
      vincular: `${BASE}/vincular?k=${cfg.key}`, lido: qrLido,
      // QR do app Pick Automatico (Android): o app le e guarda tudo para falar com este PC e com o ntfy
      conectarApp: `pickauto://conectar?u=${encodeURIComponent(BASE)}&k=${cfg.key}&t=${cfg.topic}&s=${encodeURIComponent(cfg.ntfyServer)}`,
      baixarApp: fs.existsSync(APK) ? `${BASE}/app.apk?k=${cfg.key}` : '', appVisto: !!appVisto,
      // para o painel do PC (hud.ps1)
      aceitarSozinho: !!cfg.aceitarSozinho, painelFixo: !!cfg.painelFixo, puxarRunas: !!cfg.puxarRunas, avisarCelular: !!cfg.avisarCelular, runas: estado.phase === 'ChampSelect' ? runasAviso : '', lol: !!estado.lol, phase: estado.phase, fila: estado.fila || '', aceito: !!estado.aceito,
      pagina: `http://localhost:${cfg.port}/?k=${cfg.key}`,
      ...paraOPainel(),
    });
  }

  // o QR do passo 2 passa por aqui: assim o PC sabe que foi lido, e a camera so precisa abrir um link comum
  if (rota === '/vincular' && comChave) {
    qrLido = true;
    const alvo = `ntfy://${new URL(cfg.ntfyServer).host}/${cfg.topic}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ligar o ntfy</title>
<body style="margin:0;padding:32px 20px;background:#0a1018;color:#e8e3d5;font:17px/1.45 system-ui,sans-serif;text-align:center">
<h1 style="font-size:24px">Ligar o ntfy a este PC</h1>
<p><a href="${alvo}" style="display:block;padding:18px;border-radius:14px;background:#c8aa6e;color:#1a1408;font-weight:800;text-decoration:none">ABRIR NO NTFY</a></p>
<p style="color:#8696a8">Se não abrir: no ntfy toque em + e digite o tópico</p>
<p><code style="font-size:18px;user-select:all">${cfg.topic}</code></p>
<script>location.href = ${JSON.stringify(alvo)};</script></body></html>`);
  }

  if (!comChave) return json(res, 403, { ok: false, erro: 'Chave errada: abra pelo app ou pelo QR do PC' });

  if (rota === '/manifest.webmanifest') {
    return json(res, 200, {
      name: 'Pick Automático', short_name: 'Pick Automático',
      icons: [192, 512].map((n) => ({ src: `/icone-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any maskable' })), start_url: `/?k=${cfg.key}`,
      display: 'standalone', background_color: '#0a1018', theme_color: '#0a1018',
    });
  }

  if (rota === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const restante = (sessaoCS && sessaoCS.timer && sessaoCS.timer.adjustedTimeLeftInPhase) || 0;
    res.write(`data: ${JSON.stringify({ ...estado, left: restante })}\n\n`);
    res.deFora = !noPC;
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
    return;
  }

  if (rota === '/api/champions') return json(res, 200, [...champs.values()]);

  // o app Android: baixar o .apk e ler/mudar as mesmas opcoes do painel do PC
  if (rota === '/app.apk') {
    if (!fs.existsSync(APK)) return json(res, 404, { ok: false, erro: 'O app ainda nao foi gerado neste PC' });
    res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="PickAutomatico.apk"' });
    return res.end(fs.readFileSync(APK));
  }
  if (rota === '/api/app') {
    appVisto = Date.now();
    if (req.method === 'POST') {
      const corpo = await lerCorpo(req);
      if (corpo.acao === 'teste') avisar('Teste do Pick Automático', 'Se você está lendo isto, o app recebe os avisos.', { priority: 4, tags: ['bell'], sempre: true });
      const mudou = {};
      for (const k of ['aceitarSozinho', 'puxarRunas', 'avisarCelular', 'painelFixo']) if (typeof corpo[k] === 'boolean') mudou[k] = corpo[k];
      if (Object.keys(mudou).length) salvarConfig(mudou);
    }
    return json(res, 200, {
      ok: true, versao: VERSAO, aceitarSozinho: !!cfg.aceitarSozinho, puxarRunas: !!cfg.puxarRunas, avisarCelular: !!cfg.avisarCelular, painelFixo: !!cfg.painelFixo,
      lol: !!estado.lol, phase: estado.phase, fila: estado.fila || '', aceito: !!estado.aceito, pagina: LINK,
    });
  }

  // o sino da pagina do celular: liga/desliga os avisos pelo ntfy
  if (rota === '/api/celular') {
    if (req.method === 'POST') salvarConfig({ avisarCelular: !!(await lerCorpo(req)).ligado });
    return json(res, 200, { ok: true, ligado: !!cfg.avisarCelular });
  }

  const cmd = rota.match(/^\/api\/(\w+)$/);
  if (cmd && req.method === 'POST' && Object.prototype.hasOwnProperty.call(comandos, cmd[1])) {
    const corpo = await lerCorpo(req);
    const id = Number(corpo.championId);
    if (['hover', 'lock', 'swap'].includes(cmd[1]) && !(id > 0)) return json(res, 400, { ok: false, erro: 'Campeão inválido' });
    return json(res, 200, await comandos[cmd[1]]({ championId: id }));
  }

  json(res, 404, { ok: false, erro: 'Não existe' });
});

setInterval(() => { for (const c of clientes) c.write(': ping\n\n'); }, 20000);

servidor.listen(cfg.port, '0.0.0.0', () => {
  console.log('Pick Automatico ligado.');
  console.log('  Pagina do celular: ' + LINK);
  console.log('  Canal dos avisos:  ' + (cfg.topic || '(desligado)'));
  avisar('Pick Automático ligado', 'Toque para abrir a página no celular', { priority: 2, tags: ['white_check_mark'] });
  if ((!cfg.configurado || process.env.LOLPICK_CONFIGURAR) && !process.env.LOLPICK_SEM_NTFY) {
    require('child_process').exec(`start "" "http://localhost:${cfg.port}/pc"`);
  }
  laco();
  // painel no canto da tela do PC (botao de aceitar sozinho) e as notas por cima das cartas
  if (!process.env.LOLPICK_SEM_HUD) {
    const abrir = (ps1) => require('child_process').spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(DIR, ps1), '-Porta', String(cfg.port)],
      { windowsHide: true, stdio: 'ignore' }).unref(); // sem "detached": sem console o PowerShell fecha na hora
    abrir('hud.ps1');
    abrir('cartas.ps1');
    // o cartas.ps1 da sinal de vida a cada 3 s; se sumir (travou ou caiu), fecha o que sobrou e abre outro
    setInterval(() => {
      if (!cartasVivo.em || Date.now() - cartasVivo.em < 20000) return;
      try { process.kill(cartasVivo.pid); } catch {}
      cartasVivo = { pid: 0, em: 0 };
      console.log('cartas.ps1 parou de responder: reabrindo');
      abrir('cartas.ps1');
    }, 10000);
  }
  if (cfg.confrontosDoSite && !process.env.LOLPICK_SEM_SITE) {
    site.atualizarSePreciso(console.log).then((novo) => { if (novo && champs.size) carregarConfrontos(); })
      .catch((e) => deuErro('download dos confrontos', e.message));
  }
});
