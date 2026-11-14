/**
 * Como se chega ao valor cobrado e a divisao entre clinica e plataforma.
 *
 * Fica separado das rotas de proposito: e a regra que mais vai mudar
 * conforme o negocio amadurece, e a que mais precisa de teste.
 */

export interface PrecoAplicavel {
  valorCentavos: number;
  comissaoPlataformaBps: number;
  medicoId: string | null;
  /** Preco de uma especialidade (ADR-0024). Ausente ou nulo = nao e por especialidade. */
  especialidade?: string | null;
}

/**
 * O preco do medico especifico ganha do preco padrao da clinica.
 * Um cardiologista pode custar mais que a consulta geral.
 */
export function escolherPreco(precos: PrecoAplicavel[], medicoId: string | null, especialidade?: string | null): PrecoAplicavel | null {
  // Do mais especifico para o mais geral: o medico, a especialidade, o padrao.
  return (
    (medicoId ? precos.find((p) => p.medicoId === medicoId) : undefined) ??
    (especialidade ? precos.find((p) => p.medicoId === null && p.especialidade === especialidade) : undefined) ??
    precos.find((p) => p.medicoId === null && !p.especialidade) ??
    null
  );
}

/**
 * Divide o valor entre plataforma e clinica.
 *
 * Trabalha em centavos inteiros e ARREDONDA PARA BAIXO a comissao: na
 * duvida sobre um centavo, ele fica com a clinica, nao com a plataforma.
 * Isso evita a soma das partes passar do total - o banco recusaria.
 */
export function calcularComissao(valorCentavos: number, comissaoBps: number): { plataforma: number; clinica: number } {
  const plataforma = Math.floor((valorCentavos * comissaoBps) / 10000);
  return { plataforma, clinica: valorCentavos - plataforma };
}
