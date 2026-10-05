# ADR-0014 - Videochamada: provedor pronto, sala por consulta, sem gravacao

**Status:** aceita
**Data:** 2026-10-05
**Modulo do curso:** 12

## Contexto

A videochamada e o momento em que a telemedicina acontece. Tudo que os
modulos anteriores construiram - agenda, pagamento, consentimento, fila,
prontuario - existe para chegar nela.

Duas perguntas tinham que ser respondidas antes de escrever qualquer linha:
quem transporta o video, e o que acontece com ele depois.

## Decisao

### 1. O video roda num provedor, nao em infraestrutura nossa

Videochamada entre duas pessoas em redes domesticas quase sempre precisa de
servidor no meio: TURN para atravessar o roteador de quem esta atras de NAT,
e um SFU quando ha mais de um fluxo para redistribuir. Fazer isso por conta
significa maquina ligada 24 horas, custando mesmo quando ninguem esta em
consulta, e virando responsabilidade nossa quando cair - sendo que "cair" aqui
quer dizer uma consulta medica interrompida.

O adaptador escolhido e o **Daily** (`apps/api/src/video/provedor-daily.ts`),
atras da interface `ProvedorDeVideo`. Trocar de provedor (Twilio Video,
Vonage, LiveKit) e escrever um arquivo novo na mesma pasta - as telas e as
rotas nao mudam. E a mesma forma usada no pagamento (Modulo 10) e na
assinatura (Modulo 9).

**Consequencia aceita:** dependemos de um terceiro para o ato central do
produto. Em troca, nao operamos midia em tempo real - que e uma
especialidade inteira, nao um detalhe de implementacao.

### 2. Uma sala por consulta, criada na primeira entrada

`salas_de_video.consulta_id` tem indice unico. Uma consulta tem uma sala,
sempre a mesma: se o medico recarrega a pagina ou o paciente cai e volta, os
dois reencontram-se no mesmo lugar. Duas salas para a mesma consulta seriam
duas pessoas em dois lugares, cada uma esperando a outra.

A sala nasce quando alguem entra, nao quando a consulta e marcada: consulta
marcada e consulta que pode ser cancelada, remarcada ou esquecida, e sala
criada no provedor ocupa cota e custa.

### 3. A entrada e por token de uma pessoa, e o token nao e guardado

O endereco da sala nao e segredo - ele aparece na barra do navegador, vai
para o historico, pode ser colado num grupo sem pensar. Quem abre a porta e o
**meeting token**: de uma pessoa, para uma consulta, valido ate o fim da
janela.

Nenhum token e gravado em banco. Token guardado e credencial parada esperando
vazamento, e pior: continuaria valendo depois de quem o pediu perder o
direito de entrar. Cada entrada emite um novo.

A chave da API do provedor fica no servidor e nunca vai ao navegador - com
ela se criaria sala na conta inteira.

### 4. Somente o paciente e o medico DAQUELA consulta entram

Esta e a regra de acesso mais estreita da plataforma, e a unica que nao usa
papel na clinica. Em toda outra tabela "a equipe da clinica ve" e razoavel: a
recepcao precisa da agenda, a administracao precisa dos pagamentos. Aqui nao
existe papel que sirva.

A administracao continua sabendo que o atendimento aconteceu (consultas,
pagamentos, auditoria). O que ela nao tem e caminho para dentro da sala. Nao
e configuravel.

O limite de **2 participantes** vai para o provedor na criacao da sala: mesmo
que um token vaze, nao ha lugar para um terceiro sentar.

**Consequencia aceita:** nao ha, hoje, como colocar um interprete de Libras,
um acompanhante ou um residente na mesma sala. Quando isso entrar, entra como
participante nomeado na consulta - com registro de quem e e por que esta ali -
e nao afrouxando o limite.

### 5. Nao ha gravacao - e nao e so configuracao

A sala e criada sem a capacidade de gravar, e nao existe coluna de gravacao na
tabela. O termo que o paciente le
(`packages/shared/src/consentimento.ts`) diz: *"A videochamada nao e gravada.
O que fica registrado e o que o medico escrever no prontuario, como em
qualquer consulta."*

