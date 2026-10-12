'use strict';
// Dica de campeao: pontua cada candidato pelo que falta no time, pelo que o adversario tem,
// pela tabela de confrontos (confrontos.json) e pela maestria. Nao fala com o LoL: so faz a conta.

const PRECISA = ['tank', 'mage', 'marksman', 'support'];
const PAPEL = { tank: 'tanque', mage: 'dano mágico', marksman: 'atirador', support: 'suporte' };
const ROTAS = ['top', 'jungle', 'middle', 'bottom', 'utility'];
const DA_POSICAO = { top: ['fighter', 'tank'], middle: ['mage', 'assassin'], bottom: ['marksman'], utility: ['support'] };
const SEM_PERFIL = { dano: '', longe: false, dur: 0, cc: 0, mob: 0 };
const limpo = (t) => String(t).normalize('NFD').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

// do JSON do campeao no cliente (/lol-game-data/assets/v1/champions/<id>.json) fica so o que a dica usa
function perfilDe(c) {
  const t = c.tacticalInfo || {};
  const p = c.playstyleInfo || {};
  return {
    dano: { kPhysical: 'fisico', kMagic: 'magico', kMixed: 'misto' }[t.damageType] || '',
    longe: t.attackType === 'ranged',
    dur: p.durability || 0, cc: p.crowdControl || 0, mob: p.mobility || 0, // notas de 1 a 3
  };
}

// As tabelas de confronto sao escritas com nomes; aqui viram pares de id.
// A mao (confrontos.json), vale em qualquer rota:
//   { "Yasuo": { "perdePara": ["Malphite"], "ganhaDe": ["Lux"], "combinaCom": ["Malphite"] } }
// Do site (confrontos-site.json), separado por rota:
//   { "Yasuo": { "middle": { "perdePara": [...], "ganhaDe": [...] } } }
function lerConfrontos(tabelas, champs) {
  const idDe = new Map();
  for (const c of champs.values()) {
    for (const n of [c.name, c.alias]) if (n && !idDe.has(limpo(n))) idDe.set(limpo(n), c.id);
  }
  const vence = new Set(); // "rota|a>b": a leva vantagem sobre b. rota '' = sempre, '*' = em alguma rota
  const combina = new Set(); // "a+b", nos dois sentidos
  const semId = new Set();
  const achar = (n) => idDe.get(limpo(n)) || idDe.get(limpo(String(n).split(' & ')[0])); // "Nunu & Willump" muda com o idioma do cliente
  const ids = (nomes) => (Array.isArray(nomes) ? nomes : []).map((n) => {
    const id = achar(n);
    if (!id) semId.add(n);
    return id;
  }).filter(Boolean);
  const anotar = (a, v, rotas) => {
    for (const r of rotas) {
      for (const b of ids(v.perdePara)) vence.add(`${r}|${b}>${a}`);
      for (const b of ids(v.ganhaDe)) vence.add(`${r}|${a}>${b}`);
    }
    for (const b of ids(v.combinaCom)) { combina.add(`${a}+${b}`); combina.add(`${b}+${a}`); }
  };
  for (const tabela of tabelas) {
    for (const [nome, v] of Object.entries(tabela || {})) {
      if (nome.startsWith('_') || !v) continue;
      const a = achar(nome);
      if (!a) { semId.add(nome); continue; }
      anotar(a, v, ['']);
      for (const rota of ROTAS) if (v[rota]) anotar(a, v[rota], [rota, '*']);
    }
  }
  return { vence, combina, semId: [...semId] };
}

function lerTime(ids, champs, perfis) {
  const t = { n: 0, sabidos: 0, papeis: new Set(), fisico: 0, magico: 0, frente: 0, comCC: 0, assassinos: 0, longe: 0, perto: 0 };
  for (const id of ids) {
    const c = champs.get(id);
    if (!c) continue;
    t.n++;
    c.roles.forEach((r) => t.papeis.add(r));
    const p = perfis.get(id);
    if (!p) continue;
    t.sabidos++;
    if (p.dano !== 'magico') t.fisico++;
    if (p.dano !== 'fisico') t.magico++;
    if (p.dur >= 3) t.frente++;
    if (p.cc >= 3) t.comCC++;
    if (c.roles.includes('assassin') && p.dur <= 2) t.assassinos++;
    if (p.longe) t.longe++; else t.perto++;
  }
  return t;
}

