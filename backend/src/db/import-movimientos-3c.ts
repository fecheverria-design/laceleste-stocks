import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { movimientos3c } from './schema.js';
import { parseDelimited } from './csv.js';
import { leerXls } from './xls.js';

// Importa los movimientos de 3c al ESPEJO (`movimientos_3c`): lo que el encargado de
// depósito cargó realmente en 3c, tal cual, para comparar contra lo que la app del compañero
// dice que se despachó.
//
// ⚠ NO toca stock ni crea movimientos de la app. Es una tabla al costado (ver schema.ts).
// Tampoco crea productos ni ubicaciones: es un espejo fiel de 3c, aunque traiga un código
// que todavía no dimos de alta.
//
// Fuente: el export "Movimientos de Stock" del servlet SqlToExcel de 3c, que sale en .xls
// binario (se lee con xls.ts). También acepta CSV/TSV por si algún día cambia el formato.
// Columnas: FECHA_RECEPCION, NUMERO, TIPO_DOC, ORIGEN, DESTINO, ARTICU_ID, CANTIDAD,
// UNIMED (opcional), USUARIO (opcional).
//
// Idempotente: upsert por (numero, producto_3c, renglon). El renglón lo asigna este
// importador por orden de aparición, porque 3c no lo numera: un mismo documento puede
// repetir el mismo artículo en dos renglones y son dos movimientos distintos, no uno.
//
// Uso: npm run import:movimientos3c -- <archivo.xls|csv> [--dry]

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma decimal, punto de miles. 3c también manda "89.55" en inglés, así que si NO
// hay coma se toma el punto como decimal.
function parseCantidad(s: string): number {
  let t = s.trim();
  if (t === '') return NaN;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

export interface FilaMov3c {
  fecha: string;
  numero: string;
  renglon: number;
  tipoDoc: string;
  origenDep3c: number | null;
  destinoDep3c: number | null;
  producto3c: string;
  cantidad: number;
  unidad: string | null;
  usuario3c: string | null;
}

export interface LecturaMov3c {
  registros: FilaMov3c[];
  saltadas: number;
}

/** Interpreta las filas del export (encabezado + datos). Pura: se testea sin archivo ni DB. */
export function interpretarMovimientos3c(filas: string[][]): LecturaMov3c {
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const norm = filas[0]!.map((h) => h.trim().toUpperCase());
  const req = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    throw new Error(`Falta la columna (${aliases.join(' / ')}). Encabezados: ${filas[0]!.join(' | ')}`);
  };
  const opt = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    return -1;
  };

  const iFecha = req(['FECHA_RECEPCION', 'FECHA']);
  const iNumero = req(['NUMERO']);
  const iTipo = req(['TIPO_DOC', 'TIPO']);
  const iArt = req(['ARTICU_ID', '3C', 'CODIGO']);
  const iCant = req(['CANTIDAD']);
  const iOrigen = opt(['ORIGEN']);
  const iDestino = opt(['DESTINO']);
  const iUni = opt(['UNIMED', 'UNIDAD']);
  const iUsuario = opt(['USUARIO']);

  const entero = (v: string | undefined): number | null => {
    const n = Number((v ?? '').trim());
    return Number.isInteger(n) ? n : null;
  };

  // El renglón se asigna por orden dentro de (numero, producto): 3c no lo numera y un mismo
  // documento puede repetir el artículo. Sin esto, el upsert pisaría el segundo con el
  // primero y se perdería cantidad despachada.
  const vistos = new Map<string, number>();
  const registros: FilaMov3c[] = [];
  let saltadas = 0;

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const fecha = parseFecha(f[iFecha] ?? '');
    const numero = (f[iNumero] ?? '').trim().slice(0, 64);
    const producto3c = (f[iArt] ?? '').trim().slice(0, 32);
    const cantidad = parseCantidad(f[iCant] ?? '');
    if (fecha === null || !numero || !producto3c || !Number.isFinite(cantidad)) {
      saltadas++;
      continue;
    }
    const clave = `${numero}|${producto3c}`;
    const renglon = (vistos.get(clave) ?? 0) + 1;
    vistos.set(clave, renglon);

    registros.push({
      fecha,
      numero,
      renglon,
      tipoDoc: (f[iTipo] ?? '').trim().slice(0, 16) || 'SIN TIPO',
      origenDep3c: iOrigen >= 0 ? entero(f[iOrigen]) : null,
      destinoDep3c: iDestino >= 0 ? entero(f[iDestino]) : null,
      producto3c,
      cantidad,
      unidad: iUni >= 0 ? (f[iUni] ?? '').trim().slice(0, 16) || null : null,
      usuario3c: iUsuario >= 0 ? (f[iUsuario] ?? '').trim().slice(0, 64) || null : null,
    });
  }

  return { registros, saltadas };
}