Gravar consulta medica significaria guardar dado sensivel de saude em video -
com guarda, prazo de retencao, pedido de exclusao e vazamento possivel. Nada
disso foi prometido ao paciente, e por isso nada disso existe. Se um dia
existir, sera com consentimento proprio, separado, e versao nova do termo.

O passo `pnpm db:verificar-video` falha se aparecer coluna com `token`,
`gravac` ou `recording` nesta tabela.

O **bate-papo escrito tambem fica desligado**, por um motivo parecido: o que
e clinicamente relevante tem que ir para o prontuario, que fica registrado e
assinado. Chat seria registro medico fora do registro medico.

### 6. A sala tem janela de horario, definida em um lugar so

`packages/shared/src/video.ts` responde "pode entrar agora?" e e usado pelos
dois lados: a API, para liberar o token, e a tela, para dizer "a sala abre as
14:45" em vez de mostrar um botao que responde erro. Se cada lado tivesse sua
copia, um dia uma mudaria e a outra nao.

Abre 15 minutos antes do inicio (tempo de testar camera e microfone) e fecha
30 minutos depois do fim previsto (consulta atrasa). Fora disso, e com
consulta cancelada, concluida ou sem pagamento, nao abre.

A API e a palavra final; a tela so antecipa o que ela vai responder.

### 7. Encerrar apaga a sala no provedor

Quando o medico encerra, tres coisas acontecem na ordem: a sala e apagada no
provedor, o encerramento e marcado no banco, e a consulta vira `concluida`
(e a linha da fila vira `atendido`). Apagar no provedor e o que faz um token
vazado deixar de valer - sem isso, o resto seria anotacao.

Somente o medico encerra: encerrar fecha a sala para os dois, e o paciente
podendo fazer isso derrubaria o medico no meio do atendimento, por engano
inclusive.

### 8. Entrada e encerramento vao para a auditoria

Para atendimento a distancia, "quem esteve na sala e quando" e parte do que
prova que o atendimento aconteceu. Fica em `auditoria`, que e imutavel por
gatilho desde o Modulo 4 - inclusive para quem tem a chave secreta.

### 9. Ha um provedor simulado, e ele nao sobe em producao sem autorizacao

`VIDEO_PROVEDOR=local_teste` nao faz videochamada nenhuma: ele deixa o fluxo
inteiro rodar na maquina de quem baixou o projeto, sem contratar servico, e a
tela mostra um aviso no lugar da imagem.

Em producao a API **se recusa a subir** com ele, a menos que esteja declarado
`PERMITIR_VIDEO_SIMULADO=sim` - o mesmo desenho da assinatura sem valor legal
(ADR-0011). Nesse caso a API avisa no log a cada inicializacao e informa em
`/saude` (`videoReal: false`), para o site exibir a tarja.

## Consequencias

- A plataforma depende de um provedor externo para o ato central do produto;
  em troca, nao opera servidor de midia.
- Nao existe gravacao de consulta, nem caminho facil para passar a existir -
  e proposital.
- Nao ha, por ora, terceiro na sala (interprete, acompanhante, residente).
- Sem conta no provedor, o projeto roda inteiro, mas sem video - e diz isso
  na tela em vez de parecer quebrado.

## Correcao de rota registrada neste modulo

Ao escrever a tela do paciente foi descoberto que `GET /consultas` filtrava
apenas por clinica, confiando num comentario que afirmava que "o RLS ja limita
ao que a pessoa pode ver". **Nao limitava.** Um paciente logado recebia nome,
horario e motivo das consultas de todos os outros pacientes da clinica.

A causa e uma confusao que vale registrar, porque se repete em todo projeto
com Supabase:

> O RLS protege o acesso **direto** ao banco - o navegador falando com o
> Postgres com a chave publicavel. A API nao entra por essa porta: ela conecta
> com a credencial **dona** do banco, de proposito, para poder fazer o que o
> paciente nao pode. Para o Postgres, ela e o dono - e dono nao e limitado por
> RLS.

RLS e a segunda tranca, nao a primeira. Toda consulta feita pela API precisa
filtrar por quem esta pedindo.

A rota agora escopa por papel (paciente ve as proprias; medico ve as que
atende; recepcao e administracao veem a clinica), e o teste 13 de
`apps/api/src/video.test.ts` existe para que isso nao volte - ele falha se o
filtro sair.
