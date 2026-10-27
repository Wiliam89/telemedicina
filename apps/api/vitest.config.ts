import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Os arquivos de teste sobem a API inteira (Fastify + rotas). Rodando em
    // paralelo numa maquina comum, 5 s (o padrao) as vezes nao basta para o
    // primeiro carregamento - e o teste falhava por tempo, nao por erro.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
