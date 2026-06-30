import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { ubicaciones } from './schema.js';
import { indexarColumnas, parseDelimited } from './csv.js';

// Importa ubicaciones (depósitos/áreas) de 3c. Columnas: TIPO_DEPOSITO, DENOMINACION,
// DEPOSITO_ID. Mapea PROPIOS->DEPOSITO, EXTERNOS->AREA (regla #1: DEPOSITO_ID = dep_id_3c).
// Idempotente: upsert por dep_id_3c. Uso: npm run import:ubicaciones -- <archivo>

function mapearTipo(tipoDeposito: string): string {
  const t = tipoDeposito.trim().toUpperCase();
  if (t === 'PROPIOS') return 'DEPOSITO';
  if (t === 'EXTERNOS') return 'AREA';
  return 'AREA'; // default conservador para valores desconocidos
}

async function main(archivo: string): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const col = indexarColumnas(filas[0]!, ['TIPO_DEPOSITO', 'DENOMINACION', 'DEPOSITO_ID']);
  const iTipo = col.TIPO_DEPOSITO!;
  const iNom = col.DENOMINACION!;
  const iId = col.DEPOSITO_ID!;

  const porDep = new Map<number, { nombre: string; tipo: string; depId3c: number }>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const depId3c = Number((f[iId] ?? '').trim());
    const nombre = (f[iNom] ?? '').trim().slice(0, 100);
    if (!Number.isInteger(depId3c) || depId3c <= 0 || !nombre) {
      saltados++;
      continue;
    }
    porDep.set(depId3c, { nombre, tipo: mapearTipo(f[iTipo] ?? ''), depId3c });
  }

  const registros = [...porDep.values()];
  for (const r of registros) {
    await db
      .insert(ubicaciones)
      .values(r)
      .onConflictDoUpdate({ target: ubicaciones.depId3c, set: { nombre: sql`excluded.nombre`, tipo: sql`excluded.tipo` } });
  }

  console.log(`✔ Ubicaciones importadas/actualizadas: ${registros.length}. Saltadas: ${saltados}.`);
  await pool.end();
}

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: npm run import:ubicaciones -- <archivo.csv|tsv>');
  process.exit(1);
}

main(archivo).catch((err: unknown) => {
  console.error('❌ Error importando ubicaciones:', err);
  process.exit(1);
});
