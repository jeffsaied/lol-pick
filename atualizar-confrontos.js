'use strict';
// Baixa os confrontos do counterstats.net (uma pagina por campeao, devagar) e grava confrontos-site.json.
// Sozinho: node atualizar-confrontos.js. O server.js chama quando o arquivo falta ou tem mais de 14 dias.
const fs = require('fs');
const path = require('path');

const SITE = process.env.LOLPICK_SITE || 'https://www.counterstats.net/league-of-legends/';
const ARQUIVO = path.join(__dirname, 'confrontos-site.json');
const VALIDADE = 14 * 24 * 3600 * 1000;
const ROTA = { top: 'top', jungle: 'jungle', middle: 'middle', bottom: 'bottom', support: 'utility' }; // do site -> do LoL
const GANHA = 52; // % de vitoria a partir da qual o confronto conta como vantagem
const PERDE = 48;
const texto = (t) => t.replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pagina(slug) {
  const r = await fetch(SITE + slug, {
    headers: { 'User-Agent': 'pick-automatico (github.com/jeffsaied/pick-automatico)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`o site respondeu ${r.status}`);
  return r.text();
}

// de uma pagina: o nome do campeao e, por rota, quem leva vantagem sobre ele e quem sofre contra ele
function lerPagina(html) {
  const nome = texto((/<h1[^>]*>\s*([^<]+?) Counter Stats/.exec(html) || [])[1] || '');
  const linha = /href="\/league-of-legends\/[a-z0-9-]+\/vs-[a-z0-9-]+\/([a-z]+)\/all">\s*<div class="best-wrap">[\s\S]*?class="champion">([^<]+)<[\s\S]*?class="b">(\d+)%/g;
  const rotas = {};
  for (const [, rotaSite, outro, vitoria] of html.matchAll(linha)) {
    const rota = ROTA[rotaSite];
    if (!rota) continue;
    const r = rotas[rota] || (rotas[rota] = { perdePara: [], ganhaDe: [] });
    if (Number(vitoria) >= GANHA) r.perdePara.push(texto(outro));
    if (Number(vitoria) <= PERDE) r.ganhaDe.push(texto(outro));
  }
  return { nome, rotas };
}

const campeoesDoSite = (html) => [...new Set([...html.matchAll(/href="\/league-of-legends\/([a-z0-9-]+)"/g)].map((m) => m[1]))];

function precisa() {
  try { return !(Date.now() - Date.parse(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))._em) < VALIDADE); } catch { return true; }
}

async function atualizar(diz = () => {}) {
  const primeira = await pagina('aatrox');
  const slugs = campeoesDoSite(primeira);
  if (slugs.length < 100) throw new Error('a pagina do site mudou: nao achei a lista de campeoes');
  const tabela = {};
  let falhas = 0;
  for (const [i, slug] of slugs.entries()) {
    try {
      const { nome, rotas } = lerPagina(slug === 'aatrox' ? primeira : await pagina(slug));
      if (nome && Object.keys(rotas).length) tabela[nome] = rotas; else falhas++;
    } catch { falhas++; }
    if ((i + 1) % 25 === 0) diz(`confrontos: ${i + 1} de ${slugs.length}`);
    await espera(400);
  }
  if (falhas > slugs.length / 5) throw new Error(`${falhas} de ${slugs.length} paginas falharam; fica o arquivo anterior`);
  const patch = (/Patch (\d+\.\d+)/.exec(primeira) || [])[1] || '';
  fs.writeFileSync(ARQUIVO, JSON.stringify({ _fonte: 'counterstats.net', _patch: patch, _em: new Date().toISOString(), ...tabela }));
  diz(`confrontos: ${Object.keys(tabela).length} campeoes gravados (patch ${patch}), ${falhas} falhas`);
}

// devolve true quando gravou um arquivo novo; se o site falhar, o erro sobe e o arquivo anterior fica
async function atualizarSePreciso(diz = () => {}) {
  if (!precisa()) return false;
  await atualizar(diz);
  return true;
}

module.exports = { ARQUIVO, lerPagina, atualizar, atualizarSePreciso };

if (require.main === module) atualizar(console.log).catch((e) => { console.log('Nao deu: ' + e.message); process.exit(1); });
