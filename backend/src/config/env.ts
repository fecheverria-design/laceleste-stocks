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
  // Depósito que despacha por defecto cuando el POST no manda origen_dep_id_3c.
  // dep_id de 3c (regla #1). v1 trabaja con un solo depósito principal.
  DEPOSITO_PRINCIPAL_DEP_ID_3C: z.coerce.number().int().positive().optional(),
  // Auth JWT propio (CLAUDE.md: Bearer + localStorage). El secreto firma los tokens.
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(28800), // 8h
  // API key del endpoint M2M de abastecimientos (app del compañero). Si no está seteada,
  // el endpoint queda cerrado (503): hay que configurarla para habilitarlo.
  M2M_API_KEY: z.string().min(16, 'M2M_API_KEY debe tener al menos 16 caracteres').optional(),
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
