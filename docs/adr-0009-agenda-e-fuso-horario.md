# ADR-0009 - Agenda: grade calculada, travas no banco e fuso por clinica

**Status:** aceita
**Data:** 2026-08-28
**Modulo do curso:** 7

## Contexto

Marcar consulta e a primeira operacao da plataforma em que duas pessoas
podem querer a mesma coisa ao mesmo tempo. Isso muda o que precisa ser
garantido e onde.

## Decisao

### 1. Guardamos a regra, nao os horarios

A agenda do medico e uma grade semanal (`disponibilidades`): "segunda das
8h as 12h, consultas de 30 minutos". Os horarios livres sao calculados na
hora, subtraindo consultas marcadas e bloqueios.

A alternativa - gerar uma linha por horario livre - obrigaria a criar
registros para o futuro indefinidamente e a apagar milhares deles a cada
mudanca de grade. Mudar a regra e uma linha; mudar o resultado sao milhares.

### 2. A trava contra dupla marcacao mora no banco

Conferir "esse horario esta livre?" no codigo da API nao basta: entre a
conferencia e a gravacao cabe outra requisicao. Dois pacientes clicando no
mesmo segundo criariam duas consultas no mesmo horario.

Usamos restricoes de exclusao do Postgres (`EXCLUDE USING gist`), que
recusam duas linhas cujos intervalos de tempo se cruzem:

- `consultas_sem_sobreposicao_do_medico` - ninguem atende dois ao mesmo tempo
- `consultas_sem_sobreposicao_do_paciente` - ninguem e atendido duas vezes
- `disponibilidades_sem_sobreposicao` - blocos da grade nao se cruzam

As duas primeiras valem apenas para `agendada` e `em_andamento`: horario de
consulta cancelada volta a ficar livre.

A trava do medico NAO considera a clinica, de proposito: a mesma medica
atendendo em dois lugares nao pode ser marcada as 9h nos dois.

### 3. A API confere antes, mesmo assim

O horario pedido tem de estar entre os que a agenda oferece - senao alguem
marcaria "09:07" mandando JSON na mao, furando a grade. A trava do banco
continua sendo a ultima palavra: quando ela dispara, a API traduz para
"este horario acabou de ser ocupado, escolha outro".

### 4. O calculo dos horarios e compartilhado

`calcularHorariosLivres` vive em `@tele/shared`, nao na API. Se cada lado
calculasse do seu jeito, o site mostraria "10:30 livre", a pessoa clicaria,
e levaria erro. Sendo a mesma funcao, o que a tela oferece e o que o
servidor aceita.

### 5. Fuso por clinica, sempre nome IANA

`clinicas.fuso_horario` guarda "America/Sao_Paulo", "America/Manaus" -
nunca "-03:00". Deslocamento fixo nao sabe de horario de verao: uma
clinica cadastrada assim erraria a agenda em uma hora durante parte do ano.
O nome IANA carrega esse historico.

A grade e escrita em hora LOCAL da clinica, porque e assim que a recepcao
pensa ("segunda, 8h"). A consulta e gravada em instante absoluto
(`timestamptz`). A conversao acontece num unico lugar, com o fuso da
clinica - nunca com o do computador de quem esta olhando.

Trocar o fuso depois **nao move consultas ja marcadas**: elas guardam o
instante, que nao mudou. O que muda e a leitura da grade semanal.

### 6. Cancelamento sempre com autor, data e motivo

Um `CHECK` no banco garante que os tres andam juntos. Cancelamento e
evento de prontuario: "quem cancelou e por que" faz parte da historia do
atendimento, e a auditoria registra tambem com quantas horas de
antecedencia - numero que a clinica vai querer acompanhar.

### 7. O status anda para frente

`agendada -> em_andamento -> concluida`, ou `cancelada`. Sem pular etapa e
sem voltar: consulta concluida nao se cancela, porque ela aconteceu.

## Consequencias

- Positivas: dupla marcacao e impossivel, nao improvavel; a agenda e leve
  (nenhuma linha gerada para o futuro); a plataforma atende clinicas em
  qualquer fuso do Brasil.
- Negativas: o calculo dos horarios roda a cada consulta da tela, entao
  precisa continuar barato - por isso os indices por (medico, inicio) e
  (clinica, inicio). Se um dia pesar, a saida e cache por medico/dia,
  invalidado a cada marcacao, e nao gerar linhas.
- A restricao de exclusao depende da extensao `btree_gist` e de um tipo
  `timerange` que criamos (o Postgres traz faixas de data e data-hora, mas
  nao de hora do dia). Ambos entram pela migracao 0007.
