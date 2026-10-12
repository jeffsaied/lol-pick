@echo off
rem Desliga o Pick Automatico, que roda escondido.
title Pick Automatico
if not defined LOLPICK_PORT set LOLPICK_PORT=8787
curl -sf -o nul -X POST "http://localhost:%LOLPICK_PORT%/api/pc?acao=desligar"
if errorlevel 1 (echo O Pick Automatico nao estava ligado.) else (echo Pick Automatico desligado.)
ping -n 4 127.0.0.1 >nul
