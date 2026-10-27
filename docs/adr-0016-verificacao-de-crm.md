# ADR-0016 - Verificacao de CRM por clinica, com validade anual

**Status:** aceita
**Data:** 2026-10-26

## Contexto

O CRM digitado no cadastro e so uma declaracao. Uma plataforma que deixa
qualquer pessoa emitir receita com um numero inventado fica exposta a
exercicio ilegal da medicina - e a clinica responde junto. As plataformas
de mercado conferem o registro no Conselho antes de liberar o profissional.

Sobre a conferencia automatica: o CFM oferece um webservice ("Lista de
Medicos", Resolucao CFM 2.309/2022) que hoje funciona como DOWNLOAD diario
da lista, liberado por chave exclusiva, pago por empresas privadas (cerca de
R$ 948/ano) e contratado pelo SEI-Medicina. Nao ha, no servico publico, uma
consulta por CRM pronta para chamar a cada cadastro.

## Decisao

1. **Conferencia documentada pela administracao da clinica.** A tela Equipe
   leva a busca publica e gratuita do CFM (portal.cfm.org.br/busca-medicos)
   e registra o que foi visto: nome no Conselho, situacao, especialidades,
   quem conferiu e quando. So se verifica registro com situacao ATIVA;
   recusa exige motivo.
2. **Por clinica.** Quem responde pela equipe perante o CRM e o diretor
   tecnico daquela clinica. Uma clinica nao herda a conferencia de outra.
3. **Validade de 12 meses.** Registro pode ser suspenso depois; a situacao
   vira "vencido" e a conferencia e refeita.
4. **Somente insercao** (`verificacoes_crm`): cada conferencia e uma linha
   nova; o gatilho recusa reescrever. A situacao atual e a mais recente.
5. **Trava nas acoes de medico.** Sem CRM verificado nesta clinica o medico
   nao emite nem assina documento, nao se escala para plantao, nao aparece
   na lista do paciente e nao recebe marcacao (`exigirCrmVerificado`).
   Consultas ja marcadas continuam - o paciente nao e prejudicado.
6. **Ponto de extensao.** O campo `metodo` ja aceita `servico_externo`
   (conferencia sem pessoa, `verificado_por` nulo). Ao contratar a lista do
   CFM ou um fornecedor de consulta, um job registra conferencias com esse
   metodo - o resto do sistema nao muda.

## Decisao relacionada: varios papeis na mesma clinica

A medica que abre o proprio consultorio e administracao E medico. Antes,
a API agia so pelo papel "mais forte" e ela perdia as rotas de medico. Agora
`req.contexto.papeis` traz todos, `exigirPapel` aceita qualquer um deles, e
quem cria a clinica tendo CRM ganha tambem o vinculo de medico.
