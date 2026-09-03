# ADR-0005 - A tabela `auditoria` so aceita insercao

**Status:** aceita
**Data:** 2026-08-27
**Modulo do curso:** 3 (a trava tecnica entra no Modulo 4)

## Contexto

A LGPD (art. 37) exige o registro das operacoes de tratamento de dados
pessoais, e a Resolucao CFM 2.314/2022 exige que o sistema de telemedicina
garanta a integridade e a rastreabilidade dos registros. Uma trilha de
auditoria que pode ser editada nao prova nada.

## Decisao

- Toda acao relevante (leitura de prontuario, criacao/alteracao de consulta,
  emissao de documento) gera uma linha em `auditoria` com quem, quando, o
  que e em qual registro.
- Linhas de `auditoria` nunca sao alteradas nem apagadas. No Modulo 4 isso
  vira regra do proprio banco: RLS sem politica de UPDATE/DELETE e revogacao
  desses privilegios para todos os papeis da aplicacao.
- Em `detalhes` nunca entra dado clinico em claro; entra o que mudou em
  termos de campos e valores nao sensiveis.

## Consequencias

- Positivas: qualquer acesso a dado de saude e demonstravel depois.
- Negativas: a tabela cresce sem parar; a partir do Modulo 8 (operacao)
  define-se politica de retencao e arquivamento.
