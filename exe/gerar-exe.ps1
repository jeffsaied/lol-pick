# Gera exe\PickAutomatico.exe: o Node deste PC + o programa inteiro dentro de um arquivo so (Node SEA).
# Uso: powershell -ExecutionPolicy Bypass -File exe\gerar-exe.ps1   (precisa de Node 22+ e npm)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$tmp = Join-Path $PSScriptRoot 'build'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $tmp | Out-Null

# 1) os arquivos que o programa usa (os mesmos do zip), sem o que e de cada pessoa
$arquivos = @('server.js','sugestao.js','desordem.js','atualizar-confrontos.js','confrontos.json','hud.ps1','cartas.ps1',
              'index.html','pc.html','versao.txt','icone.ico','icone-192.png','icone-512.png','vendor/qrcode.js','resumos-aprimoramentos.json','app/PickAutomatico.apk','parar.bat','README.md')
$assets = @{}
foreach ($a in $arquivos) { $assets[$a] = (Join-Path $raiz $a) }
$lista = Join-Path $tmp 'lista.json'
[IO.File]::WriteAllText($lista, ($arquivos | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding $false))
$assets['lista.json'] = $lista
$cfg = @{ main = (Join-Path $PSScriptRoot 'iniciar-exe.js'); output = (Join-Path $tmp 'sea.blob'); disableExperimentalSEAWarning = $true; useCodeCache = $false; assets = $assets }
[IO.File]::WriteAllText((Join-Path $tmp 'sea.json'), ($cfg | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))
& node --experimental-sea-config (Join-Path $tmp 'sea.json')
if ($LASTEXITCODE) { throw 'node --experimental-sea-config falhou' }

# 2) copia o node.exe, troca icone e nome (rcedit) e injeta o programa (postject)
$exe = Join-Path $tmp 'PickAutomatico.exe'
Copy-Item (Get-Command node).Source $exe
$rcedit = Join-Path $tmp 'rcedit.exe'
Invoke-WebRequest 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' -OutFile $rcedit -UseBasicParsing
$versao = (Get-Content (Join-Path $raiz 'versao.txt') -Raw).Trim()
& $rcedit $exe --set-icon (Join-Path $raiz 'icone.ico') --set-version-string FileDescription 'Pick Automatico' --set-version-string ProductName 'Pick Automatico' `
    --set-version-string OriginalFilename 'PickAutomatico.exe' --set-version-string CompanyName 'jeffsaied' --set-file-version "$versao.0.0.0" --set-product-version "$versao.0.0.0"
& npx --yes postject@1.0.0-alpha.6 $exe NODE_SEA_BLOB (Join-Path $tmp 'sea.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE) { throw 'postject falhou' }

# 3) programa de janela (sem console): troca o "subsystem" do cabecalho PE de 3 (console) para 2 (GUI)
$b = [IO.File]::ReadAllBytes($exe)
$pe = [BitConverter]::ToInt32($b, 0x3C)
$b[$pe + 4 + 20 + 68] = 2; $b[$pe + 4 + 20 + 69] = 0
[IO.File]::WriteAllBytes($exe, $b)

Copy-Item $exe (Join-Path $PSScriptRoot 'PickAutomatico.exe') -Force
Remove-Item $tmp -Recurse -Force
"pronto: $(Join-Path $PSScriptRoot 'PickAutomatico.exe')"
