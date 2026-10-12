'use strict';
// node --test
const test = require('node:test');
const assert = require('node:assert');
const { perfilDe, lerConfrontos, sugerir } = require('./sugestao');

const ficha = (id, name, roles, dano, atk, dur, cc, mob) => ({
  id, name, alias: name.replace(/\W/g, ''), roles,
  tacticalInfo: { damageType: dano, attackType: atk }, playstyleInfo: { durability: dur, crowdControl: cc, mobility: mob },
});
const FICHAS = [
  ficha(1, 'Malphite', ['tank', 'mage'], 'kMagic', 'melee', 3, 3, 1),
  ficha(2, 'Zed', ['assassin'], 'kPhysical', 'melee', 1, 1, 3),
  ficha(3, 'Talon', ['assassin'], 'kPhysical', 'melee', 1, 1, 3),
  ficha(4, 'Jinx', ['marksman'], 'kPhysical', 'ranged', 1, 2, 1),
  ficha(5, 'Lux', ['mage', 'support'], 'kMagic', 'ranged', 1, 3, 1),
  ficha(6, 'Yasuo', ['fighter', 'assassin'], 'kPhysical', 'melee', 2, 2, 3),
  ficha(7, 'Garen', ['fighter', 'tank'], 'kPhysical', 'melee', 3, 1, 1),
  ficha(8, "Kai'Sa", ['marksman'], 'kMixed', 'ranged', 1, 1, 3),
];
const champs = new Map(FICHAS.map((c) => [c.id, c]));
const perfis = new Map(FICHAS.map((c) => [c.id, perfilDe(c)]));
const base = { aliados: [], inimigos: [], pool: [...champs.keys()], posicao: '', champs, perfis, maestria: new Map(), confrontos: null };

test('sem ninguem escolhido, a dica e a maestria', () => {
  const r = sugerir({ ...base, maestria: new Map([[4, 50000], [5, 900000]]) });
  assert.deepStrictEqual(r.champs, [5, 4]);
  assert.deepStrictEqual(r.leitura, []);
});

test('time so de dano fisico e sem frente pede Malphite', () => {
  const r = sugerir({ ...base, aliados: [2, 4, 6] });
  assert.strictEqual(r.champs[0], 1);
  assert.ok(r.leitura.includes('Seu time está sem dano mágico'));
  assert.ok(r.leitura.includes('Seu time está sem linha de frente'));
  assert.deepStrictEqual(r.motivos[1], ['cobre tanque', 'cobre dano mágico', 'tem controle']); // sem repetir 'linha de frente' e 'traz dano mágico'
  assert.ok(!r.motivos[4]); // Jinx: a Riot nao a marca como mago, e ja ha atirador
});

test('dois assassinos do outro lado puxam quem segura', () => {
  const r = sugerir({ ...base, inimigos: [2, 3], pool: [1, 4] });
  assert.strictEqual(r.champs[0], 1);
  assert.ok(r.motivos[1].includes('segura assassino'));
});

test('maestria alta nao e atropelada por um motivo fraco', () => {
  const r = sugerir({ ...base, inimigos: [1, 7], pool: [4, 5], maestria: new Map([[5, 1000000]]) });
  assert.deepStrictEqual(r.champs, [5, 4]); // Jinx derruba tanque (+1), Lux tem 1 milhao (+4)
});

test('posicao favorece a classe da rota', () => {
  const r = sugerir({ ...base, posicao: 'bottom', pool: [4, 7] });
  assert.deepStrictEqual(r.champs, [4]);
});

test('confrontos: vantagem, desvantagem e dupla', () => {
  const c = lerConfrontos({ Yasuo: { perdePara: ['malphite'], ganhaDe: ['Lux'], combinaCom: ['Malphite'] }, Kaisa: { ganhaDe: ['Jinx'] }, _nota: 'x', Fulano: {} }, champs);
  assert.deepStrictEqual(c.semId, ['Fulano']);
  const contra = sugerir({ ...base, inimigos: [6], pool: [1, 5, 7], maestria: new Map([[5, 100]]), confrontos: c });
  assert.strictEqual(contra.champs[0], 1);
  assert.deepStrictEqual(contra.motivos[1], ['bom contra Yasuo']);
  assert.ok(!contra.champs.includes(5)); // Lux sofre contra Yasuo
  const junto = sugerir({ ...base, aliados: [6], pool: [1, 7], confrontos: c });
  assert.ok(junto.motivos[1].includes('combina com Yasuo'));
  assert.ok(sugerir({ ...base, inimigos: [4], pool: [8], confrontos: c }).motivos[8].includes('bom contra Jinx')); // apostrofo no nome
});

test('campeao sem perfil carregado ainda entra pela classe', () => {
  const r = sugerir({ ...base, aliados: [2], perfis: new Map(), pool: [1, 5] });
  assert.deepStrictEqual(r.falta, ['tanque', 'dano mágico', 'atirador', 'suporte']);
  assert.deepStrictEqual(r.champs, [1, 5]);
});
