# ADR-0001: Dados clinicos hospedados na regiao South America (Sao Paulo)

**Data:** 2026-08-26
**Status:** aceita

## Contexto
O art. 17 da Resolucao CFM 2.314/2022 exige que a pessoa juridica que presta
servicos de telemedicina e que faz arquivamento de dados tenha sede em
territorio brasileiro. A LGPD (arts. 33 a 36) impoe regime especial para
transferencia internacional de dados pessoais sensiveis, categoria em que
todo dado de saude se enquadra.

## Decisao
O projeto Supabase (Postgres, Auth e Storage) e criado obrigatoriamente na
regiao **South America (Sao Paulo)** - identificador `sa-east-1`.
Qualquer fornecedor adicional que toque em dado clinico (video, e-mail,
armazenamento) sera avaliado pelo mesmo criterio antes da contratacao.

## Consequencias
- A regiao nao pode ser alterada depois; um projeto criado na regiao errada
  deve ser descartado e recriado.
- `pnpm verificar` avisa quando a DATABASE_URL nao contem `sa-east-1`.
- Ambientes de desenvolvimento e producao sao projetos separados, ambos em
  Sao Paulo.
