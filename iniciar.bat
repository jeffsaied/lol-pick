@echo off
title Pick Automatico
cd /d "%~dp0"
if not defined LOLPICK_PORT set LOLPICK_PORT=8787

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

rem Ja esta rodando escondido? Entao nao liga outro.
curl -sf -o nul http://localhost:%LOLPICK_PORT%/api/pc
if errorlevel 1 goto ligar
echo O Pick Automatico ja esta ligado. Para desligar, clique em parar.bat.
if defined LOLPICK_CONFIGURAR start "" http://localhost:%LOLPICK_PORT%/pc
goto fechar

:ligar
rem Libera a porta para o celular alcancar o PC. So na primeira vez; o Windows pede permissao.
netsh advfirewall firewall show rule name=lol-pick-8787 >nul 2>&1
if errorlevel 1 (
  echo Liberando a porta 8787 no firewall. Aceite o pedido de permissao do Windows.
  powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=lol-pick-8787 dir=in action=allow protocol=TCP localport=8787'"
)

rem Liga o programa escondido, sem janela. O que ele escreveria aqui vai para o pick-automatico.log.
powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c node server.js > pick-automatico.log 2>&1' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo Ligando...
set TENT=0
:espera
ping -n 2 127.0.0.1 >nul
curl -sf -o nul http://localhost:%LOLPICK_PORT%/api/pc
if not errorlevel 1 goto ligou
set /a TENT+=1
if %TENT% lss 8 goto espera
echo Nao ligou. Veja o arquivo pick-automatico.log nesta pasta.
pause
exit /b 1

:ligou
echo.
echo Pick Automatico ligado: e ele que liga o seu PC ao celular.
echo Fica rodando escondido, so com o painel no canto da tela. Para desligar, clique no X do painel ou em parar.bat.

:fechar
echo Esta janela fecha sozinha em 5 segundos.
ping -n 6 127.0.0.1 >nul
exit 0
