# HUD do Pick Automatico: painel no canto da tela do PC. O botao liga/desliga o "aceitar a partida sozinho"
# e o painel mostra o que o programa (server.js) esta vendo. Quem abre e o proprio server.js, ao ligar.
param([int]$Porta = 8787)
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# Identidade propria na barra de tarefas: sem isso o Windows junta o painel com o PowerShell e usa o icone dele.
Add-Type -Namespace PickAutomatico -Name Shell -MemberDefinition '[DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);'
[void][PickAutomatico.Shell]::SetCurrentProcessExplicitAppUserModelID('PickAutomatico.Painel')

$Pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$Icone = Join-Path $Pasta 'icone-192.png'
$Base  = "http://127.0.0.1:$Porta" # pelo nome "localhost" cada falha demora o dobro

# So um HUD por vez.
$novo = $false
$mutex = New-Object Threading.Mutex($true, "PickAutomaticoHud$Porta", [ref]$novo)
if (-not $novo) { return }

$Fases = @{
    'None'            = 'No menu'
    'Lobby'           = 'No lobby'
    'Matchmaking'     = 'Na fila'
    'ReadyCheck'      = 'Partida encontrada'
    'ChampSelect'     = 'Seleção de campeões'
    'GameStart'       = 'Abrindo o jogo'
    'InProgress'      = 'Em partida'
    'Reconnect'       = 'Reconectar'
    'WaitingForStats' = 'Fim de jogo'
    'PreEndOfGame'    = 'Fim de jogo'
    'EndOfGame'       = 'Fim de jogo'
}

