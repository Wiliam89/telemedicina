import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Testes criam e apagam dados: nunca rodam contra banco remoto sem querer.
    setupFiles: ["./src/guarda-banco-de-teste.ts"],
    // Os arquivos de teste sobem a API inteira (Fastify + rotas). Rodando em
    // paralelo numa maquina comum, 5 s (o padrao) as vezes nao basta para o
    // primeiro carregamento - e o teste falhava por tempo, nao por erro.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
