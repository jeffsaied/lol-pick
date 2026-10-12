# Notas em cima das cartas: le a tela (OCR do Windows), acha o nome de cada carta e desenha por cima a nota
# e uma linha em volta, mais grossa na melhor. Vale para as cartas de campeao na selecao do ARAM (janela do
# cliente) e para as cartas de aprimoramento do ARAM: Desordem (janela do jogo, que precisa estar em "sem bordas"
# ou "janela": por cima de tela cheia o Windows nao deixa desenhar). Quem abre e o server.js, ao ligar.
# Para conferir sem o jogo, com -Itens <json com itens> e -Tipo campeoes|aprimoramentos:
#   -Foto <imagem da janela>   le a imagem e escreve o que achou
#   -Janela <nome do processo> desenha por cima da janela desse processo, em vez da do LoL
param([int]$Porta = 8787, [string]$Foto = '', [string]$Janela = '', [string]$Itens = '', [string]$Tipo = 'aprimoramentos')
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing, System.Runtime.WindowsRuntime

$novo = $false
$mutex = New-Object Threading.Mutex($true, "PickAutomaticoCartas$Porta$(if ($Foto -or $Janela) { 'Teste' })", [ref]$novo)
if (-not $novo) { return }

Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Tela {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref P p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  // A janela que esta na frente: { processo, x, y, largura, altura } da area util dela, em pixels da tela.
  // Devolve tudo de uma vez porque o [ref] do PowerShell nao volta preenchido dentro do temporizador.
  public static int[] Frente() {
    IntPtr h = GetForegroundWindow();
    uint pid; GetWindowThreadProcessId(h, out pid);
    R r; GetClientRect(h, out r);
    P p = new P(); ClientToScreen(h, ref p);
    if (r.Rt <= 0 || r.B <= 0) { // janela sem area util declarada: vale o contorno dela
      R j; GetWindowRect(h, out j);
      return new int[] { (int)pid, j.L, j.T, j.Rt - j.L, j.B - j.T };
    }
    return new int[] { (int)pid, p.X, p.Y, r.Rt, r.B };
  }
}
// Comparacao de nomes tolerando letras erradas. Em C# porque no PowerShell cada leitura levava segundos.
public static class Nomes {
  static int Distancia(string a, string b, int limite) {
    if (Math.Abs(a.Length - b.Length) > limite) return 99;
    int[] ant = new int[b.Length + 1], at = new int[b.Length + 1];
    for (int j = 0; j <= b.Length; j++) ant[j] = j;
    for (int i = 1; i <= a.Length; i++) {
      at[0] = i;
      for (int j = 1; j <= b.Length; j++)
        at[j] = Math.Min(Math.Min(at[j - 1] + 1, ant[j] + 1), ant[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
      int[] t = ant; ant = at; at = t;
    }
    return ant[b.Length];
  }
  // indice do nome mais parecido com o texto, ou -1 se nenhum fica dentro da tolerancia
  public static int Achar(string texto, string[] chaves, int tolera) {
    int melhor = -1, menor = tolera + 1;
    for (int k = 0; k < chaves.Length; k++) {
      int d = Distancia(texto, chaves[k], tolera);
      if (d < menor) { menor = d; melhor = k; }
    }
    return melhor;
  }
}
'@

# ---------- leitor de texto do Windows ----------
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$Leitor = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $Leitor) { return } # Windows sem leitor de texto instalado: nao ha o que fazer
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Esperar($operacao, [Type]$tipo) {
    $t = $asTask.MakeGenericMethod($tipo).Invoke($null, @($operacao))
    [void]$t.Wait(5000)
    return $t.Result
}
# Fotografa um pedaco da tela (sem as janelas transparentes, entao a propria nota nao atrapalha).
function Fotografar($x, $y, $w, $h) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h)) } finally { $g.Dispose() }
    return $bmp
}
# Devolve as palavras lidas na imagem, linha por linha, com a posicao de cada uma.
function Ler-Imagem($bmp) {
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()
    $ms.Position = 0
    $fluxo = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $dec = Esperar ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($fluxo)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb = Esperar ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $res = Esperar ($Leitor.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    $ms.Dispose()
    $linhas = @()
    foreach ($l in $res.Lines) {
        $palavras = @($l.Words | ForEach-Object {
            [pscustomobject]@{ T = (Limpo $_.Text); X = $_.BoundingRect.X; Y = $_.BoundingRect.Y; W = $_.BoundingRect.Width; H = $_.BoundingRect.Height }
        } | Where-Object { $_.T })
        if ($palavras.Count) { $linhas += , $palavras }
    }
    return , $linhas
}

# ---------- comparar nomes ----------
# Sem acento, espaco e maiuscula, e ja trocando as letras que o leitor confunde ("rn" vira "m", "1" e "i" viram "l", "0" vira "o").
function Limpo($t) {
    $n = ([string]$t).Normalize([Text.NormalizationForm]::FormD)
    $n = ([regex]::Replace($n, '[^a-zA-Z0-9]', '')).ToLower()
    return $n.Replace('rn', 'm').Replace('1', 'l').Replace('i', 'l').Replace('0', 'o')
}
# O leitor erra uma letra ou outra: aceita ate 1 erro a cada 6 letras.
function Achar-Item($texto, $itens) {
    if ($script:porNome.ContainsKey($texto)) { return $script:porNome[$texto] }
    $tolera = [Math]::Floor($texto.Length / 6)
    if ($tolera -lt 1) { return $null }
    $k = [Nomes]::Achar($texto, $script:chaves, $tolera)
    if ($k -ge 0) { return $itens[$k] }
    return $null
}
# Cartas vizinhas podem vir na mesma linha de texto: procura cada nome como sequencia de 1 a 5 palavras seguidas.
function Achar-Cartas($linhas, $itens) {
    $achadas = @()
    foreach ($palavras in $linhas) {
        $i = 0
        while ($i -lt $palavras.Count) {
            $pegou = $false
            for ($n = [Math]::Min(5, $palavras.Count - $i); $n -ge 1; $n--) {
                $grupo = $palavras[$i..($i + $n - 1)]
                $it = Achar-Item (($grupo | ForEach-Object { $_.T }) -join '') $itens
                if ($it) {
                    $x1 = ($grupo | Measure-Object X -Minimum).Minimum
                    $x2 = ($grupo | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
                    $y1 = ($grupo | Measure-Object Y -Minimum).Minimum
                    $y2 = ($grupo | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
                    $achadas += [pscustomobject]@{ Item = $it; CX = ($x1 + $x2) / 2; CY = ($y1 + $y2) / 2 }
                    $i += $n; $pegou = $true; break
                }
            }
            if (-not $pegou) { $i++ }
        }
    }
    # o mesmo nome repetido (titulo e dica na tela): fica o de cima
    return @($achadas | Sort-Object CY | Group-Object { $_.Item.chave } | ForEach-Object { $_.Group[0] } | Sort-Object CX)
}

# ---------- onde as cartas ficam ----------
# Medidas tiradas de fotos de verdade, em fracao da largura da carta: o nome serve de ancora.
#   faixa: pedaco da janela onde os nomes aparecem (de cima para baixo). Tem que ser estreita: com a janela
#          inteira o leitor do Windows se perde no fundo do jogo e nao acha os nomes.
#   largura: largura da carta em fracao da altura da janela; passo: distancia entre duas cartas vizinhas
#   topo/altura: borda de cima em relacao ao nome, e a altura da carta
#   topoJ/alturaJ: o mesmo em fracao da altura da janela, para as cartas do jogo, que mudam de largura mas nao de altura
$Forma = @{
    campeoes       = @{ Processo = 'LeagueClientUx';    Faixa = 0.52, 0.67; Largura = 0.258; Passo = 1.161; Topo = 1.333; Altura = 1.602 }
    aprimoramentos = @{ Processo = 'League of Legends'; Faixa = 0.34, 0.49; Largura = 0.31; Passo = 1.149; TopoJ = 0.232; AlturaJ = 0.492 }
}

# ---------- janela transparente por cima ----------
[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="Pick Automático - cartas" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False" ResizeMode="NoResize" WindowStartupLocation="Manual"
        Left="0" Top="0" Width="10" Height="10">
  <Canvas x:Name="Quadro" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"/>
</Window>
'@
$win = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$quadro = $win.FindName('Quadro')
$Pincel = [Windows.Media.BrushConverter]::new()
# os cliques atravessam a janela e ela nunca rouba o foco do jogo
$win.Add_SourceInitialized({
    $h = (New-Object Windows.Interop.WindowInteropHelper $win).Handle
    [void][Tela]::SetWindowLong($h, -20, [Tela]::GetWindowLong($h, -20) -bor 0x20 -bor 0x80 -bor 0x80000 -bor 0x08000000)
})

function Cor-Tier($tier) {
    if ($null -eq $tier) { return '#A09B8C' }
    switch ([int]$tier) { 0 { '#FF6B81' } 1 { '#F5A623' } 2 { '#5BC0EB' } 3 { '#C8D0D8' } default { '#E0475A' } }
}
function Desenhar($cartas, $forma, $altJanela) {
    $quadro.Children.Clear()
    if (-not $cartas.Count) { return }
    $largura = $forma.Largura * $altJanela
    if ($cartas.Count -ge 2) { $largura = ($cartas[1].CX - $cartas[0].CX) / $forma.Passo } # duas cartas dao a medida exata
    $melhor = ($cartas | Sort-Object { [double]$_.Item.ordem } | Select-Object -First 1).Item.chave
    $menor = ($cartas | ForEach-Object { [double]$_.Item.ordem } | Measure-Object -Minimum).Minimum
    $empate = @($cartas | Where-Object { [double]$_.Item.ordem -eq $menor }).Count -gt 1
    foreach ($c in $cartas) {
        $eMelhor = (-not $empate) -and $cartas.Count -ge 2 -and $c.Item.chave -eq $melhor
        $cor = if ($eMelhor) { '#3CCF7E' } else { Cor-Tier $c.Item.tier }
        $x = $c.CX - $largura / 2
        if ($forma.TopoJ) { $y = $c.CY - $forma.TopoJ * $altJanela; $altura = $forma.AlturaJ * $altJanela }
        else { $y = $c.CY - $forma.Topo * $largura; $altura = $forma.Altura * $largura }
        $borda = New-Object Windows.Shapes.Rectangle
        $borda.Width = $largura; $borda.Height = $altura
        $borda.RadiusX = 14; $borda.RadiusY = 14
        $borda.Stroke = $Pincel.ConvertFromString($cor); $borda.StrokeThickness = if ($eMelhor) { 6 } else { 2 }
        [Windows.Controls.Canvas]::SetLeft($borda, $x); [Windows.Controls.Canvas]::SetTop($borda, $y)
        [void]$quadro.Children.Add($borda)

        $selo = New-Object Windows.Controls.Border
        $selo.Background = $Pincel.ConvertFromString('#E60A1428'); $selo.BorderBrush = $Pincel.ConvertFromString($cor); $selo.BorderThickness = 2
        $selo.CornerRadius = 8; $selo.Padding = '10,4'; $selo.Width = $largura
        $txt = New-Object Windows.Controls.TextBlock
        $txt.Text = if ($eMelhor) { "MELHOR  ·  $($c.Item.rotulo)" } else { $c.Item.rotulo }
        $txt.Foreground = $Pincel.ConvertFromString($cor); $txt.FontSize = [Math]::Max(12, [Math]::Round($largura / 15)); $txt.FontWeight = 'Bold'
        $txt.TextAlignment = 'Center'; $txt.TextTrimming = 'CharacterEllipsis'
        $selo.Child = $txt
        $alturaSelo = $txt.FontSize + 22
        [Windows.Controls.Canvas]::SetLeft($selo, $x); [Windows.Controls.Canvas]::SetTop($selo, [Math]::Max(0, $y - $alturaSelo - 4))
        [void]$quadro.Children.Add($selo)
    }
}

# ---------- laco ----------
$Base = "http://127.0.0.1:$Porta"
function Pedir($caminho) {
    try { $w = New-Object Net.WebClient; $w.Proxy = $null; $w.Encoding = [Text.Encoding]::UTF8; return ($w.DownloadString($Base + $caminho) | ConvertFrom-Json) }
    catch { return $null }
}
$falhas = 0
$dados = $null
$porNome = @{}
$chaves = [string[]]@()
function Indexar($itens) {
    $script:porNome = @{}
    foreach ($it in $itens) {
        $it | Add-Member -NotePropertyName chave -NotePropertyValue (Limpo $it.nome) -Force
        $script:porNome[$it.chave] = $it
    }
    $script:chaves = [string[]]@($itens | ForEach-Object { $_.chave })
}
$ultimoPedido = [datetime]::MinValue
$assinatura = ''
function Esconder { if ($script:assinatura -ne '') { $quadro.Children.Clear(); $script:assinatura = '' } }

# Um erro nao pode derrubar o desenho; o ultimo fica anotado para quem for investigar.
function Anotar-Erro($e) {
    try { "$(Get-Date -Format s) linha $($e.InvocationInfo.ScriptLineNumber): $($e.Exception.Message)" | Set-Content (Join-Path $env:TEMP 'pick-automatico-cartas-erro.txt') } catch {}
}

function Passo {
    if (-not $Janela -and ((Get-Date) - $script:ultimoPedido).TotalSeconds -ge 3) {
        $script:ultimoPedido = Get-Date
        $d = Pedir '/api/cartas'
        if (-not $d) { $script:falhas++; if ($script:falhas -ge 3) { $win.Close() }; return }
        $script:falhas = 0
        $script:dados = $d
        Indexar @($d.itens)
    }
    $d = $script:dados
    if (-not $d -or -not $d.tipo -or -not $Forma.ContainsKey([string]$d.tipo)) { Esconder; return }
    $forma = $Forma[[string]$d.tipo]
    $proc = Get-Process $forma.Processo -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if (-not $proc) { Esconder; return }
    $f = [Tela]::Frente()
    if ($f[0] -ne $proc.Id) { Esconder; return } # so com o LoL na frente: nao le nem desenha em cima de outra janela
    $o = [pscustomobject]@{ X = $f[1]; Y = $f[2] }; $w = $f[3]; $h = $f[4]
    if ($w -lt 400 -or $h -lt 300) { Esconder; return }
    $y1 = [int]($h * $forma.Faixa[0]); $y2 = [int]($h * $forma.Faixa[1])
    try { $linhas = Ler-Imagem (Fotografar $o.X ($o.Y + $y1) $w ($y2 - $y1)) } catch { Anotar-Erro $_; Esconder; return }
    $cartas = @(Achar-Cartas $linhas @($d.itens))
    foreach ($c in $cartas) { $c.CY += $y1 }
    $sig = ($cartas | ForEach-Object { "$($_.Item.chave)@$([int]($_.CX / 8)),$([int]($_.CY / 8))" }) -join '|'
    if ($sig -eq $script:assinatura) { return }
    $script:assinatura = $sig
    $win.Left = $o.X; $win.Top = $o.Y; $win.Width = $w; $win.Height = $h
    Desenhar $cartas $forma $h
}

# Modo de conferencia: le uma foto guardada em vez da tela e so escreve o que achou.
if ($Foto) {
    $forma = $Forma[$Tipo]
    $lista = @((Get-Content $Itens -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ })
    Indexar $lista
    $img = New-Object System.Drawing.Bitmap $Foto
    $y1 = [int]($img.Height * $forma.Faixa[0]); $y2 = [int]($img.Height * $forma.Faixa[1])
    $faixa = $img.Clone((New-Object System.Drawing.Rectangle 0, $y1, $img.Width, ($y2 - $y1)), $img.PixelFormat)
    $t = [Diagnostics.Stopwatch]::StartNew()
    $linhas = Ler-Imagem $faixa
    $cartas = @(Achar-Cartas $linhas $lista)
    "leitura em $($t.ElapsedMilliseconds) ms; linhas lidas: $($linhas.Count); cartas: $($cartas.Count)"
    foreach ($c in $cartas) { "  $($c.Item.nome) -> $($c.Item.rotulo) | centro $([int]$c.CX),$([int]($c.CY + $y1))" }
    $mutex.ReleaseMutex()
    return
}

if ($Janela) {
    $Forma[$Tipo].Processo = $Janela
    $dados = [pscustomobject]@{ tipo = $Tipo; itens = @((Get-Content $Itens -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ }) }
    Indexar $dados.itens
}

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({ try { Passo } catch { Anotar-Erro $_ } })
$timer.Start()
[void]$win.ShowDialog()
$timer.Stop()
$mutex.ReleaseMutex()
