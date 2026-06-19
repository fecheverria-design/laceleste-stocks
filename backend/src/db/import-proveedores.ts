import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { proveedores } from './schema.js';
import { indexarColumnas, parseDelimited } from './csv.js';

// Importa el maestro de proveedores de 3c. Columnas esperadas (por nombre, en
// cualquier orden): NUMERO, NOMBRE, CUIT. El resto de columnas se ignoran (la
// tabla es minimal en v1). Idempotente: upsert por numero_3c (ID de 3c, regla #1).
// Uso: npm run import:proveedores -- <archivo.csv|tsv>

// "-" / vacío => null (3c usa "-" como placeholder de dato faltante).
function limpiar(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' || t === '-' ? null : t;
}

async function main(archivo: string): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const col = indexarColumnas(filas[0]!, ['NUMERO', 'NOMBRE', 'CUIT']);
  const iNum = col.NUMERO!;
  const iNom = col.NOMBRE!;
  const iCuit = col.CUIT!;

  const porNumero = new Map<number, { numero3c: number; nombre: string; cuit: string | null }>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const numero3c = Number((f[iNum] ?? '').trim());
    const nombre = (f[iNom] ?? '').trim().slice(0, 150);
    if (!Number.isInteger(numero3c) || numero3c <= 0 || !nombre) {
      saltados++;
      continue;
    }
    const cuit = limpiar(f[iCuit])?.slice(0, 20) ?? null;
    porNumero.set(numero3c, { numero3c, nombre, cuit });
  }

  const registros = [...porNumero.values()];
  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    await db
      .insert(proveedores)
      .values(registros.slice(i, i + LOTE))
      .onConflictDoUpdate({
        target: proveedores.numero3c,
        set: { nombre: sql`excluded.nombre`, cuit: sql`excluded.cuit` },
      });
  }

  console.log(
    `✔ Proveedores importados/actualizados: ${registros.length}. Saltados (sin NUMERO o NOMBRE): ${saltados}.`,
  );
  await pool.end();
}

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: npm run import:proveedores -- <archivo.csv|tsv>');
  process.exit(1);
}

main(archivo).catch((err: unknown) => {
  console.error('❌ Error importando proveedores:', err);
  process.exit(1);
});
