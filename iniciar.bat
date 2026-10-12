@echo off
title lol-pick
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Falta o Node.js. Instale a versao LTS em https://nodejs.org e clique neste arquivo de novo.
  pause
  exit /b
)

rem Libera a porta para o celular alcancar o PC. So na primeira vez; o Windows pede permissao.
netsh advfirewall firewall show rule name=lol-pick-8787 >nul 2>&1
if errorlevel 1 (
  echo Liberando a porta 8787 no firewall. Aceite o pedido de permissao do Windows.
  powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=lol-pick-8787 dir=in action=allow protocol=TCP localport=8787'"
)

node server.js
pause
