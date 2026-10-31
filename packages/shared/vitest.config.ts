import { defineConfig } from "vitest/config";

// Numa maquina comum, o primeiro carregamento dos fusos do Intl pode passar de 5 s.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 } });
