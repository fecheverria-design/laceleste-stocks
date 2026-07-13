import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Corre UNA vez antes de toda la suite: deja la DB de test con el schema y el
// catálogo base. Cada test se encarga de su propia data (ver tests/helpers/db.ts).
export default async function setup(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnv({ path: resolve(here, '../../.env') });

  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST no está seteada (revisá tu .env)');

  const pool = new pg.Pool({ connectionString: url });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: resolve(here, '../src/db/migrations') });
    // Catálogo de tipos_movimiento (idempotente) — necesario para crear RINT.
    await pool.query(`
      INSERT INTO tipos_movimiento (codigo, nombre, signo_stock) VALUES
        ('RECEPCION', 'Recepción de mercadería', 1),
        ('RINT', 'Remito interno a área', -1),
        ('AJUSTE', 'Ajuste de stock', 0)
      ON CONFLICT (codigo) DO NOTHING;
    `);
  } finally {
    await pool.end();
  }
}
