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
  if (ok(a) && Array.isArray(a.json)) aprimoramentos = new Map(a.json.map((x) => [x.id, { nome: x.nameTRA || '', icone: x.augmentSmallIconPath || '', aram: /^ARAM_/.test(x.augmentNameId || '') }]));
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
  if (!cfg.topic) return;
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
let partida = { modo: '', champ: 0 }; // modo ARAM ('aram' ou 'desordem') e o seu campeao, guardados ate a partida acabar
const NOME_MODO = { aram: 'ARAM', desordem: 'ARAM: Desordem' };
const modoAram = () => (fila.id === 2400 || fila.gameMode === 'KIWI' ? 'desordem' : (fila.id === 450 || fila.gameMode === 'ARAM' ? 'aram' : ''));
let sessaoCS = null; // ultima sessao crua da selecao
let pegaveis = { ids: [], em: 0 };
let ultimoDump = 0;
const clientes = new Set();
let qrLido = false; // o celular ja leu o QR de ligar o ntfy
let cartasVivo = { pid: 0, em: 0 }; // ultimo sinal de vida do cartas.ps1

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
      partida = { modo: modoAram(), champ: 0 };
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
      if (partida.modo === 'desordem' && novo.cs.eu.champ && novo.cs.eu.champ !== partida.champ) {
        partida.champ = novo.cs.eu.champ;
        opgg.atualizarCampeao(partida.champ).catch((e) => deuErro('dados do op.gg', e.message));
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
    if (!emJogo) partida = { modo: '', champ: 0 };
    else if (!partida.champ && modoAram()) await acharPartida(); // o programa foi ligado com a partida ja andando
  }

  publicar(novo, restante);
  return phase === 'ChampSelect' || phase === 'ReadyCheck' ? 400 : 1500;
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
  partida = { modo: modoAram(), champ: meu.championId };
  opgg.atualizarLista(partida.modo).catch((e) => deuErro('dados do op.gg', e.message));
  if (partida.modo === 'desordem') opgg.atualizarCampeao(partida.champ).catch((e) => deuErro('dados do op.gg', e.message));
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
  if (partida.modo === 'desordem' && partida.champ) {
    const a = opgg.aprimoramentos(partida.champ);
    const it = opgg.itens(partida.champ);
    const comNome = (ids) => ids.map((id) => ({ id, nome: (itensDoJogo.get(id) || {}).nome || '' }));
    desordem = {
      nome: nome(partida.champ), doCampeao: a.doCampeao,
      // as linhas mais usadas de cada tabela: inicial e botas, uma; nucleo, tres
      itens: it ? { inicial: comNome(it.inicial[0] || []), botas: comNome((it.botas[0] || []).concat(it.botas[1] || [])), nucleo: it.nucleo.slice(0, 3).map(comNome) } : null,
      lista: a.lista.map((x) => ({ id: x.id, tier: x.tier, nome: (aprimoramentos.get(x.id) || {}).nome || x.nome })).filter((x) => x.nome),
    };
  }
  return { modo: NOME_MODO[partida.modo] || '', tituloMelhores: aram ? `Melhores campeões  ·  ${NOME_MODO[partida.modo] || 'ARAM'}` : 'Melhores para este time', leitura, melhores, desordem };
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
        return { nome: nome(id), tier: c ? c.tier : null, ordem: c ? c.lugar || 500 : 999, rotulo: c ? `T${c.tier}  ·  ${c.lugar}º` : 'sem dados' };
      }).filter((x) => x.nome),
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
      if (acao === 'teste') avisar('Teste do Pick Automático', 'Se você está lendo isto, o aviso funciona.', { priority: 4, tags: ['bell'] });
      if (acao === 'concluir') salvarConfig({ configurado: true });
      if (acao === 'auto') salvarConfig({ aceitarSozinho: url.searchParams.get('ligado') === '1' }); // botao do painel (hud.ps1)
      if (acao === 'fixo') salvarConfig({ painelFixo: url.searchParams.get('ligado') === '1' }); // clipe do painel
      if (acao === 'desligar') setTimeout(() => process.exit(0), 200); // pedido do parar.bat
      return json(res, 200, { ok: true });
    }
    return json(res, 200, {
      link: LINK, topic: cfg.topic, ntfyHost: new URL(cfg.ntfyServer).host,
      celulares: [...clientes].filter((c) => c.deFora).length,
      vincular: `${BASE}/vincular?k=${cfg.key}`, lido: qrLido,
      // para o painel do PC (hud.ps1)
      aceitarSozinho: !!cfg.aceitarSozinho, painelFixo: !!cfg.painelFixo, lol: !!estado.lol, phase: estado.phase, fila: estado.fila || '', aceito: !!estado.aceito,
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

  if (!comChave) return json(res, 403, { ok: false, erro: 'Chave errada: abra pelo link do aviso do ntfy' });

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
  console.log('  Topico do ntfy:    ' + (cfg.topic || '(desligado)'));
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
