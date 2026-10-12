'use strict';
// Dados de ARAM e ARAM: Desordem lidos do op.gg: tier de cada campeao, tier de cada aprimoramento e os melhores
// aprimoramentos de cada campeao. Guarda em desordem-site.json. As listas valem 1 dia; a de cada campeao, 3.
const fs = require('fs');
const path = require('path');

const SITE = process.env.LOLPICK_OPGG || 'https://op.gg/lol/modes/';
const ARQUIVO = path.join(__dirname, 'desordem-site.json');
const PAGINA = { desordem: 'aram-mayhem', aram: 'aram' };
const DIA = 24 * 3600 * 1000;

let dados = { listas: {}, porCampeao: {} };
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
    if (id && c.tier) champs[id] = { tier: c.tier, chave: c.key };
  }
  const augs = {};
  for (const a of listaEm(s, '"data":[{"id"')) {
    if (a.id && a.name) augs[a.id] = { tier: a.tier, nome: a.name, nota: a.performance || 0 };
  }
  return { champs, augs };
}

// pagina de um campeao -> ids dos aprimoramentos, do melhor para o pior
const lerCampeao = (html) => [...new Set([...carga(html).matchAll(/"metaId":(\d+),"metaType":"aram-augment"/g)].map((m) => Number(m[1])))];

// baixa a lista do modo se a guardada tiver mais de um dia
async function atualizarLista(modo) {
  if (!PAGINA[modo] || fresco(dados.listas[modo], DIA)) return;
  const lista = lerLista(await pagina(PAGINA[modo]));
  if (Object.keys(lista.champs).length < 100) throw new Error('a pagina do op.gg mudou: nao achei a lista de campeoes');
  dados.listas[modo] = { em: new Date().toISOString(), ...lista };
  gravar();
}

// baixa os aprimoramentos do campeao se os guardados tiverem mais de tres dias
async function atualizarCampeao(id) {
  if (fresco(dados.porCampeao[id], 3 * DIA)) return;
  await atualizarLista('desordem');
  const c = dados.listas.desordem.champs[id];
  if (!c) return;
  const ids = lerCampeao(await pagina(`aram-mayhem/${c.chave}/build`));
  if (!ids.length) throw new Error(`a pagina do op.gg mudou: nao achei os aprimoramentos de ${c.chave}`);
  dados.porCampeao[id] = { em: new Date().toISOString(), ids };
  gravar();
}

// id -> tier do campeao no modo (1 e o melhor, 5 o pior); null se ainda nao baixou
function tiers(modo) {
  const l = dados.listas[modo];
  return l ? new Map(Object.entries(l.champs).map(([id, c]) => [Number(id), c.tier])) : null;
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

module.exports = { ARQUIVO, lerLista, lerCampeao, atualizarLista, atualizarCampeao, tiers, aprimoramentos };
