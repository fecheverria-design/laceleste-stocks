import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos } from './schema.js';
import { indexarColumnas, parseDelimited } from './csv.js';

// Importa el maestro de productos de 3c (regla #1: codigo_3c = ID de 3c, es la PK).
// Columnas: ID, ARTICULO, UM (obligatorias) + FAMILIA, SUBFAMILIA (opcionales — se
// guardan como rubro/subrubro; la vista Inventarios arma la hoja filtrando por familia).
// Idempotente: upsert por codigo_3c. Uso: npm run import:productos -- <archivo.csv|tsv>

async function main(archivo: string): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const col = indexarColumnas(filas[0]!, ['ID', 'ARTICULO', 'UM']);
  const iId = col.ID!;
  const iArt = col.ARTICULO!;
  const iUm = col.UM!;
  // FAMILIA/SUBFAMILIA son opcionales: se buscan sin exigirlas (−1 si no están).
  const norm = filas[0]!.map((h) => h.trim().toUpperCase());
  const iFam = norm.indexOf('FAMILIA');
  const iSub = norm.indexOf('SUBFAMILIA');

  // Normaliza un rubro: recorta, mayúsculas, vacío → null (para no pisar con "").
  const rubro = (v: string | undefined): string | null => {
    const t = (v ?? '').trim().toUpperCase().slice(0, 64);
    return t === '' ? null : t;
  };

  // Dedup por codigo_3c dentro del archivo (gana el último) para no chocar en el upsert.
  const porCodigo = new Map<
    string,
    { codigo3c: string; nombre: string; unidadBase: string; familia: string | null; subfamilia: string | null }
  >();
  let saltados = 0;
  let conFamilia = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const codigo = (f[iId] ?? '').trim().slice(0, 32);
    const nombre = (f[iArt] ?? '').trim().slice(0, 200);
    const um = ((f[iUm] ?? '').trim().toUpperCase() || 'UN').slice(0, 16);
    if (!codigo || !nombre) {
      saltados++;
      continue;
    }
    const familia = iFam >= 0 ? rubro(f[iFam]) : null;
    const subfamilia = iSub >= 0 ? rubro(f[iSub]) : null;
    if (familia) conFamilia++;
    porCodigo.set(codigo, { codigo3c: codigo, nombre, unidadBase: um, familia, subfamilia });
  }

  const registros = [...porCodigo.values()];
  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    await db
      .insert(productos)
      .values(registros.slice(i, i + LOTE))
      .onConflictDoUpdate({
        target: productos.codigo3c,
        // familia/subfamilia: solo se pisan si el archivo trae la columna; si no viene,
        // COALESCE conserva lo que ya había (no borra rubros cargados antes).
        set: {
          nombre: sql`excluded.nombre`,
          unidadBase: sql`excluded.unidad_base`,
          familia: iFam >= 0 ? sql`excluded.familia` : sql`coalesce(excluded.familia, ${productos.familia})`,
          subfamilia: iSub >= 0 ? sql`excluded.subfamilia` : sql`coalesce(excluded.subfamilia, ${productos.subfamilia})`,
        },
      });
  }

  console.log(
    `✔ Productos importados/actualizados: ${registros.length}. ` +
      `Con familia: ${conFamilia}${iFam < 0 ? ' (⚠ no había columna FAMILIA en el archivo)' : ''}. ` +
      `Saltados (sin ID o nombre): ${saltados}.`,
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
