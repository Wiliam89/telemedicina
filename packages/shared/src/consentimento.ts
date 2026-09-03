/**
 * =====================================================================
 * TERMO DE CONSENTIMENTO PARA TELEMEDICINA
 * =====================================================================
 *
 * Fica em @tele/shared porque a tela precisa MOSTRAR exatamente o texto
 * cuja versao a API vai registrar. Se cada lado tivesse o seu, o registro
 * nao provaria nada - a pessoa teria consentido com um texto e o sistema
 * guardaria outro.
 *
 * Ao mudar o texto, mude TAMBEM a versao. O que fica registrado no
 * atendimento e a versao lida naquele momento; termos antigos continuam
 * valendo para os atendimentos que aconteceram sob eles.
 */

export const VERSAO_DO_CONSENTIMENTO = "2026-09-01";

export interface ItemDoTermo {
  titulo: string;
  texto: string;
}

/**
 * O conteudo segue o que a Resolucao CFM 2.314/2022 exige que o paciente
 * saiba antes de aceitar: o que e o atendimento, seus limites, como os
 * dados sao tratados e o que fazer em emergencia.
 */
export const TERMO_DE_TELEMEDICINA: ItemDoTermo[] = [
  {
    titulo: "O que e este atendimento",
    texto:
      "Voce sera atendido por um medico com registro ativo no CRM, por videochamada. O atendimento tem o mesmo valor de uma consulta, e o medico pode prescrever medicamentos, pedir exames e emitir atestado quando entender ser o caso.",
  },
  {
    titulo: "O que ele NAO substitui",
    texto:
      "Este atendimento e para casos de baixa complexidade. Ele nao substitui pronto-socorro nem exame fisico presencial. Se o medico entender que seu caso precisa de avaliacao presencial, ele vai orienta-lo a procurar um servico proximo.",
  },
  {
    titulo: "Em caso de emergencia",
    texto:
      "Se voce tiver dor no peito, falta de ar intensa, desmaio, sangramento que nao para, sinais de AVC (boca torta, fraqueza de um lado do corpo, fala embolada) ou qualquer sintoma grave e subito, NAO espere na fila: ligue 192 (SAMU) ou procure o pronto-socorro mais proximo agora.",
  },
  {
    titulo: "Seus dados",
    texto:
      "O que voce contar ao medico entra no seu prontuario, que fica guardado em servidores no Brasil e so pode ser acessado por profissionais que atendem voce. Todo acesso ao prontuario e registrado. Voce pode pedir uma copia dos seus dados a qualquer momento.",
  },
  {
    titulo: "Gravacao",
    texto:
      "A videochamada nao e gravada. O que fica registrado e o que o medico escrever no prontuario, como em qualquer consulta.",
  },
  {
    titulo: "Voce pode desistir",
    texto:
      "Enquanto estiver aguardando, voce pode sair da fila. Consulte a politica de reembolso da clinica: dependendo do caso, o valor pago pode ser devolvido.",
  },
];

/** Uma linha para quem quer conferir depois qual termo foi aceito. */
export function resumoDoTermo(versao: string): string {
  return `Termo de consentimento para telemedicina, versao ${versao}`;
}
