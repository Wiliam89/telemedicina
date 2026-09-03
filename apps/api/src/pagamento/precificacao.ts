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
}

/**
 * O preco do medico especifico ganha do preco padrao da clinica.
 * Um cardiologista pode custar mais que a consulta geral.
 */
export function escolherPreco(precos: PrecoAplicavel[], medicoId: string): PrecoAplicavel | null {
  return precos.find((p) => p.medicoId === medicoId) ?? precos.find((p) => p.medicoId === null) ?? null;
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
