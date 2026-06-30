import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';

// Vacía las tablas de NEGOCIO para rehacer una carga desde cero (útil si te
// equivocaste de import). Conserva usuarios (login) y tipos_movimiento (catálogo).
// Resetea los correlativos por año. Uso: npm run db:reset
//
// ⚠️ Borra TODO: precios, productos, proveedores, ubicaciones, movimientos, detalle y auditoría.

async function main(): Promise<void> {
  await db.execute(
    sql`TRUNCATE compras, precios, movimientos_detalle, movimientos_auditoria, movimientos, productos, ubicaciones, proveedores, lotes RESTART IDENTITY CASCADE`,
  );

  // Reinicia las secuencias de correlativos (seq_rint_2025, seq_rec_2026, …) para
  // que los nros propios arranquen de nuevo en 00001.
  const seqs = await db.execute<{ sequencename: string }>(
    sql`SELECT sequencename FROM pg_sequences WHERE sequencename LIKE 'seq\_%'`,
  );
  for (const s of seqs.rows) {
    await db.execute(sql.raw(`ALTER SEQUENCE ${s.sequencename} RESTART WITH 1`));
  }

  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);

  console.log(
    `✔ Reset OK. Vacías: precios, productos, proveedores, ubicaciones, movimientos, detalle, auditoría. ` +
      `Se conservan usuarios y tipos_movimiento. Correlativos reiniciados (${seqs.rows.length} secuencias).`,
  );
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error reseteando:', err);
  process.exit(1);
});
