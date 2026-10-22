'use strict';
// PickAutomatico.exe: o Node vem dentro do .exe (Node SEA). Na primeira vez (e a cada versao nova) os
// arquivos do programa saem de dentro do .exe para %LOCALAPPDATA%\PickAutomatico; o config.json de cada
// pessoa fica la e nunca e apagado. Depois faz o mesmo que o iniciar.bat: libera a porta e liga o servidor.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');
const sea = require('node:sea');
const { createRequire } = require('module');

const DEST = path.join(process.env.LOCALAPPDATA || process.env.APPDATA, 'PickAutomatico');
const PORTA = Number(process.env.LOLPICK_PORT) || 8787;
const LISTA = JSON.parse(sea.getAsset('lista.json', 'utf8')); // arquivos embutidos

function jaLigado() {
  return new Promise((ok) => {
    const r = http.get({ host: '127.0.0.1', port: PORTA, path: '/api/pc', timeout: 1500 }, (res) => { res.resume(); ok(res.statusCode === 200); });
    r.on('error', () => ok(false));
    r.on('timeout', () => { r.destroy(); ok(false); });
  });
}

function extrair() {
  const versao = sea.getAsset('versao.txt', 'utf8').trim();
  let atual = '';
  try { atual = fs.readFileSync(path.join(DEST, 'versao.txt'), 'utf8').trim(); } catch {}
  if (atual === versao && fs.existsSync(path.join(DEST, 'server.js'))) return;
  for (const nome of LISTA) {
    const alvo = path.join(DEST, nome);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, Buffer.from(sea.getAsset(nome)));
  }
}

function portaLiberada() {
  // a regra do firewall deixa o celular alcancar o PC; so na primeira vez o Windows pede permissao
  try { execFileSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=lol-pick-${PORTA}`], { stdio: 'ignore', windowsHide: true }); return; } catch {}
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Start-Process netsh -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList 'advfirewall firewall add rule name=lol-pick-${PORTA} dir=in action=allow protocol=TCP localport=${PORTA}'`], { stdio: 'ignore', windowsHide: true });
  } catch {}
}

function atalho() {
  // o .exe fica guardado junto com o programa (pode baixar em qualquer pasta) e o atalho da Area de Trabalho aponta para la
  const fixo = path.join(DEST, 'PickAutomatico.exe');
  if (path.resolve(process.execPath).toLowerCase() !== fixo.toLowerCase()) {
    try { fs.copyFileSync(process.execPath, fixo); } catch {} // pode falhar se o de la estiver aberto: segue com este
  }
  const alvo = (fs.existsSync(fixo) ? fixo : process.execPath).replace(/'/g, "''");
  const ps = `$d=[Environment]::GetFolderPath('Desktop'); $n=Join-Path $d ('Pick Autom'+[char]225+'tico.lnk'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut($n); if ($s.TargetPath -ne '${alvo}') { $s.TargetPath='${alvo}'; $s.WorkingDirectory='${DEST.replace(/'/g, "''")}'; $s.IconLocation='${alvo}'; $s.Save() }`;
  try { execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true }); } catch {}
}

(async () => {
  if (await jaLigado()) { // clicou de novo com ele ligado: so abre a tela do PC
    spawn('cmd', ['/c', 'start', '', `http://localhost:${PORTA}/pc`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  fs.mkdirSync(DEST, { recursive: true });
  extrair();
  // sem janela de console: o que o programa escreveria vai para o log
  const log = fs.createWriteStream(path.join(DEST, 'pick-automatico.log'), { flags: 'w' });
  const escrever = (...a) => log.write(a.map(String).join(' ') + '\n');
  console.log = escrever; console.error = escrever; console.warn = escrever;
  portaLiberada();
  atalho();
  process.chdir(DEST);
  createRequire(path.join(DEST, 'server.js'))('./server.js');
})();