# Fala com o server.js (so a tela do proprio PC pode usar o /api/pc). Devolve $null se ele nao respondeu.
function Pedir($caminho, [switch]$Post) {
    try {
        $w = New-Object Net.WebClient
        $w.Proxy = $null
        $w.Encoding = [Text.Encoding]::UTF8
        if ($Post) { $txt = $w.UploadString($Base + $caminho, '') } else { $txt = $w.DownloadString($Base + $caminho) }
        return ($txt | ConvertFrom-Json)
    } catch { return $null }
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Pick Automático" Width="420" FontFamily="Bahnschrift" SizeToContent="Height" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" Topmost="True" ResizeMode="NoResize" WindowStartupLocation="Manual" ShowActivated="False">
  <Grid x:Name="Raiz">
  <Ellipse x:Name="Bolinha" Width="35" Height="35" Fill="#0AC8B9" Stroke="#C8AA6E" StrokeThickness="1.5" Visibility="Collapsed"
           HorizontalAlignment="Right" VerticalAlignment="Top" Margin="0,40,55,6"/>
  <Grid Margin="8">
  <Grid.Effect><DropShadowEffect BlurRadius="14" ShadowDepth="0" Opacity="0.75"/></Grid.Effect>
  <Border x:Name="Painel" BorderThickness="0">
    <Border.Background>
      <LinearGradientBrush StartPoint="0,0" EndPoint="0,1"><GradientStop Color="#0B1A30" Offset="0"/><GradientStop Color="#010A13" Offset="1"/></LinearGradientBrush>
    </Border.Background>
    <StackPanel>
    <Grid Height="104">
      <Grid Margin="16,12,14,12">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Path Width="70" Height="78" Stretch="Fill" Stroke="#C8AA6E" StrokeThickness="2" VerticalAlignment="Center"
              Data="M35,0 L70,19.5 L70,58.5 L35,78 L0,58.5 L0,19.5 Z">
          <Path.Fill><ImageBrush x:Name="Img" Stretch="UniformToFill"/></Path.Fill>
        </Path>
        <StackPanel Grid.Column="1" Margin="14,0,8,0" VerticalAlignment="Center">
          <TextBlock Text="Pick Automático" Foreground="#0AC8B9" FontSize="12"/>
          <TextBlock x:Name="Status" Text="..." Foreground="#F0E6D2" FontSize="19" FontWeight="SemiBold" Margin="0,1,0,2" TextTrimming="CharacterEllipsis"/>
          <TextBlock x:Name="Detalhe" Text="" Foreground="#A09B8C" FontSize="12" TextTrimming="CharacterEllipsis"/>
        </StackPanel>
        <StackPanel Grid.Column="2" VerticalAlignment="Center">
          <Button x:Name="Botao" Width="76" Height="30" Cursor="Hand" Content="ON" Background="#0AC8B9" HorizontalAlignment="Right"
                  ToolTip="Aceitar a partida sozinho: clique para ligar ou desligar">
            <Button.Template>
              <ControlTemplate TargetType="Button">
                <Grid>
                  <Path Stretch="Fill" Fill="#1E2328" Stroke="#C8AA6E" StrokeThickness="1" Data="M8,0 L76,0 L76,22 L68,30 L0,30 L0,8 Z"/>
                  <Rectangle x:Name="Pino" Width="24" Height="20" HorizontalAlignment="Left" Margin="5,0,0,0" Fill="{TemplateBinding Background}"/>
                  <TextBlock x:Name="Rotulo" Text="{TemplateBinding Content}" Foreground="#F0E6D2" FontSize="13" FontWeight="Bold"
                             HorizontalAlignment="Right" VerticalAlignment="Center" Margin="0,0,11,0"/>
                </Grid>
                <ControlTemplate.Triggers>
                  <Trigger Property="Content" Value="OFF">
                    <Setter TargetName="Pino" Property="HorizontalAlignment" Value="Right"/>
                    <Setter TargetName="Pino" Property="Margin" Value="0,0,5,0"/>
                    <Setter TargetName="Rotulo" Property="HorizontalAlignment" Value="Left"/>
                    <Setter TargetName="Rotulo" Property="Margin" Value="10,0,0,0"/>
                  </Trigger>
                  <Trigger Property="IsMouseOver" Value="True"><Setter Property="Opacity" Value="0.85"/></Trigger>
                </ControlTemplate.Triggers>
              </ControlTemplate>
            </Button.Template>
          </Button>
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,12,0,0">
            <TextBlock x:Name="Sino" Text="&#xE7ED;" FontFamily="Segoe MDL2 Assets" Foreground="#C8AA6E" FontSize="14" Cursor="Hand" Margin="0,0,13,0"
                       ToolTip="Avisos no celular: clique para ligar ou desligar"/>
            <TextBlock x:Name="Clipe" Text="&#xE718;" FontFamily="Segoe MDL2 Assets" Foreground="#5B5A56" FontSize="14" Cursor="Hand" Margin="0,0,13,0"
                       ToolTip="Manter o painel aberto (não virar bolinha)"/>
            <TextBlock x:Name="Ajuda" Text="&#xE946;" FontFamily="Segoe MDL2 Assets" Foreground="#C8AA6E" FontSize="14" Cursor="Hand" Margin="0,0,13,0"
                       ToolTip="Mostrar ou esconder as opções"/>
            <TextBlock x:Name="Fechar" Text="&#xE8BB;" FontFamily="Segoe MDL2 Assets" Foreground="#A09B8C" FontSize="13" Cursor="Hand"
                       ToolTip="Fechar (desliga o Pick Automático)"/>
          </StackPanel>
        </StackPanel>
      </Grid>
    </Grid>
    <Border x:Name="Info" Visibility="Collapsed" BorderBrush="#26334D" BorderThickness="0,1,0,0" Margin="14,0,14,12" Padding="0,10,0,0">
      <StackPanel>
        <TextBlock Text="O BOTÃO" Foreground="#C8AA6E" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
        <TextBlock Text="ON: aceita a partida sozinho quando a fila encontra" Foreground="#F0E6D2" FontSize="12" Margin="0,2"/>
        <TextBlock Text="OFF: você aceita pelo celular ou no PC" Foreground="#F0E6D2" FontSize="12" Margin="0,2"/>
        <TextBlock Text="Banir, escolher e trocar no ARAM continuam pelo celular." Foreground="#A09B8C" FontSize="11" Margin="0,2,0,0" TextWrapping="Wrap"/>
        <TextBlock x:Name="LigarRunas" Text="" Foreground="#0AC8B9" FontSize="12" Margin="0,10,0,0" Cursor="Hand"
                   ToolTip="Montar sozinho a página de runas do campeão escolhido"/>
        <TextBlock x:Name="AbrirPagina" Text="Abrir a seleção de campeões neste PC" Foreground="#0AC8B9" FontSize="12" Margin="0,10,0,0" Cursor="Hand"/>
        <TextBlock x:Name="AbrirQr" Text="Ligar um celular (QR codes)" Foreground="#0AC8B9" FontSize="12" Margin="0,6,0,0" Cursor="Hand"/>
      </StackPanel>
    </Border>
    <Border x:Name="Melhores" Visibility="Collapsed" BorderBrush="#26334D" BorderThickness="0,1,0,0" Margin="14,0,14,12" Padding="0,10,0,0">
      <StackPanel>
        <TextBlock x:Name="MelhoresTitulo" Foreground="#C8AA6E" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
        <TextBlock x:Name="MelhoresLeitura" Foreground="#A09B8C" FontSize="11" TextWrapping="Wrap" Margin="0,0,0,5" Visibility="Collapsed"/>
        <StackPanel x:Name="MelhoresLista"/>
      </StackPanel>
    </Border>
    <Border x:Name="Jogo" Visibility="Collapsed" BorderBrush="#26334D" BorderThickness="0,1,0,0" Margin="14,0,14,12" Padding="0,10,0,0">
      <StackPanel>
        <TextBlock Text="ADVERSÁRIOS" Foreground="#C8AA6E" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
        <StackPanel x:Name="JogoLista"/>
      </StackPanel>
    </Border>
    <Border x:Name="Itens" Visibility="Collapsed" BorderBrush="#26334D" BorderThickness="0,1,0,0" Margin="14,0,14,12" Padding="0,10,0,0">
      <StackPanel>
        <TextBlock x:Name="ItensTitulo" Foreground="#C8AA6E" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
        <StackPanel x:Name="ItensLista"/>
      </StackPanel>
    </Border>
    <Border x:Name="Augs" Visibility="Collapsed" BorderBrush="#26334D" BorderThickness="0,1,0,0" Margin="14,0,14,12" Padding="0,10,0,0">
      <StackPanel>
        <TextBlock x:Name="AugsTitulo" Foreground="#C8AA6E" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
        <StackPanel x:Name="AugsLista"/>
      </StackPanel>
    </Border>
    </StackPanel>
  </Border>
  <Path x:Name="Contorno" Stroke="#C8AA6E" StrokeThickness="1.5" IsHitTestVisible="False"/>
  </Grid>
  </Grid>
</Window>
'@

$win      = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$status   = $win.FindName('Status')
$detalhe  = $win.FindName('Detalhe')
$botao    = $win.FindName('Botao')
$painel   = $win.FindName('Painel')
$bolinha  = $win.FindName('Bolinha')
$info     = $win.FindName('Info')
$contorno = $win.FindName('Contorno')
function Chanfro($w, $h, $c, $m) {
    # contorno com os 4 cantos cortados (como os botoes do cliente do LoL); m = recuo para o traco caber
    $pts = @(@(($c + $m), $m), @(($w - $c - $m), $m), @(($w - $m), ($c + $m)), @(($w - $m), ($h - $c - $m)), @(($w - $c - $m), ($h - $m)), @(($c + $m), ($h - $m)), @($m, ($h - $c - $m)), @($m, ($c + $m)))
    $inv = [Globalization.CultureInfo]::InvariantCulture
    $txt = ($pts | ForEach-Object { ([double]$_[0]).ToString($inv) + ',' + ([double]$_[1]).ToString($inv) }) -join ' L '
    [Windows.Media.Geometry]::Parse("M $txt Z")
}
$painel.Add_SizeChanged({
    $w = $painel.ActualWidth; $h = $painel.ActualHeight
    if ($w -lt 30) { return }
    $painel.Clip = Chanfro $w $h 14 0
    $contorno.Data = Chanfro $w $h 14 0.75
})
$verde    = [Windows.Media.BrushConverter]::new().ConvertFromString('#0AC8B9')
$vermelho = [Windows.Media.BrushConverter]::new().ConvertFromString('#E84057')

if (Test-Path $Icone) {
    $bmp = New-Object Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit(); $bmp.CacheOption = 'OnLoad'; $bmp.UriSource = [Uri]$Icone; $bmp.EndInit()
    $win.FindName('Img').ImageSource = $bmp
    $win.Icon = $bmp
}

$area = [Windows.SystemParameters]::WorkArea
$win.Left = $area.Right - $win.Width - 8
$win.Top  = $area.Top + 8

# Uma linha das listas de ARAM: figura, nome, texto menor embaixo e o selo do tier a direita.
$Pincel = [Windows.Media.BrushConverter]::new()
$CorTier = @{ 0 = '#FF6B81'; 1 = '#F5A623'; 2 = '#5BC0EB' }
function Linha($figura, $nome, $sub, $tier) {
    $g = New-Object Windows.Controls.Grid
    $g.Margin = '0,3,0,3'
    foreach ($w in 'Auto', '*', 'Auto') {
        $c = New-Object Windows.Controls.ColumnDefinition
        if ($w -eq '*') { $c.Width = New-Object Windows.GridLength(1, 'Star') } else { $c.Width = [Windows.GridLength]::Auto }
        $g.ColumnDefinitions.Add($c)
    }
    $img = New-Object Windows.Controls.Image
    $img.Width = 28; $img.Height = 28
    try { $img.Source = New-Object Windows.Media.Imaging.BitmapImage([Uri]$figura) } catch {}
    [void]$g.Children.Add($img)
    $txt = New-Object Windows.Controls.StackPanel
    $txt.Margin = '10,0,8,0'; $txt.VerticalAlignment = 'Center'
    $t1 = New-Object Windows.Controls.TextBlock
    $t1.Text = $nome; $t1.Foreground = $Pincel.ConvertFromString('#F0E6D2'); $t1.FontSize = 13; $t1.TextTrimming = 'CharacterEllipsis'
    [void]$txt.Children.Add($t1)
    if ($sub) {
        $t2 = New-Object Windows.Controls.TextBlock
        $t2.Text = $sub; $t2.Foreground = $Pincel.ConvertFromString('#A09B8C'); $t2.FontSize = 11; $t2.TextTrimming = 'CharacterEllipsis'
        [void]$txt.Children.Add($t2)
    }
    [Windows.Controls.Grid]::SetColumn($txt, 1)
    [void]$g.Children.Add($txt)
    if ($null -ne $tier) {
        $selo = New-Object Windows.Controls.TextBlock
        if ($tier -eq 0) { $selo.Text = 'OP' } else { $selo.Text = "T$tier" }
        $cor = $CorTier[[int]$tier]; if (-not $cor) { $cor = '#A09B8C' }
        $selo.Foreground = $Pincel.ConvertFromString($cor); $selo.FontSize = 13; $selo.FontWeight = 'Bold'; $selo.VerticalAlignment = 'Center'
        [Windows.Controls.Grid]::SetColumn($selo, 2)
        [void]$g.Children.Add($selo)
    }
    return $g
}

# Uma fileira de itens: o rotulo e as figuras lado a lado (o nome aparece ao parar o mouse em cima).
function Fileira($rotulo, $lista, $pasta = 'item') {
    $p = New-Object Windows.Controls.StackPanel
    $p.Orientation = 'Horizontal'; $p.Margin = '0,3,0,3'
    $t = New-Object Windows.Controls.TextBlock
    $t.Text = $rotulo; if ($rotulo) { $t.Width = 62 }; $t.Foreground = $Pincel.ConvertFromString('#A09B8C'); $t.FontSize = 11; $t.VerticalAlignment = 'Center'
    [void]$p.Children.Add($t)
    foreach ($i in @($lista)) {
        $img = New-Object Windows.Controls.Image
        $img.Width = 30; $img.Height = 30; $img.Margin = '0,0,5,0'; $img.ToolTip = $i.nome
        try { $img.Source = New-Object Windows.Media.Imaging.BitmapImage([Uri]"$Base/$pasta/$($i.id)") } catch {}
        [void]$p.Children.Add($img)
    }
    return $p
}

# Uma linha de texto solta dentro de uma secao.
function Texto($t, $cor = '#F0E6D2') {
    $b = New-Object Windows.Controls.TextBlock
    $b.Text = $t; $b.Foreground = $Pincel.ConvertFromString($cor); $b.FontSize = 12; $b.TextWrapping = 'Wrap'; $b.Margin = '0,2,0,2'
    return $b
}

# Nos modos ARAM: melhores campeoes entre as suas opcoes (na selecao) e melhores aprimoramentos (Desordem).
$melhoresLeitura = $win.FindName('MelhoresLeitura')
$melhores = $win.FindName('Melhores'); $melhoresTitulo = $win.FindName('MelhoresTitulo'); $melhoresLista = $win.FindName('MelhoresLista')
$jogo = $win.FindName('Jogo'); $jogoLista = $win.FindName('JogoLista')
$itens = $win.FindName('Itens'); $itensTitulo = $win.FindName('ItensTitulo'); $itensLista = $win.FindName('ItensLista')
$augs = $win.FindName('Augs'); $augsTitulo = $win.FindName('AugsTitulo'); $augsLista = $win.FindName('AugsLista')
$assinaturaAram = ''
function Mostrar-Aram($e) {
    $sig = ($e.jogo | ConvertTo-Json -Compress -Depth 4) + '|' + ($e.itens | ConvertTo-Json -Compress -Depth 4) + '|' + [string]$e.leitura + '|' + ($e.melhores | ConvertTo-Json -Compress -Depth 4) + '|' + ($e.desordem | ConvertTo-Json -Compress -Depth 4)
    if ($sig -eq $script:assinaturaAram) { return }
    $script:assinaturaAram = $sig
    $melhoresLista.Children.Clear()
    $augsLista.Children.Clear()
    $itensLista.Children.Clear()
    $jogoLista.Children.Clear()
    # com a partida aberta: quem esta do outro lado e o que isso pede
    if ($e.jogo -and @($e.jogo.inimigos).Count -gt 0) {
        [void]$jogoLista.Children.Add((Fileira '' $e.jogo.inimigos 'icon'))
        foreach ($l in @($e.jogo.leitura)) { [void]$jogoLista.Children.Add((Texto $l)) }
        if (@($e.jogo.cuidado).Count) { [void]$jogoLista.Children.Add((Texto ("Cuidado na rota: " + (@($e.jogo.cuidado) -join ', ')) '#FF8B99')) }
        if (@($e.jogo.vantagem).Count) { [void]$jogoLista.Children.Add((Texto ("Você leva vantagem sobre: " + (@($e.jogo.vantagem) -join ', ')) '#3CCF7E')) }
        $jogo.Visibility = 'Visible'
    } else { $jogo.Visibility = 'Collapsed' }
    $it = $e.itens
    if ($it -and @($it.nucleo).Count -gt 0) {
        $itensTitulo.Text = ([string]$it.titulo).ToUpper()
        if (@($it.inicial).Count) { [void]$itensLista.Children.Add((Fileira 'Início' $it.inicial)) }
        if (@($it.botas).Count) { [void]$itensLista.Children.Add((Fileira 'Botas' $it.botas)) }
        $n = 0
        foreach ($linha in @($it.nucleo)) { $n++; [void]$itensLista.Children.Add((Fileira "Build $n" $linha)) }
        $itens.Visibility = 'Visible'
    } else { $itens.Visibility = 'Collapsed' }
    $lista = @($e.melhores)
    if ($lista.Count -gt 0) {
        $melhoresTitulo.Text = ([string]$e.tituloMelhores).ToUpper()
        $melhoresLeitura.Text = [string]$e.leitura
        $melhoresLeitura.Visibility = if ($e.leitura) { 'Visible' } else { 'Collapsed' }
        foreach ($c in $lista) { [void]$melhoresLista.Children.Add((Linha "$Base/icon/$($c.id)" $c.nome $c.motivo $null)) }
        $melhores.Visibility = 'Visible'
    } else { $melhores.Visibility = 'Collapsed' }
    if ($e.desordem -and @($e.desordem.lista).Count -gt 0) {
        if ($e.desordem.doCampeao) { $augsTitulo.Text = "MELHORES APRIMORAMENTOS  ·  $($e.desordem.nome)".ToUpper() }
        else { $augsTitulo.Text = 'MELHORES APRIMORAMENTOS  ·  GERAL' }
        foreach ($a in @($e.desordem.lista)) { [void]$augsLista.Children.Add((Linha "$Base/aug/$($a.id)" $a.nome '' $a.tier)) }
        $augs.Visibility = 'Visible'
    } else { $augs.Visibility = 'Collapsed' }
}

$estado = $null
$falhas = 0
function Atualizar {
    $e = Pedir '/api/pc'
    if (-not $e) {
        # o programa foi desligado por fora (parar.bat): o painel vai junto
        $script:falhas++
        if ($script:falhas -ge 3) { $win.Close() }
        return
    }
    $script:falhas = 0
    $script:estado = $e
    $script:fixo = [bool]$e.painelFixo
    if ($script:fixo) { $clipe.Foreground = $Pincel.ConvertFromString('#C8AA6E'); if ($script:compacto) { Compactar $false } }
    else { $clipe.Foreground = $Pincel.ConvertFromString('#5B5A56') }
    if ($e.aceitarSozinho) { $botao.Background = $verde; $botao.Content = 'ON'; $bolinha.Fill = $verde }
    else { $botao.Background = $vermelho; $botao.Content = 'OFF'; $bolinha.Fill = $vermelho }

    if (-not $e.lol) { $status.Text = 'LoL fechado' }
    elseif ($Fases.ContainsKey([string]$e.phase)) { $status.Text = $Fases[[string]$e.phase] }
    else { $status.Text = [string]$e.phase }

    if ($e.phase -eq 'ReadyCheck' -and $e.aceito) { $detalhe.Text = 'Partida aceita' }
    elseif ($e.aceitarSozinho) { $detalhe.Text = 'Aceita a partida sozinho' }
    else { $detalhe.Text = 'Você aceita pelo celular' }
    if ($e.fila -and $e.phase -ne 'None') { $detalhe.Text += "  ·  $($e.fila)" }
    if ($e.runas) { $detalhe.Text = [string]$e.runas }
    if ($e.avisarCelular) { $sino.Opacity = 1; $sino.ToolTip = 'Avisos no celular: LIGADOS (clique para desligar)' }
    else { $sino.Opacity = 0.4; $sino.ToolTip = 'Avisos no celular: desligados (clique para ligar)' }
    $ligarRunas.Text = if ($e.puxarRunas) { 'Runas automáticas: LIGADAS (clique para desligar)' } else { 'Runas automáticas: desligadas (clique para ligar)' }
    Mostrar-Aram $e
}

# Parado por 3 s, o painel vira so a bolinha (25% de opacidade); mexer o mouse em cima abre de novo.
$compacto = $false
$fixo = $false # o clipe: preso, o painel nao vira bolinha
$clipe = $win.FindName('Clipe')
$ligarRunas = $win.FindName('LigarRunas')
$sino = $win.FindName('Sino')
$ultimoMexer = Get-Date
$ultimaPos = ''
function Compactar($sim) {
    if ($sim) { $painel.Visibility = 'Collapsed'; $bolinha.Visibility = 'Visible'; $win.Opacity = 0.25 }
    else { $bolinha.Visibility = 'Collapsed'; $painel.Visibility = 'Visible'; $win.Opacity = 1 }
    $script:compacto = $sim
}
# Compara a posicao na tela: trocar o painel pela bolinha dispara MouseMove sozinho, sem o mouse ter andado.
$win.Add_MouseMove({
    $p = $win.PointToScreen($_.GetPosition($win))
    $pos = "$([int]$p.X),$([int]$p.Y)"
    if ($pos -ne $script:ultimaPos) {
        $script:ultimaPos = $pos
        $script:ultimoMexer = Get-Date
        if ($script:compacto) { Compactar $false }
    }
})
$timerParado = New-Object Windows.Threading.DispatcherTimer
$timerParado.Interval = [TimeSpan]::FromMilliseconds(250)
$timerParado.Add_Tick({
    if (-not $script:fixo -and -not $script:compacto -and ((Get-Date) - $script:ultimoMexer).TotalSeconds -ge 3) { Compactar $true }
})
$timerParado.Start()

$botao.Add_Click({
    $script:ultimoMexer = Get-Date
    if ($script:estado -and $script:estado.aceitarSozinho) { $ligado = 0 } else { $ligado = 1 }
    [void](Pedir "/api/pc?acao=auto&ligado=$ligado" -Post)
    Atualizar
})
$clipe.Add_MouseLeftButtonDown({
    $_.Handled = $true
    $script:ultimoMexer = Get-Date
    if ($script:fixo) { $ligado = 0 } else { $ligado = 1 }
    [void](Pedir "/api/pc?acao=fixo&ligado=$ligado" -Post)
    Atualizar
})
$sino.Add_MouseLeftButtonDown({
    $_.Handled = $true
    $script:ultimoMexer = Get-Date
    if ($script:estado -and $script:estado.avisarCelular) { $ligado = 0 } else { $ligado = 1 }
    [void](Pedir "/api/pc?acao=celular&ligado=$ligado" -Post)
    Atualizar
})
$ligarRunas.Add_MouseLeftButtonDown({
    $_.Handled = $true
    if ($script:estado -and $script:estado.puxarRunas) { $ligado = 0 } else { $ligado = 1 }
    [void](Pedir "/api/pc?acao=runas&ligado=$ligado" -Post)
    Atualizar
})
# O X desliga o programa inteiro, como o parar.bat.
$win.FindName('Fechar').Add_MouseLeftButtonDown({
    $_.Handled = $true
    [void](Pedir '/api/pc?acao=desligar' -Post)
    $win.Close()
})
$win.FindName('Ajuda').Add_MouseLeftButtonDown({
    $_.Handled = $true
    if ($info.Visibility -eq 'Visible') { $info.Visibility = 'Collapsed' } else { $info.Visibility = 'Visible' }
})
$win.FindName('AbrirPagina').Add_MouseLeftButtonDown({
    $_.Handled = $true
    if ($script:estado -and $script:estado.pagina) { Start-Process $script:estado.pagina }
})
$win.FindName('AbrirQr').Add_MouseLeftButtonDown({ $_.Handled = $true; Start-Process "http://localhost:$Porta/pc" })
$win.Add_MouseLeftButtonDown({ try { $win.DragMove() } catch {} })

$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({ Atualizar })
$timer.Start()
Atualizar

[void]$win.ShowDialog()
$timer.Stop()
$timerParado.Stop()
$mutex.ReleaseMutex()
