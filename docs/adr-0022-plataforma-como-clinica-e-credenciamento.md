# ADR-0022 - A plataforma e a clinica; o medico entra por credenciamento

**Status:** aceita
**Data:** 2026-11-14

## Contexto

O modelo multi-clinica (ADR-0008) obrigava o paciente a ser convidado por uma
clinica, usar o link de entrada dela ou abrir a propria. O negocio pedido e
outro: a plataforma E a clinica. Ela faz tudo o que as clinicas faziam, mas o
paciente nao escolhe nem entra em clinica nenhuma.

Ao mesmo tempo, o medico deixa de ser convidado por uma administracao que o
conhece pessoalmente: ele se cadastra sozinho. Isso abre o risco de alguem
atender com o CRM de outra pessoa.

## Decisao

### Plataforma unica
- `PLATAFORMA_SLUG` (API) define a clinica que e a plataforma. Sem ele, vale o
  modo antigo, sem nenhuma mudanca de comportamento.
- O isolamento por clinica continua inteiro por baixo (RLS, `clinicaId` em toda
  consulta): a plataforma e uma clinica como as outras eram, so que a unica.
  Por isso agenda, prontuario, valores, indicadores e LGPD nao mudaram.
- `POST /perfis` ja vincula a pessoa como paciente. `POST /plataforma/entrar`
  cobre contas antigas. `GET /plataforma` (publica) diz ao site em que modo esta.
- Um gancho `onRequest` recusa qualquer `X-Clinica` diferente da plataforma.
- `POST /clinicas` so serve para a configuracao inicial, e so para quem esta em
  `PLATAFORMA_ADMIN_EMAILS` (em producao a lista e obrigatoria: sem ela, o
  primeiro visitante viraria o administrador). A clinica nasce `ativa`.
- Convite continua existindo para recepcao e administracao. Para medico, e
  recusado: o convite pularia justamente a conferencia de identidade.

### Credenciamento
- Tabelas `credenciamentos_medicos`, `documentos_do_medico` e
  `verificacoes_de_identidade` (as duas ultimas somente insercao).
- Ate ser aprovado, o medico tem so o papel de paciente: nao ve paciente, agenda
  nem fila. O papel `medico` nasce na aprovacao.
- Documentos: identidade (frente e verso), carteira do CRM, diploma, titulo de
  especialista (quando pede especialidade), comprovante de endereco (opcional) e
  selfie. Tipo conferido pelos bytes; selfie e frente do documento so como imagem.
- A selfie e dado biometrico (LGPD art. 5, II; art. 11). O medico concorda com
  um texto versionado (`VERSAO_DO_TERMO_DE_BIOMETRIA`) antes de enviar; a versao
  fica no pedido. Nao guardamos modelo biometrico, so a foto e o resultado.
- **A aprovacao exige identidade confirmada.** Ninguem confere nem aprova o
  proprio pedido. A administracao libera so o que foi pedido (pode liberar menos)
  e pode registrar a conferencia do CRM no mesmo passo (ADR-0016 continua valendo).

### Reconhecimento facial
Interface `ProvedorDeIdentidade`, escolhida por `IDENTIDADE_PROVEDOR`:
- `manual` (padrao, sem custo): a administracao ve a selfie ao lado da foto do
  documento e registra o resultado, com o nome de quem conferiu.
- `externo`: um servico de fora busca as fotos em
  `GET /webhooks/identidade/:referencia/arquivos` e devolve o resultado em
  `POST /webhooks/identidade`. As duas rotas exigem HMAC-SHA256 com
  `IDENTIDADE_WEBHOOK_SEGREDO` sobre os campos (`referencia.status.pontuacao.ts`
  e `referencia.arquivos.ts`), recusam aviso com mais de 10 minutos e so aceitam
  o primeiro resultado de cada referencia.
- `local_teste`: aprova sozinho; a API se recusa a subir com ele em producao.

## Consequencias
- Servicos de biometria cobram por verificacao: ligar o modo `externo` e decisao
  de gasto (ver relatorio). O modo manual atende sem custo, com mais trabalho.
- Revisao juridica: base legal do tratamento biometrico (art. 11, II, "g" -
  prevencao a fraude e seguranca do titular - e o enquadramento sugerido, nao
  confirmado), prazo de guarda das fotos e texto do termo.
