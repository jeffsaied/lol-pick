@echo off
title Pick Automatico
cd /d "%~dp0"

where node >nul 2>&1
if not errorlevel 1 goto temnode

rem Sem Node.js: oferece instalar pelo winget, o instalador oficial da Microsoft que ja vem no Windows.
echo O Pick Automatico precisa do Node.js, que nao esta neste PC.
where winget >nul 2>&1
if errorlevel 1 goto manual
choice /c SN /m "Instalar agora o Node.js oficial pelo winget da Microsoft"
if errorlevel 2 goto manual
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>&1
if not errorlevel 1 goto temnode
echo Se a instalacao terminou, feche esta janela e clique no iniciar.bat de novo.
pause
exit /b

:manual
echo Instale a versao LTS em https://nodejs.org e clique neste arquivo de novo.
pause
exit /b

:temnode

rem Cria o atalho "Pick Automatico" com o icone, nesta pasta e na Area de Trabalho. O [char]225 e o "a" com acento.
powershell -NoProfile -Command "$n='Pick Autom'+[char]225+'tico.lnk'; foreach ($p in '%~dp0', [Environment]::GetFolderPath('Desktop')) { $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $p $n)); $s.TargetPath='%~dp0iniciar.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0icone.ico'; $s.Save() }" >nul 2>&1

rem Libera a porta para o celular alcancar o PC. So na primeira vez; o Windows pede permissao.
netsh advfirewall firewall show rule name=lol-pick-8787 >nul 2>&1
if errorlevel 1 (
  echo Liberando a porta 8787 no firewall. Aceite o pedido de permissao do Windows.
  powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=lol-pick-8787 dir=in action=allow protocol=TCP localport=8787'"
)

set LOLPICK_JANELA=1
node server.js
pause
