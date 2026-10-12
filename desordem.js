'use strict';
// Dados lidos do op.gg: tier de cada campeao em ARAM e ARAM: Desordem, tier de cada aprimoramento, os melhores
// aprimoramentos e itens de cada campeao, e as runas mais usadas. Guarda em desordem-site.json.
// As listas valem 1 dia; o que e de cada campeao, 3.
const fs = require('fs');
const path = require('path');

const SITE = process.env.LOLPICK_OPGG || 'https://op.gg/lol/';
const ARQUIVO = path.join(__dirname, 'desordem-site.json');
const PAGINA = { desordem: 'modes/aram-mayhem', aram: 'modes/aram' };
const ROTA = { top: 'top', jungle: 'jungle', middle: 'mid', bottom: 'adc', utility: 'support' }; // do LoL -> do op.gg
const DIA = 24 * 3600 * 1000;

let dados = { listas: {}, porCampeao: {}, runas: {} };
try { dados = { ...dados, ...JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')) }; } catch {}
const gravar = () => { try { fs.writeFileSync(ARQUIVO, JSON.stringify(dados)); } catch {} };
const fresco = (x, prazo) => !!x && Date.now() - Date.parse(x.em) < prazo;

async function pagina(caminho) {
  const r = await fetch(SITE + caminho, {
    headers: { 'User-Agent': 'pick-automatico (github.com/jeffsaied/pick-automatico)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`o op.gg respondeu ${r.status}`);
  return r.text();
}

// o op.gg manda os dados dentro de varios <script>, em pedacos de texto; aqui viram um texto so
function carga(html) {
  let s = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) s += JSON.parse(m[1]);
  return s;
}

// a lista (JSON) que comeca em `inicio`, que termina no "[" dela
function listaEm(s, inicio) {
  const i = s.indexOf(inicio);
  if (i < 0) return [];
  const ini = i + inicio.indexOf('[');
  let nivel = 0;
  let texto = false;
  for (let j = ini; j < s.length; j++) {
    const c = s[j];
    if (texto) { if (c === '\\') j++; else if (c === '"') texto = false; continue; }
    if (c === '"') texto = true;
    else if (c === '[') nivel++;
    else if (c === ']' && --nivel === 0) { try { return JSON.parse(s.slice(ini, j + 1)); } catch { return []; } }
  }
  return [];
}

// pagina da lista de um modo -> { champs: { id: { tier, chave } }, augs: { id: { tier, nome, nota } } }
function lerLista(html) {
  const s = carga(html);
  const champs = {};
  for (const c of listaEm(s, '"champions":[{"key"')) {
    const id = c.champion_id || c.id;
    if (id && c.tier) champs[id] = { tier: c.tier, lugar: c.rank || 0, chave: c.key };
  }
  const augs = {};
  for (const a of listaEm(s, '"data":[{"id"')) {
    if (a.id && a.name) augs[a.id] = { tier: a.tier, nome: a.name, nota: a.performance || 0 };
  }
  return { champs, augs };
}

// pagina de um campeao -> ids dos aprimoramentos, do melhor para o pior
const lerCampeao = (html) => [...new Set([...carga(html).matchAll(/"metaId":(\d+),"metaType":"aram-augment"/g)].map((m) => Number(m[1])))];

// pagina de um campeao -> itens: { inicial, botas, nucleo }, cada um com as linhas da tabela (a mais usada primeiro)
function lerItens(html) {
  const s = carga(html);
  const linhas = { starter_items: [], boots: [], core_items: [] };
  let atual = null;
  for (const m of s.matchAll(/\["\$","tr","([a-z_]+?)_\d+"|"metaType":"item","metaId":(\d+)/g)) {
    if (m[1]) { atual = linhas[m[1]] ? [] : null; if (atual) linhas[m[1]].push(atual); } else if (atual) atual.push(Number(m[2]));
  }
  const cheias = (l) => l.filter((x) => x.length);
  return { inicial: cheias(linhas.starter_items), botas: cheias(linhas.boots), nucleo: cheias(linhas.core_items) };
}

// baixa a lista do modo se a guardada tiver mais de um dia
async function atualizarLista(modo) {
  const temLugar = dados.listas[modo] && Object.values(dados.listas[modo].champs).some((c) => c.lugar); // arquivo de versao antiga nao tinha
  if (!PAGINA[modo] || (temLugar && fresco(dados.listas[modo], DIA))) return;
  const lista = lerLista(await pagina(PAGINA[modo]));
  if (Object.keys(lista.champs).length < 100) throw new Error('a pagina do op.gg mudou: nao achei a lista de campeoes');
  dados.listas[modo] = { em: new Date().toISOString(), ...lista };
  gravar();
}

// baixa os aprimoramentos do campeao se os guardados tiverem mais de tres dias
async function atualizarCampeao(id) {
  if (fresco(dados.porCampeao[id], 3 * DIA) && dados.porCampeao[id].itens) return; // arquivo de versao antiga nao tinha os itens
  await atualizarLista('desordem');
  const c = dados.listas.desordem.champs[id];
  if (!c) return;
  const html = await pagina(`modes/aram-mayhem/${c.chave}/build`);
  const ids = lerCampeao(html);
  if (!ids.length) throw new Error(`a pagina do op.gg mudou: nao achei os aprimoramentos de ${c.chave}`);
  dados.porCampeao[id] = { em: new Date().toISOString(), ids, itens: lerItens(html) };
  gravar();
}

// id -> tier do campeao no modo (1 e o melhor, 5 o pior); null se ainda nao baixou
function tiers(modo) {
  const l = dados.listas[modo];
  return l ? new Map(Object.entries(l.champs).map(([id, c]) => [Number(id), c.tier])) : null;
}

// pagina de build -> a pagina de runas mais usada: { primaria, secundaria, ids } (4 da arvore principal, 2 da outra, 3 fragmentos)
function lerRunas(html) {
  const s = carga(html);
  let m = /"importClientData":\{[^}]*?"primaryStyleId":(\d+),"subStyleId":(\d+),"selectedPerkIds":\[([\d,]+)\]/.exec(s); // partida normal e ranqueada
  if (m) return { primaria: Number(m[1]), secundaria: Number(m[2]), ids: m[3].split(',').map(Number) };
  m = /"primary_rune_ids":\[([\d,]+)\],"secondary_rune_ids":\[([\d,]+)\],"stat_mod_ids":\[([\d,]+)\][^{}]*?"primary_page_id":(\d+),"secondary_page_id":(\d+)/.exec(s); // ARAM
  if (m) return { primaria: Number(m[4]), secundaria: Number(m[5]), ids: [m[1], m[2], m[3]].join(',').split(',').map(Number) };
  return null;
}

// Runas mais usadas com o campeao. modo: 'aram', 'desordem' ou '' (partida normal/ranqueada, ai vale a rota).
// apelido: o nome interno do campeao no LoL, usado se a lista do op.gg ainda nao disse como ele chama o campeao.
async function runas(modo, id, posicao, apelido) {
  const chaveGuardada = `${modo ? 'aram' : 'sr'}|${id}|${modo ? '' : posicao || ''}`;
  if (fresco(dados.runas[chaveGuardada], 3 * DIA)) return dados.runas[chaveGuardada];
  await atualizarLista('aram').catch(() => {}); // so para saber o nome do campeao no site
  const doSite = dados.listas.aram && dados.listas.aram.champs[id];
  const nome = doSite ? doSite.chave : String(apelido || '').toLowerCase();
  if (!nome) return null;
  // a Desordem nao tem pagina de runas propria: vale a do ARAM
  const caminho = modo ? `modes/aram/${nome}/build` : `champions/${nome}/build${ROTA[posicao] ? '/' + ROTA[posicao] : ''}`;
  const r = lerRunas(await pagina(caminho));
  if (!r || r.ids.length !== 9) throw new Error(`a pagina do op.gg mudou: nao achei as runas de ${nome}`);
  dados.runas[chaveGuardada] = { em: new Date().toISOString(), ...r };
  gravar();
  return dados.runas[chaveGuardada];
}

// itens mais usados com o campeao na Desordem, ou null se a pagina dele ainda nao foi baixada
const itens = (id) => (dados.porCampeao[id] && dados.porCampeao[id].itens) || null;

// tier e lugar do campeao no modo, ou null
const campeao = (modo, id) => (dados.listas[modo] && dados.listas[modo].champs[id]) || null;

// todos os aprimoramentos com tier, e o lugar de cada um na lista do campeao (0 = fora dos 10 melhores dele)
function todosAprimoramentos(id) {
  const augs = (dados.listas.desordem || { augs: {} }).augs;
  const doCampeao = (dados.porCampeao[id] || { ids: [] }).ids;
  return Object.keys(augs).map((a) => ({ id: Number(a), tier: augs[a].tier, nome: augs[a].nome, nota: augs[a].nota, lugar: doCampeao.indexOf(Number(a)) + 1 }));
}

// os melhores aprimoramentos do campeao; sem a pagina dele, os melhores no geral
function aprimoramentos(id, quantos = 10) {
  const augs = (dados.listas.desordem || { augs: {} }).augs;
  const um = (a) => (augs[a] ? { id: Number(a), tier: augs[a].tier, nome: augs[a].nome } : { id: Number(a), tier: null, nome: '' });
  const doCampeao = (dados.porCampeao[id] || { ids: [] }).ids;
  if (doCampeao.length) return { doCampeao: true, lista: doCampeao.slice(0, quantos).map(um) };
  const gerais = Object.keys(augs).sort((a, b) => augs[a].tier - augs[b].tier || augs[b].nota - augs[a].nota);
  return { doCampeao: false, lista: gerais.slice(0, quantos).map(um) };
}

module.exports = { ARQUIVO, lerLista, lerCampeao, atualizarLista, atualizarCampeao, lerItens, lerRunas, runas, tiers, campeao, itens, aprimoramentos, todosAprimoramentos };
