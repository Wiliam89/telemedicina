# ADR-0015 - Prontuario completo: ficha clinica, sinais vitais e anexos

**Status:** aceita
**Data:** 2026-10-26

## Contexto

Ate o Modulo 12 o prontuario era so a evolucao SOAP de cada consulta. As
plataformas de referencia (iClinic, Amplimed, Conexa) mostram ao medico,
antes de atender, um RESUMO do paciente - alergias, remedios em uso,
doencas, antecedentes -, o historico de medidas (pressao, peso, glicemia)
com graficos, e os exames que o paciente trouxe. Sem isso o medico
prescreve sem saber da alergia, e a teleconsulta fica pior que a
presencial.

## Decisao

### 1. Tres tabelas novas, todas SOMENTE INSERCAO

| Tabela | O que guarda | Como "muda" |
|---|---|---|
| `fichas_clinicas` | alergias, medicamentos, comorbidades, antecedentes, habitos, tipo sanguineo | cada salvamento cria a VERSAO seguinte; a atual e a maior |
| `sinais_vitais` | peso, altura, PA, FC, FR, temperatura, SpO2, glicemia | medida errada se corrige com outra medida |
| `anexos` | ficha do arquivo (titulo, categoria, hash, tamanho) | arquivo enviado fica |

Um gatilho recusa UPDATE e DELETE nas tres - vale ate para o dono do banco,
como na evolucao finalizada (ADR-0010). A pericia ve quem registrou o que,
quando, e cada versao da ficha.

### 2. Quem le dado clinico

O proprio paciente e o medico que o atende NESTA clinica (existe consulta
entre os dois). Recepcao e administracao veem o cadastro (nome, idade,
telefone, proxima consulta) e param ai - LGPD art. 6, III (necessidade).
A regra esta na API e repetida no RLS. Toda leitura por profissional gera
auditoria `prontuario.lido`.

### 3. O paciente participa

Ele le o proprio prontuario (Codigo de Etica Medica, art. 88), envia
exames e informa medidas feitas em casa. Essas medidas ficam marcadas com
`origem = 'paciente'` - o medico sabe a diferenca entre o que mediu e o que
lhe contaram.

### 4. Arquivos

Em balde PRIVADO do Supabase Storage (`anexos-clinicos`, Sao Paulo). O tipo
e conferido pelos BYTES do arquivo (PDF, JPG, PNG, WEBP), nao pelo nome nem
pelo cabecalho do navegador: um executavel renomeado para .pdf e recusado.
Limite de 15 MB. Ninguem recebe o caminho: a API entrega link temporario
(5 minutos) e audita a entrega.

### 5. Faixas fisiologicas no banco

Os sinais vitais tem CHECK de faixa possivel (peso entre 0,3 e 400 kg,
sistolica maior que a diastolica...). Nao julga se o valor e saudavel -
barra erro de digitacao.

## Consequencias

- Limpar dados de teste exige desligar os gatilhos dentro de uma transacao
  (ver `apps/api/src/pacientes.test.ts`). E o preco da imutabilidade.
- A linha do tempo (`GET /pacientes/:id/linha-do-tempo`) junta seis fontes;
  com volume muito grande por paciente, vira candidata a paginacao.
