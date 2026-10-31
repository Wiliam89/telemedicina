# Regulatório no Brasil: guia de engenharia

**Isto não é parecer jurídico.** As regras mudam. Confira a fonte primária antes de tratar um item como requisito, e leve Termos, Política e decisões de conformidade à revisão jurídica.

Legenda: **[confirmar]** = veio de fonte secundária ou não foi conferido no texto oficial.

## Normas a consultar

| Norma | Assunto | Onde conferir |
|---|---|---|
| Lei 14.510/2022 | Telessaúde em todo o território nacional | planalto.gov.br |
| Resolução CFM 2.314/2022 | Telemedicina: consentimento, registro em prontuário, requisitos do sistema | cfm.org.br, DOU de 05/05/2022 |
| Resolução CFM 1.821/2007 | Prontuário eletrônico, certificação SBIS/CFM, NGS | cfm.org.br |
| Lei 13.787/2018 | Digitalização e guarda do prontuário por 20 anos | planalto.gov.br |
| Lei 13.709/2018 (LGPD) | Dado de saúde é sensível; direitos do titular; transferência internacional (arts. 33 a 36) | planalto.gov.br |
| Lei 14.063/2020 | Níveis de assinatura eletrônica; receita de controle especial exige assinatura qualificada | planalto.gov.br |
| RDC Anvisa 1.000/2025 **[confirmar]** | Prescrição eletrônica, vigente desde fevereiro de 2026 segundo fontes secundárias | gov.br/anvisa |
| RDC Anvisa 873/2024 **[confirmar]** | SNCR: numeração centralizada de notificações e receitas de controle | gov.br/anvisa |
| Portaria SVS/MS 344/1998 | Medicamentos controlados e notificações de receita | gov.br/anvisa |

## O que isso exige do sistema

- **Consentimento:** termo registrado antes do atendimento por telemedicina, versionado, com data e origem.
- **Registro:** todo atendimento vai para o prontuário. Prontuário eletrônico com assinatura ICP-Brasil e guarda de 20 anos.
- **Identificação:** médico com CRM e UF; paciente identificado. A conferência do CRM precisa ter histórico.
- **Certificação SBIS/CFM:** é voluntária e paga, mas é o que permite afirmar nível NGS. **Não declare "NGS2 certificado" sem certificação.** Valores exatos de tempo de sessão e autenticação devem ser lidos no manual SBIS vigente.
- **Receita:** receita de controle especial exige assinatura qualificada. Antes de habilitar controlados e antimicrobianos em produção, confira validade, vias e numeração SNCR na RDC vigente **[confirmar]**, porque as fontes consultadas divergem.
- **Validação:** o PDF assinado precisa passar no validador do ITI (validar.iti.gov.br).
- **LGPD:** base legal, encarregado publicado, atendimento em 15 dias, registro de operações, plano de incidente e comunicação à ANPD. A política precisa ser verdadeira quanto ao local de processamento.
- **Emergência:** orientação clara (SAMU 192) e limite do atendimento remoto.

## Decisões de negócio que precisam de pessoa

- Política de cancelamento e reembolso.
- Quem é controlador e quem é operador (clínica ou plataforma).
- Responsável técnico médico e registro da empresa no CRM **[confirmar]**.
- Texto final de Termos e Política.
