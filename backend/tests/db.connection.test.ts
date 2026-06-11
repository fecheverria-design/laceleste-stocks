import pg from 'pg';
import { describe, expect, it } from 'vitest';

const { Pool } = pg;

// Test trivial de infraestructura: valida que la DB de test esté levantada y
// responda. Requiere `docker compose up` y la base laceleste_movimientos_test.
describe('conexión a la base de datos de test', () => {
  it('conecta y ejecuta SELECT 1', async () => {
    const url = process.env.DATABASE_URL_TEST;
    expect(url, 'DATABASE_URL_TEST no está seteada (revisá tu .env)').toBeTruthy();

    const pool = new Pool({ connectionString: url });
    try {
      const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
