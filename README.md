# Pick Automático

Seleção de campeões do League of Legends pelo celular.

Um programinha fica rodando no PC onde o LoL está aberto. Quando a fila acha partida, o celular recebe um aviso e você aceita, bane, escolhe e troca de campeão por uma página, vendo ao vivo o que o seu time está pegando.

## O que faz

- **Aviso de partida encontrada** pelo [ntfy](https://ntfy.sh), com botão de aceitar.
- **Normal:** caixa de busca com a foto dos campeões, em ordem alfabética, filtrando a cada letra.
- **Ranqueada / Flex:** a mesma caixa para banir e depois para escolher. Campeão banido ou já pego fica apagado.
- **ARAM / ARAM: Desordem:** mostra o campeão que veio para você, as opções e o banco do time; cada toque troca na hora.
- **Time ao vivo:** os ícones atualizam conforme os outros jogadores marcam e travam.
- **Dica:** mostra o que falta no time (tanque, dano mágico, atirador, suporte) e sugere dos seus campeões com mais maestria.

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
4. Deixe a janela preta aberta enquanto joga. Nas próximas vezes é só clicar no `iniciar.bat`.

Para ver os QR codes de novo (celular novo), use `configurar.bat`.

## Sua chave

Na primeira vez que liga, o programa cria o arquivo `config.json` com uma chave e um tópico do ntfy sorteados só para você. Sem a chave ninguém comanda a sua seleção, e sem o tópico ninguém recebe os seus avisos. Não compartilhe esse arquivo nem o link da página. Para trocar tudo, apague o `config.json` e ligue de novo.

## Limites conhecidos

- Só funciona com o celular na mesma rede do PC.
- As "cartas" do ARAM (as 2 ou 3 opções de campeão) ainda não foram confirmadas numa partida real e podem não aparecer; o banco e a troca funcionam.
- O navegador não deixa adicionar à tela inicial sozinho: é um toque seu.

## Créditos

Os QR codes usam o [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) de Kazuhiko Arase (licença MIT), em `vendor/qrcode.js`.

Este projeto não é endossado pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém envolvido oficialmente em produzir ou gerenciar o League of Legends.