/** Escribe (o actualiza) los renglones en el espejo. Devuelve cuántos se escribieron. */
export async function persistirMovimientos3c(registros: FilaMov3c[]): Promise<number> {
  const LOTE = 500;
  let escritos = 0;
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE).map((r) => ({
      fecha: r.fecha,
      numero: r.numero,
      renglon: r.renglon,
      tipoDoc: r.tipoDoc,
      origenDep3c: r.origenDep3c,
      destinoDep3c: r.destinoDep3c,
      producto3c: r.producto3c,
      cantidad: String(r.cantidad),
      unidad: r.unidad,
      usuario3c: r.usuario3c,
    }));
    await db
      .insert(movimientos3c)
      .values(lote)
      .onConflictDoUpdate({
        target: [movimientos3c.numero, movimientos3c.producto3c, movimientos3c.renglon],
        set: {
          fecha: sql`excluded.fecha`,
          tipoDoc: sql`excluded.tipo_doc`,
          origenDep3c: sql`excluded.origen_dep_3c`,
          destinoDep3c: sql`excluded.destino_dep_3c`,
          cantidad: sql`excluded.cantidad`,
          unidad: sql`excluded.unidad`,
          usuario3c: sql`excluded.usuario_3c`,
          importadoEn: sql`now()`,
        },
      });
    escritos += lote.length;
  }
  return escritos;
}

async function main(archivo: string, dry: boolean): Promise<void> {
  const esExcel = /\.xlsx?$/i.test(archivo);
  const filas = esExcel ? leerXls(archivo, 'NUMERO') : parseDelimited(readFileSync(archivo, 'utf8'));
  const { registros, saltadas } = interpretarMovimientos3c(filas);

  const porTipo = new Map<string, number>();
  for (const r of registros) porTipo.set(r.tipoDoc, (porTipo.get(r.tipoDoc) ?? 0) + 1);
  const fechas = registros.map((r) => r.fecha).sort();
  console.log(
    `Renglones: ${registros.length} · saltados: ${saltadas} · ${fechas[0] ?? '—'} → ${fechas[fechas.length - 1] ?? '—'}`,
  );
  console.log(`  Por tipo: ${[...porTipo].map(([k, v]) => `${k}=${v}`).join(' · ')}`);

  if (dry) {
    console.log('— DRY RUN: no se escribió nada. Muestra (primeras 5):');
    for (const r of registros.slice(0, 5)) {
      console.log(
        `  ${r.fecha} ${r.numero} r${r.renglon} · ${r.tipoDoc} · dep ${r.origenDep3c}→${r.destinoDep3c} · ${r.producto3c} × ${r.cantidad} ${r.unidad ?? ''}`,
      );
    }
    return;
  }

  const escritos = await persistirMovimientos3c(registros);
  console.log(`✔ Espejo de movimientos de 3c: ${escritos} renglón(es) importados/actualizados. NO se tocó stock.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const dry = process.argv.includes('--dry');
  if (!archivo) {
    console.error('Uso: npm run import:movimientos3c -- <archivo.xls|csv> [--dry]');
    process.exit(1);
  }
  main(archivo, dry)
    .catch((err: unknown) => {
      console.error('❌ Error importando el espejo de movimientos de 3c:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
