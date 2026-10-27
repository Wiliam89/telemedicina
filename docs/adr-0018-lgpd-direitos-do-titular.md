# ADR-0018 - LGPD: consentimento versionado e direitos do titular na propria plataforma

**Status:** aceita
**Data:** 2026-10-26

## Contexto

Dado de saude e dado pessoal SENSIVEL (LGPD art. 5, II). As ADRs anteriores
cuidaram de onde o dado mora (0001), de quem le (0006, 0008, 0015) e da
trilha de auditoria (0005). Faltavam: o consentimento provado, os textos
legais e o exercicio dos direitos do art. 18 sem depender de e-mail.

## Decisao

### Papeis
- A **clinica** e CONTROLADORA dos dados de atendimento dos seus pacientes.
- A empresa que opera a plataforma e OPERADORA desses dados, e controladora
  dos dados de conta (cadastro, e-mail).
- O encarregado (DPO) e configurado em `NEXT_PUBLIC_ENCARREGADO_*` e aparece
  no rodape, na politica e na area do titular.

### Consentimento versionado (`consentimentos`)
- Tres textos: termos de uso, politica de privacidade e o termo de
  atendimento por telemedicina (CFM 2.314/2022). A versao de cada um vive em
  `VERSOES_LEGAIS` (`@tele/shared/lgpd`).
- Cada aceite e cada revogacao e uma linha nova com versao, data, IP e
  navegador. Somente insercao (o gatilho deixa passar apenas a cascata da
  exclusao da conta). E a prova exigida pelo art. 8, par. 2.
- Nenhuma caixa vem marcada. Mudou o texto, muda a versao, e quem aceitou a
  anterior ve a tela "Antes de continuar" no proximo acesso.

### Area do titular (`/conta`)
| Direito (art. 18) | Como |
|---|---|
| confirmacao e acesso | `GET /lgpd/meus-dados` - JSON com cadastro, consultas, prontuario, documentos, consentimentos |
| correcao | `PATCH /perfis/eu` (nome, telefone); o resto por pedido |
| portabilidade | o mesmo JSON, estruturado |
| informacao sobre compartilhamento | politica + `GET /lgpd/acessos` (quem acessou, quando, de qual clinica) |
| revogacao do consentimento | `POST /lgpd/consentimentos/revogar` |
| demais pedidos | `solicitacoes_titular`, dirigidos a clinica ou a plataforma, prazo de 15 dias (art. 19) |

### Pedidos de exclusao
Nao apagam prontuario: a Lei 13.787/2018 manda guardar 20 anos. O
controlador responde o que foi excluido/anonimizado e o que fica por
obrigacao legal (art. 16, I).

### Cookies
So o cookie de sessao (estritamente necessario). O aviso informa; nao ha
"aceitar todos" para cookies que nao existem.

## Consequencias
- Os textos em `/termos` e `/privacidade` sao um ponto de partida tecnico
  e devem passar por revisao juridica antes da publicacao.
- Exportacao de arquivos de exames fica fora do JSON (o titular baixa em
  Minha saude) para nao gerar arquivos gigantes.
