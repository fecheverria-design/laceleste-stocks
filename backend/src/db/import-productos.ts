import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos } from './schema.js';
import { indexarColumnas, parseDelimited } from './csv.js';

// Importa el maestro de productos de 3c (regla #1: codigo_3c = ID de 3c, es la PK).
// Columnas esperadas (por nombre, en cualquier orden): ID, ARTICULO, UM.
// FAMILIA/SUBFAMILIA se ignoran (no modeladas en v1). Idempotente: upsert por codigo_3c.
// Uso: npm run import:productos -- <archivo.csv|tsv>

async function main(archivo: string): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const col = indexarColumnas(filas[0]!, ['ID', 'ARTICULO', 'UM']);
  const iId = col.ID!;
  const iArt = col.ARTICULO!;
  const iUm = col.UM!;

  // Dedup por codigo_3c dentro del archivo (gana el último) para no chocar en el upsert.
  const porCodigo = new Map<string, { codigo3c: string; nombre: string; unidadBase: string }>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const codigo = (f[iId] ?? '').trim().slice(0, 32);
    const nombre = (f[iArt] ?? '').trim().slice(0, 200);
    const um = ((f[iUm] ?? '').trim().toUpperCase() || 'UN').slice(0, 16);
    if (!codigo || !nombre) {
      saltados++;
      continue;
    }
    porCodigo.set(codigo, { codigo3c: codigo, nombre, unidadBase: um });
  }

  const registros = [...porCodigo.values()];
  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    await db
      .insert(productos)
      .values(registros.slice(i, i + LOTE))
      .onConflictDoUpdate({
        target: productos.codigo3c,
        set: { nombre: sql`excluded.nombre`, unidadBase: sql`excluded.unidad_base` },
      });
  }

  console.log(
    `✔ Productos importados/actualizados: ${registros.length}. Saltados (sin ID o nombre): ${saltados}.`,
  );
  await pool.end();
}

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: npm run import:productos -- <archivo.csv|tsv>');
  process.exit(1);
}

main(archivo).catch((err: unknown) => {
  console.error('❌ Error importando productos:', err);
  process.exit(1);
});
