import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit corre con cwd = backend/ (al invocarse vía npm -w backend),
// así que el .env de la raíz está un nivel arriba.
loadEnv({ path: resolve(process.cwd(), '../.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // `generate` no necesita conexión; `migrate`/`studio` sí.
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
