# Pick Automático

Seleção de campeões do League of Legends pelo celular.

Um programinha fica rodando no PC onde o LoL está aberto. Quando a fila acha partida, o celular recebe um aviso e você aceita, bane, escolhe e troca de campeão por uma página, vendo ao vivo o que o seu time está pegando.

## O que faz

- **Aceita a partida sozinho** quando a fila encontra. Um painel no canto da tela do PC tem o botão: verde **ON** aceita sozinho, um clique vira vermelho **OFF** e você volta a aceitar pelo celular.
- **Aviso de partida encontrada** pelo [ntfy](https://ntfy.sh), com botão de aceitar quando o aceitar sozinho está desligado.
- **Normal:** caixa de busca com a foto dos campeões, em ordem alfabética, filtrando a cada letra.
- **Ranqueada / Flex:** a mesma caixa para banir e depois para escolher. Campeão banido ou já pego fica apagado.
- **ARAM / ARAM: Desordem:** mostra o campeão que veio para você, as opções e o banco do time; cada toque troca na hora.
- **ARAM e ARAM: Desordem no painel do PC:** na seleção, os melhores campeões entre as suas opções e o banco, com o tier de cada um no modo; na Desordem, os 10 melhores aprimoramentos do seu campeão, com o tier, durante a seleção e a partida inteira.
- **Itens na Desordem:** o painel mostra os itens mais usados com o seu campeão no modo: iniciais, botas e as três builds mais comuns.
- **Nota em cima das cartas:** o programa lê o nome de cada carta na tela e desenha por cima o tier e uma linha em volta, mais grossa e verde na melhor. Vale para as cartas de campeão na seleção do ARAM e para as cartas de aprimoramento da Desordem, já pensando no seu campeão.
- **Time ao vivo:** os ícones atualizam conforme os outros jogadores marcam e travam.
- **Dica:** lê o seu time e o adversário (falta de tanque ou de dano mágico, time sem linha de frente, adversário cheio de assassinos ou de tanques...) e sugere os campeões que resolvem, dando peso aos que você mais joga e aos que levam vantagem na sua rota contra quem o adversário já pegou. Ao lado vem o motivo de cada um.

## Do que precisa

- Windows com o League of Legends instalado.
- [Node.js](https://nodejs.org) versão 18 ou mais nova. Se não tiver, o `iniciar.bat` oferece instalar a versão oficial pelo `winget`, o instalador da Microsoft que já vem no Windows 10 e 11.
- Celular na mesma rede do PC (o PC pode estar no cabo, desde que seja o mesmo roteador).

## Como usar

1. Baixe o projeto (botão **Code → Download ZIP**) e extraia numa pasta.
2. Clique duas vezes em `iniciar.bat`. Na primeira vez o Windows pede permissão para liberar a porta 8787 no firewall.
3. O navegador abre uma tela com três QR codes. Leia cada um com a câmera do celular:
   1. baixar o app ntfy;
   2. ligar o ntfy ao seu PC (depois de ler, mande o aviso de teste);
   3. abrir a página e adicioná-la à tela inicial (menu ⋮ → Adicionar à tela inicial).
4. A janela avisa que ligou e fecha sozinha em 5 segundos: o programa continua rodando escondido. Para desligar, clique em `parar.bat`. Na primeira vez ele cria o atalho **Pick Automático**, com ícone, nesta pasta e na Área de Trabalho: nas próximas vezes é só clicar nele.

Para ver os QR codes de novo (celular novo), use `configurar.bat`.

## Confrontos (counters)

Os confrontos por rota vêm do [counterstats.net](https://www.counterstats.net): o programa baixa a tabela sozinho na primeira vez que liga (uns 3 minutos, em segundo plano) e de novo a cada 14 dias, guardando em `confrontos-site.json`. Para não baixar nada, ponha `"confrontosDoSite": false` no `config.json`. Para baixar na hora: `node atualizar-confrontos.js`.

Se quiser ensinar confrontos seus, que valem em qualquer rota e somam aos do site, edite o `confrontos.json` com os nomes dos campeões:

```json
{
  "Yasuo": {
    "perdePara": ["Malphite", "Renekton"],
    "ganhaDe": ["Lux"],
    "combinaCom": ["Malphite", "Diana"]
  }
}
```

Com isso, quando o adversário pegar Yasuo, Malphite e Renekton sobem na dica e Lux desce; e quando um amigo pegar Yasuo, Malphite e Diana sobem. Vale a partir da próxima vez que o programa ligar.

## O painel do PC

Ao ligar, aparece um painel pequeno no canto da tela, que fica por cima do jogo e vira uma bolinha quando o mouse sai de cima.

- Botão redondo: liga e desliga o aceitar sozinho.
- Arraste pelo fundo para mudar de lugar.
- **Clipe** (abaixo do ✕): preso, o painel fica aberto em vez de virar bolinha.
- **?** mostra os atalhos para abrir a seleção de campeões no próprio PC e os QR codes do celular.
- **✕** desliga o programa inteiro (o mesmo que o `parar.bat`).
- Em ARAM e ARAM: Desordem o painel cresce para mostrar os melhores campeões e os melhores aprimoramentos. Passe o mouse na bolinha para ver. Para aparecer por cima do jogo, o LoL precisa estar em "sem bordas" ou "janela" (não em tela cheia).

As notas em cima das cartas de aprimoramento usam o leitor de texto do próprio Windows (precisa ter o idioma do jogo instalado no Windows) e só aparecem com o jogo em "sem bordas" ou "janela". Em tela cheia, use a lista do painel num segundo monitor.

## Sua chave

Na primeira vez que liga, o programa cria o arquivo `config.json` com uma chave e um tópico do ntfy sorteados só para você. Sem a chave ninguém comanda a sua seleção, e sem o tópico ninguém recebe os seus avisos. Não compartilhe esse arquivo nem o link da página. Para trocar tudo, apague o `config.json` e ligue de novo.

## Quando dá erro

Se alguma coisa falhar (o site dos confrontos mudou, o LoL passou a responder diferente), o programa confere no GitHub se já saiu uma versão mais nova. Se saiu, você recebe um aviso no ntfy e uma faixa na página pedindo para baixar de novo. Se não saiu, ele segue com o que tem.

## Limites conhecidos

- Só funciona com o celular na mesma rede do PC.
- As "cartas" do ARAM (as 2 ou 3 opções de campeão) ainda não foram confirmadas numa partida real e podem não aparecer; o banco e a troca funcionam.
- O navegador não deixa adicionar à tela inicial sozinho: é um toque seu.

## Créditos

Os confrontos são lidos das páginas públicas do [counterstats.net](https://www.counterstats.net) (MOBAFire), e os tiers de ARAM e os aprimoramentos da Desordem, das páginas públicas do [op.gg](https://op.gg/lol/modes/aram-mayhem); cada PC baixa a sua cópia, o projeto não redistribui esses dados.

Os QR codes usam o [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) de Kazuhiko Arase (licença MIT), em `vendor/qrcode.js`.

O ícone do app é a arte oficial da Anivia, da Riot Games.

Este projeto não é endossado pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém envolvido oficialmente em produzir ou gerenciar o League of Legends.
