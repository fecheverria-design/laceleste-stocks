import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Fuerza la DB de test en client.ts. Los tests de DB tocan stock_actual
    // (REFRESH no corre en paralelo sobre la misma matview) → sin paralelismo de archivos.
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
  },
});
