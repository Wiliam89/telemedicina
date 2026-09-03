/**
 * Dinheiro na tela.
 *
 * Tudo circula em CENTAVOS inteiros e so vira texto na hora de exibir. A
 * conversao acontece aqui, num lugar so - e nunca no caminho contrario:
 * valor digitado pela pessoa vira centavos e permanece centavos.
 */

/** 15000 -> "R$ 150,00" */
export function emReais(centavos: number): string {
  return (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "150,00" ou "R$ 150,00" ou "150" -> 15000 */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor * 100);
}
