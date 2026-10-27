# ADR-0017 - Assinatura feita fora da plataforma, conferida antes de aceitar

**Status:** aceita
**Data:** 2026-10-26

## Contexto

A ADR-0011 trouxe a assinatura ICP-Brasil em nuvem integrada (BirdID, por
CPF + codigo do aplicativo). Na pratica cada medico ja tem o SEU
certificado, de um dos varios PSCs (VIDaaS, BirdID, SafeID, Certisign,
token A3...), e cada provedor exige contrato e credenciais proprias para
integracao por API. O VIDaaS, por exemplo, nao tem documentacao publica:
ela so e liberada a parceiros com contrato.

Esperar a integracao com cada provedor deixaria medicos sem assinar.

## Decisao

Alem da assinatura integrada, o medico pode **assinar fora**:

1. baixa o PDF do documento (`GET /documentos/:id/pdf`) - gerado de forma
   deterministica, sempre o mesmo arquivo, com o codigo de validacao e o
   SHA-256 do texto nos metadados (`Keywords`);
2. assina no programa que ja usa (app do certificado em nuvem, Assinador
   ITI, leitor de PDF com token A3);
3. envia o PDF assinado (`POST /documentos/:id/assinatura-externa`).

Antes de aceitar, `conferirAssinaturaExterna` exige:

| Conferencia | Por que |
|---|---|
| assinatura CMS valida e conteudo integro | o arquivo nao mudou depois de assinado |
| a ultima assinatura cobre o arquivo ate o fim | nada foi acrescentado depois |
| metadados com o codigo E o hash deste documento | e ESTE documento, nao outro |
| CPF do certificado = CPF do cadastro (ou nome, sem CPF) | quem assinou foi o medico que emitiu |

Recusa vira auditoria `documento.assinatura_externa_recusada` e o documento
continua `emitido`. Aceito, segue o mesmo caminho da assinatura integrada
(armazenamento privado, hash do arquivo, `documento.assinado`), com
`assinatura_provedor = 'externa'`.

## O que esta conferencia NAO faz

Nao valida a cadeia ICP-Brasil (AC credenciada, revogacao). Isso e o que o
validador oficial do ITI faz, e a pagina /validar leva ate ele
(validar.iti.gov.br). Receita de controle especial exige assinatura
qualificada ICP-Brasil (Lei 14.063/2020, art. 13); o medico deve usar
certificado ICP, nao a assinatura gov.br, para esse tipo.

## Integracao direta com outros provedores

`ProvedorDeAssinatura` (ADR-0011) continua sendo o ponto de extensao. Para o
VIDaaS ou outro PSC: com o contrato e a documentacao do provedor, implementa-
se um novo provedor e o valor correspondente em `ASSINATURA_PROVEDOR`.
