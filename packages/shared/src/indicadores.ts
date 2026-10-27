/** O painel de indicadores da clinica (ADR-0019). Numeros, nunca dado clinico. */
export interface Indicadores {
  periodo: { de: string; ate: string; dias: number };
  consultas: {
    total: number;
    concluidas: number;
    canceladas: number;
    agendadas: number;
    aguardandoPagamento: number;
    /** canceladas / (todas menos aguardando pagamento), 0-1 */
    taxaCancelamento: number;
    porDia: { dia: string; total: number; concluidas: number }[];
    porMedico: { medico: string; total: number; concluidas: number; canceladas: number }[];
  };
  receita: { brutaCentavos: number; clinicaCentavos: number; pagamentos: number; ticketMedioCentavos: number };
  prontoAtendimento: { atendidos: number; desistencias: number; esperaMediaMinutos: number | null };
  pacientes: { novos: number; atendidos: number };
  documentos: { emitidos: number; assinados: number; taxaAssinatura: number };
}
