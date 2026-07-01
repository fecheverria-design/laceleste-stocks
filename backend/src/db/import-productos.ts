import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos } from './schema.js';
import { parseDelimited } from './csv.js';

// Importa el maestro de productos de 3c (regla #1: codigo_3c = ID de 3c, es la PK).
// Acepta el formato NUEVO de J y el viejo (alias de encabezados):
//   id     ← 3C | ID
//   nombre ← PRODUCTOS | ARTICULO
//   unidad ← UNIDAD | UM            (unidad base; default UNIDAD)
//   familia ← FAMILIA               (opcional)   subfamilia ← SUBFAMILIA (opcional)
//   presentacion_compra ← "PRESENTACION/UDAD. MIN. COMPRA" (texto del bulto)
//   unidades_por_bulto  ← U         (factor: unidades base por bulto; 1 = suelto)
//   clasificacion_abc   ← ABC
//   informacion         ← INFORMACION
// Idempotente: upsert por codigo_3c. Columnas ausentes NO pisan lo ya cargado (COALESCE).
// Uso: npm run import:productos -- <archivo.csv|tsv>

// es-AR: coma decimal, punto de miles. Devuelve null si vacío/ inválido.
function parseNumero(s: string | undefined): number | null {
  let t = (s ?? '').trim();
  if (t === '') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

async function main(archivo: string): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const norm = filas[0]!.map((h) => h.trim().toUpperCase());
  // Índice de la 1ª columna cuyo encabezado matchea alguno de los nombres (exacto).
  const col = (...nombres: string[]): number => norm.findIndex((h) => nombres.includes(h));
  // Índice de la 1ª columna cuyo encabezado CONTIENE el texto (para nombres largos/raros).
  const colLike = (fragmento: string): number => norm.findIndex((h) => h.includes(fragmento));

  const iId = col('3C', 'ID');
  const iNombre = col('PRODUCTOS', 'ARTICULO');
  if (iId < 0 || iNombre < 0) {
    throw new Error(`Faltan columnas de id/nombre. Encabezados: ${filas[0]!.join(' | ')}`);
  }
  const iUnidad = col('UNIDAD', 'UM');
  const iFam = col('FAMILIA');
  const iSub = col('SUBFAMILIA');
  const iPres = colLike('PRESENTACION'); // "PRESENTACION/UDAD. MIN. COMPRA"
  const iU = col('U'); // factor unidades por bulto
  const iAbc = col('ABC');
  const iInfo = colLike('INFORMACION');

  const txt = (v: string | undefined, max: number, upper = false): string | null => {
    let t = (v ?? '').trim();
    if (upper) t = t.toUpperCase();
    t = t.slice(0, max);
    return t === '' ? null : t;
  };

  // Dedup por codigo_3c dentro del archivo (gana el último).
  const porCodigo = new Map<string, typeof productos.$inferInsert>();
  let saltados = 0;
  let conFamilia = 0;
  let conBulto = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const codigo = (f[iId] ?? '').trim().slice(0, 32);
    const nombre = (f[iNombre] ?? '').trim().slice(0, 200);
    if (!codigo || !nombre) {
      saltados++;
      continue;
    }
    const unidad = ((iUnidad >= 0 ? (f[iUnidad] ?? '').trim().toUpperCase() : '') || 'UNIDAD').slice(0, 16);
    const familia = iFam >= 0 ? txt(f[iFam], 64, true) : null;
    const subfamilia = iSub >= 0 ? txt(f[iSub], 64, true) : null;
    const presentacionCompra = iPres >= 0 ? txt(f[iPres], 100) : null;
    const unidadesPorBulto = iU >= 0 ? parseNumero(f[iU]) : null;
    const clasificacionAbc = iAbc >= 0 ? txt(f[iAbc], 4, true) : null;
    const informacion = iInfo >= 0 ? txt(f[iInfo], 500) : null;
    if (familia) conFamilia++;
    if (unidadesPorBulto && unidadesPorBulto > 1) conBulto++;
    porCodigo.set(codigo, {
      codigo3c: codigo,
      nombre,
      unidadBase: unidad,
      familia,
      subfamilia,
      presentacionCompra,
      unidadesPorBulto: unidadesPorBulto === null ? null : unidadesPorBulto.toString(),
      clasificacionAbc,
      informacion,
    });
  }

  const registros = [...porCodigo.values()];
  const LOTE = 500;
  for (let i = 0; i < registros.length; i += LOTE) {
    await db
      .insert(productos)
      .values(registros.slice(i, i + LOTE))
      .onConflictDoUpdate({
        target: productos.codigo3c,
        // Una columna opcional solo pisa si venía en el archivo; si no, COALESCE conserva
        // lo ya cargado (un re-import parcial no borra rubros/bulto de otros productos).
        set: {
          nombre: sql`excluded.nombre`,
          unidadBase: sql`excluded.unidad_base`,
          familia: iFam >= 0 ? sql`excluded.familia` : sql`coalesce(excluded.familia, ${productos.familia})`,
          subfamilia: iSub >= 0 ? sql`excluded.subfamilia` : sql`coalesce(excluded.subfamilia, ${productos.subfamilia})`,
          presentacionCompra:
            iPres >= 0 ? sql`excluded.presentacion_compra` : sql`coalesce(excluded.presentacion_compra, ${productos.presentacionCompra})`,
          unidadesPorBulto:
            iU >= 0 ? sql`excluded.unidades_por_bulto` : sql`coalesce(excluded.unidades_por_bulto, ${productos.unidadesPorBulto})`,
          clasificacionAbc:
            iAbc >= 0 ? sql`excluded.clasificacion_abc` : sql`coalesce(excluded.clasificacion_abc, ${productos.clasificacionAbc})`,
          informacion: iInfo >= 0 ? sql`excluded.informacion` : sql`coalesce(excluded.informacion, ${productos.informacion})`,
        },
      });
  }

  console.log(
    `✔ Productos importados/actualizados: ${registros.length}. ` +
      `Con familia: ${conFamilia}${iFam < 0 ? ' (⚠ sin columna FAMILIA)' : ''}. ` +
      `Con bulto (U>1): ${conBulto}${iU < 0 ? ' (⚠ sin columna U)' : ''}. ` +
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
