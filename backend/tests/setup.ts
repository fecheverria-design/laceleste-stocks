import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Carga el .env de la raíz antes de cualquier test, para que DATABASE_URL_TEST
// esté disponible. backend/tests -> ../../ = raíz del repo.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../.env') });
