/**
 * =====================================================================
 * COMO A API E EMPACOTADA PARA RODAR EM SERVIDOR
 * =====================================================================
 *
 * Em desenvolvimento, o `tsx` le TypeScript direto - inclusive o dos
 * pacotes internos (@tele/db, @tele/shared), que exportam codigo-fonte.
 * Em producao nao ha tsx: o Node executa JavaScript.
 *
 * Compilar so a pasta `src` nao resolve, porque os imports de @tele/*
 * continuariam apontando para arquivos .ts que o Node nao entende. Por
 * isso EMPACOTAMOS: o tsup junta a API e os pacotes internos num arquivo
 * so, deixando de fora as bibliotecas de terceiros (que ficam em
 * node_modules, como sempre).
 *
 * Resultado: `node dist/servidor.js` sobe sem depender de TypeScript.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/servidor.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Os pacotes do proprio projeto entram no pacote final; o resto e
  // resolvido em node_modules na hora de rodar.
  noExternal: [/^@tele\//],
  splitting: false,
});
