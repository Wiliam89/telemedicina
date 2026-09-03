/**
 * Ponto unico de entrada do schema. O drizzle.config.ts aponta para esta
 * pasta; tudo que e exportado aqui vira tabela, enum ou indice na migracao.
 *
 * Ordem de leitura: clinicas e a raiz do isolamento; perfis e a pessoa;
 * vinculos liga os dois (e onde mora o papel); medicos e pacientes sao
 * dados globais da pessoa; consultas e auditoria pertencem a uma clinica.
 */
export * from "./clinicas.js";
export * from "./perfis.js";
export * from "./vinculos.js";
export * from "./convites.js";
export * from "./medicos.js";
export * from "./pacientes.js";
export * from "./disponibilidades.js";
export * from "./bloqueios.js";
export * from "./consultas.js";
export * from "./plantoes.js";
export * from "./precos.js";
export * from "./pagamentos.js";
export * from "./fila.js";
export * from "./evolucoes.js";
export * from "./documentos.js";
export * from "./auditoria.js";
