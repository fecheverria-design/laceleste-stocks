import { db, pool } from './client.js';
import { tiposMovimiento } from './schema.js';

// Catálogo base de tipos de movimiento. Idempotente: ON CONFLICT por codigo.
// RECEPCION suma (+1), RINT resta (-1), AJUSTE 0 (el signo va en cantidad_real del renglón).
const TIPOS = [
  { codigo: 'RECEPCION', nombre: 'Recepción de mercadería', signoStock: 1 },
  { codigo: 'RINT', nombre: 'Remito interno a área', signoStock: -1 },
  { codigo: 'AJUSTE', nombre: 'Ajuste de stock', signoStock: 0 },
];

async function main(): Promise<void> {
  console.log('▶ Seed: tipos_movimiento…');
  await db.insert(tiposMovimiento).values(TIPOS).onConflictDoNothing({ target: tiposMovimiento.codigo });
  console.log(`✔ Seed completo (${TIPOS.length} tipos: RECEPCION, RINT, AJUSTE).`);
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
