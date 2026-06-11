import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Carga el .env de la RAÍZ del repo, sin importar el cwd desde el que se ejecute.
// Tanto en src (backend/src/config) como compilado (backend/dist/config) son 3 niveles arriba.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  // Solo necesaria al correr tests; opcional en runtime normal.
  DATABASE_URL_TEST: z.string().min(1).optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
    .join('\n');
  console.error(`❌ Configuración de entorno inválida:\n${detalle}`);
  throw new Error('Variables de entorno inválidas. Revisá tu .env contra .env.example.');
}

export const env = parsed.data;
export type Env = typeof env;
