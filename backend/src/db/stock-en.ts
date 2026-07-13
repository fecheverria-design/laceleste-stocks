import { inArray, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { ubicaciones } from './schema.js';

// Define QUÉ ubicaciones llevan stock (por dep_id_3c). Declarativo: las que pasás
// quedan con stock, TODAS las demás no. Recalcula el stock al final.
// Uso: npm run db:stock-en -- 1            (solo FABRICA)
//      npm run db:stock-en -- 1 2 10 20    (varios depósitos)

const depIds = process.argv
  .slice(2)
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

if (depIds.length === 0) {
  console.error('Uso: npm run db:stock-en -- <dep_id_3c> [<dep_id_3c> ...]');
  process.exit(1);
}

async function main(): Promise<void> {
  await db.update(ubicaciones).set({ llevaStock: false });
  const marcadas = await db
    .update(ubicaciones)
    .set({ llevaStock: true })
    .where(inArray(ubicaciones.depId3c, depIds))
    .returning({ dep: ubicaciones.depId3c, nombre: ubicaciones.nombre });

  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);

  const noEncontrados = depIds.filter((d) => !marcadas.some((m) => m.dep === d));
  console.log(`✔ Llevan stock (${marcadas.length}): ${marcadas.map((m) => `${m.dep}=${m.nombre}`).join(', ') || '—'}`);
  if (noEncontrados.length > 0) console.log(`⚠ dep_id no encontrados (no existen como ubicación): ${noEncontrados.join(', ')}`);
  console.log('  El resto de ubicaciones NO acumula stock. Stock recalculado.');
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