// aliados e inimigos: ids ja escolhidos (sem voce). pool: ids que voce pode pegar. posicao: a do LoL (top, jungle...).
function sugerir({ aliados, inimigos, pool, posicao, champs, perfis, maestria, confrontos, quantos = 6 }) {
  const meu = lerTime(aliados, champs, perfis);
  const deles = lerTime(inimigos, champs, perfis);
  const falta = meu.n ? PRECISA.filter((r) => !meu.papeis.has(r)) : [];
  const tem = (c, r) => c.roles.includes(r);

  // cada regra: quando vale, o que dizer da situacao, quem resolve, quanto pesa, o motivo que aparece no campeao
  // e, se houver, o papel em falta que ja diz a mesma coisa (para nao contar duas vezes)
  const regras = [
    [meu.sabidos >= 2 && !meu.magico, 'Seu time está sem dano mágico', (c, p) => p.dano === 'magico', 2, 'traz dano mágico', 'mage'],
    [meu.sabidos >= 2 && !meu.fisico, 'Seu time está sem dano físico', (c, p) => p.dano === 'fisico', 2, 'traz dano físico'],
    [meu.sabidos >= 2 && !meu.frente, 'Seu time está sem linha de frente', (c, p) => p.dur >= 3, 2, 'linha de frente', 'tank'],
    [meu.sabidos >= 3 && !meu.comCC, 'Seu time tem pouco controle', (c, p) => p.cc >= 3, 1, 'tem controle'],
    [deles.assassinos >= 2, `Adversário com ${deles.assassinos} assassinos`, (c, p) => p.cc >= 3 || p.dur >= 3, 2, 'segura assassino'],
    [deles.frente >= 2, `Adversário com ${deles.frente} tanques`, (c) => tem(c, 'marksman'), 1, 'derruba tanque'],
    [deles.longe >= 3, 'Adversário joga de longe', (c, p) => p.mob >= 3 || tem(c, 'assassin'), 1, 'alcança quem fica longe'],
    [deles.perto >= 4, 'Adversário é quase todo corpo a corpo', (c, p) => p.longe && p.cc >= 2, 1, 'mantém distância'],
    [deles.sabidos >= 3 && !deles.magico, 'Adversário só tem dano físico', (c, p) => p.dur >= 3, 1, 'aguenta com armadura'],
    [deles.sabidos >= 3 && !deles.fisico, 'Adversário só tem dano mágico', (c, p) => p.dur >= 3, 1, 'aguenta com resistência mágica'],
  ].filter((r) => r[0]);

  const { vence, combina } = confrontos || { vence: new Set(), combina: new Set() };
  const nome = (id) => (champs.get(id) || { name: '' }).name;
  // com rota definida vale o confronto daquela rota; sem rota (as cegas), o de qualquer uma
  const rotas = ['', ROTAS.includes(posicao) ? posicao : '*'];
  const ganha = (a, b) => rotas.some((r) => vence.has(`${r}|${a}>${b}`));
  const daPosicao = DA_POSICAO[posicao] || [];

  const lista = [];
  for (const id of pool) {
    const c = champs.get(id);
    if (!c) continue;
    const p = perfis.get(id) || SEM_PERFIL;
    const motivos = [];
    let pontos = 0;

    // a Riot marca alguns atiradores como mago; quem so da dano fisico nao cobre a falta de dano magico
    const cobre = c.roles.filter((r) => falta.includes(r) && !(r === 'mage' && p.dano === 'fisico'));
    pontos += 2 * cobre.length;
    cobre.forEach((r) => motivos.push('cobre ' + PAPEL[r]));

    for (const [, , serve, peso, motivo, papel] of regras) {
      if (!cobre.includes(papel) && serve(c, p)) { pontos += peso; motivos.push(motivo); }
    }
    for (const e of inimigos) {
      const bom = ganha(id, e);
      const ruim = ganha(e, id);
      if (bom && !ruim) { pontos += 3; motivos.push('bom contra ' + nome(e)); }
      if (ruim && !bom) { pontos -= 3; motivos.push('sofre contra ' + nome(e)); }
    }
    for (const a of aliados) {
      if (combina.has(`${id}+${a}`)) { pontos += 2; motivos.push('combina com ' + nome(a)); }
    }
    if (c.roles.some((r) => daPosicao.includes(r))) pontos += 2;

    // maestria: 1 mil = 1, 10 mil = 2, 100 mil = 3, 1 milhao = 4
    const pts = maestria.get(id) || 0;
    pontos += pts > 0 ? Math.min(4, Math.max(0, Math.log10(pts) - 2)) : 0;

    if (pontos > 0) lista.push({ id, pontos, pts, motivos });
  }
  lista.sort((a, b) => b.pontos - a.pontos || b.pts - a.pts || a.id - b.id);
  const melhores = lista.slice(0, quantos);

  return {
    falta: falta.map((r) => PAPEL[r]),
    leitura: regras.map((r) => r[1]),
    champs: melhores.map((x) => x.id),
    motivos: Object.fromEntries(melhores.filter((x) => x.motivos.length).map((x) => [x.id, x.motivos])),
  };
}

module.exports = { perfilDe, lerConfrontos, sugerir };
