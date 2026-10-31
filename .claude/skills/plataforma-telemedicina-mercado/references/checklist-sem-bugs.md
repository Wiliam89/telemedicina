# Checklist de auditoria por fluxo

Para cada item, peça evidência: teste, arquivo e linha, ou medição. Pense sempre em clique duplo, requisição repetida, duas abas, duas cópias da API, aviso fora de ordem, processo que cai no meio e rede lenta.

## Autenticação
- [ ] Recuperação de senha funciona de ponta a ponta
- [ ] `?depois=` não permite redirecionar para outro site (`//site`, `/\site`)
- [ ] Sessão expirada leva ao login e volta ao destino
- [ ] Mensagens de erro não revelam se o e-mail existe
- [ ] Segundo fator disponível para quem lê dado clínico

## Autorização
- [ ] Toda rota com `:id` filtra por `clinicaId` e confere o papel
- [ ] Paciente A não acessa nada do paciente B
- [ ] Clínica A não acessa nada da clínica B
- [ ] Recepção e administração não leem dado clínico
- [ ] IP vindo de `X-Forwarded-For` não pode ser forjado (limite de requisições e auditoria)
- [ ] `/saude` e outras rotas públicas não expõem a estrutura interna

## Agenda
- [ ] Duas pessoas no mesmo horário: só uma consegue
- [ ] Reserva vencida libera de verdade o horário, inclusive na trava do banco
- [ ] Reserva vencida não pode mais ser paga
- [ ] Horário de verão e fuso de outra região
- [ ] Médico sem CRM verificado não recebe marcação

## Pagamento
- [ ] Clique duplo não gera duas cobranças
- [ ] Aviso repetido não altera o resultado
- [ ] Aviso antes de gravar o id do provedor não se perde
- [ ] Pagamento após vencimento não fica sem tratamento
- [ ] Pré-autorização é capturada ou cancelada
- [ ] Cancelamento de consulta paga trata o reembolso
- [ ] Segredo do webhook existe em produção, sem valor padrão conhecido
- [ ] Clínica consegue, de fato, conectar uma conta de recebimento

## Teleconsulta
- [ ] Permissão negada explica como resolver
- [ ] Queda de conexão permite voltar
- [ ] Token expirado na sala aberta
- [ ] Médico e paciente em celular
- [ ] Encerrar a sala também conclui a consulta e não deixa câmera ligada

## Prontuário e documentos
- [ ] Rascunho não se perde em queda de rede
- [ ] Finalizada não muda nem pelo banco
- [ ] Numeração sem repetição com emissões simultâneas
- [ ] Documento cancelado aparece inválido na validação
- [ ] Assinatura externa recusa arquivo alterado, ou de outra pessoa

## LGPD
- [ ] Exportação cobre todos os dados do titular
- [ ] Revogação tem efeito real
- [ ] Política descreve a verdade, inclusive onde os dados são processados
- [ ] Logs não trazem dado clínico

## Operação
- [ ] `pnpm audit --prod` sem crítico nem alto corrigível
- [ ] Desenvolvimento e produção em bancos diferentes
- [ ] Backup restaurado ao menos uma vez
- [ ] Lembretes rodam mesmo com a API sem tráfego
- [ ] Monitor externo com alerta

## Experiência
- [ ] Toda navegação lenta mostra carregamento
- [ ] Erro nunca mostra termo técnico ao paciente
- [ ] Ícone e título corretos na aba do navegador
- [ ] Teclado e leitor de tela nos fluxos principais
- [ ] Celular sem rolagem lateral
- [ ] Português correto, com acentos, também nas mensagens da API
