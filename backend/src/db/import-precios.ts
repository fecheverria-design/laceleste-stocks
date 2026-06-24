import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { precios, productos, proveedores } from './schema.js';
import { parseDelimited } from './csv.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Importa la lista de precios de 3c. Una fila = un precio de un proveedor para un
// producto, con su fecha de última actualización (= vigente_desde). Un producto
// puede tener varias filas (varios proveedores); el "precio vigente" lo resuelve la
// query (el de fecha más reciente gana, decisión de J).
//
// Columnas esperadas (por nombre, en cualquier orden):
//   CODIGO, DENOMINACION, Un. medida, PRECIO_LISTA, Cod. Proveedor, PROVEEDOR,
//   ULTIMA_ACT_PRECIO (dd/mm/yyyy). Familia/SubFamilia se ignoran (no modeladas).
//
// Idempotente: upsert por (producto_3c, proveedor_id, vigente_desde). Re-correr el
// mismo archivo no duplica; un export con fechas nuevas agrega historial.
// Auto-crea productos y proveedores faltantes (el archivo trae nombre/unidad).
//
// Uso: npm run import:precios -- <archivo.csv|tsv> [--dry]

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. "1.329,64" -> 1329.64 ; "1" -> 1.
function parsePrecio(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

interface FilaPrecio {
  producto3c: string;
  nombre: string;
  unidad: string;
  proveedorNum: number;
  proveedorNombre: string;
  precio: number;
  vigenteDesde: string;
}

async function main(archivo: string, dry: boolean): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  if (filas.length < 2) throw new Error('El archivo no tiene filas de datos (¿solo encabezado?).');

  const h = filas[0]!;
  const norm = h.map((x) => x.trim().toUpperCase());
  const idx = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    throw new Error(`Falta la columna (${aliases.join(' / ')}). Encabezados: ${h.join(' | ')}`);
  };
  const col = {
    CODIGO: idx(['CODIGO', 'ID', 'ARTICU_ID']),
    DENOMINACION: idx(['DENOMINACION', 'ARTICULO']),
    UNIMED: idx(['UN. MEDIDA', 'UNIMED', 'UM']),
    PRECIO: idx(['PRECIO_LISTA', 'PRECIO']),
    COD_PROV: idx(['COD. PROVEEDOR', 'COD PROVEEDOR', 'ID PROVEEDOR', 'NUMERO']),
    PROVEEDOR: idx(['PROVEEDOR', 'NOMBRE']),
    ULTIMA_ACT: idx(['ULTIMA_ACT_PRECIO', 'ULTIMA ACT', 'FECHA']),
  };
  const c = (f: string[], k: keyof typeof col) => (f[col[k]] ?? '').trim();

  // 1) Parsear y validar. Última fila por (producto, proveedor, fecha) gana (dedup intra-archivo).
  const porClave = new Map<string, FilaPrecio>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const producto3c = c(f, 'CODIGO').slice(0, 32);
    const proveedorNum = Number(c(f, 'COD_PROV'));
    const precio = parsePrecio(c(f, 'PRECIO'));
    const vigenteDesde = parseFecha(c(f, 'ULTIMA_ACT'));
    if (!producto3c || !Number.isInteger(proveedorNum) || proveedorNum <= 0 || !Number.isFinite(precio) || precio < 0 || !vigenteDesde) {
      saltados++;
      continue;
    }
    porClave.set(`${producto3c}|${proveedorNum}|${vigenteDesde}`, {
      producto3c,
      nombre: c(f, 'DENOMINACION').slice(0, 200) || `Producto ${producto3c}`,
      unidad: c(f, 'UNIMED').slice(0, 16) || 'UN',
      proveedorNum,
      proveedorNombre: c(f, 'PROVEEDOR').slice(0, 150) || `Proveedor ${proveedorNum}`,
      precio,
      vigenteDesde,
    });
  }
  const registros = [...porClave.values()];

  // Productos y proveedores distintos del archivo (para auto-crear los que falten).
  const prods = new Map<string, { codigo3c: string; nombre: string; unidadBase: string }>();
  const provs = new Map<number, { numero3c: number; nombre: string }>();
  for (const r of registros) {
    if (!prods.has(r.producto3c)) prods.set(r.producto3c, { codigo3c: r.producto3c, nombre: r.nombre, unidadBase: r.unidad });
    if (!provs.has(r.proveedorNum)) provs.set(r.proveedorNum, { numero3c: r.proveedorNum, nombre: r.proveedorNombre });
  }

  console.log(
    `Filas de datos: ${filas.length - 1} · precios válidos: ${registros.length} · saltados: ${saltados} · productos: ${prods.size} · proveedores: ${provs.size}`,
  );
  if (dry) {
    console.log('— DRY RUN: no se escribió nada. Muestra (primeros 5):');
    for (const r of registros.slice(0, 5)) {
      console.log(`  ${r.producto3c} ${r.nombre} · prov ${r.proveedorNum} ${r.proveedorNombre} · $${r.precio} · ${r.vigenteDesde}`);
    }
    await pool.end();
    return;
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('No existe el usuario de integración (corré: npm run db:seed).');

  // 2) Upsert de productos faltantes (no piso nombre/unidad si ya existen).
  const prodList = [...prods.values()];
  for (let i = 0; i < prodList.length; i += 500) {
    await db.insert(productos).values(prodList.slice(i, i + 500)).onConflictDoNothing({ target: productos.codigo3c });
  }

  // 3) Upsert de proveedores faltantes (idempotente por numero_3c).
  const provList = [...provs.values()];
  for (let i = 0; i < provList.length; i += 500) {
    await db
      .insert(proveedores)
      .values(provList.slice(i, i + 500))
      .onConflictDoUpdate({ target: proveedores.numero3c, set: { nombre: sql`excluded.nombre` } });
  }

  // 4) Resolver numero_3c -> proveedores.id.
  const provRows = await db
    .select({ id: proveedores.id, numero3c: proveedores.numero3c })
    .from(proveedores);
  const idPorNumero = new Map<number, number>();
  for (const p of provRows) if (p.numero3c !== null) idPorNumero.set(p.numero3c, p.id);

  // 5) Upsert de precios por (producto, proveedor, fecha).
  const values = registros.map((r) => ({
    producto3c: r.producto3c,
    proveedorId: idPorNumero.get(r.proveedorNum) ?? null,
    precio: String(r.precio),
    vigenteDesde: r.vigenteDesde,
    usuarioId,
  }));
  let escritos = 0;
  for (let i = 0; i < values.length; i += 500) {
    const lote = values.slice(i, i + 500);
    await db
      .insert(precios)
      .values(lote)
      .onConflictDoUpdate({
        target: [precios.producto3c, precios.proveedorId, precios.vigenteDesde],
        set: { precio: sql`excluded.precio`, usuarioId: sql`excluded.usuario_id` },
      });
    escritos += lote.length;
  }

  console.log(`✔ Precios importados/actualizados: ${escritos}. Productos y proveedores faltantes auto-creados.`);
  await pool.end();
}

const archivo = process.argv[2];
const dry = process.argv.includes('--dry');
if (!archivo) {
  console.error('Uso: npm run import:precios -- <archivo.csv|tsv> [--dry]');
  process.exit(1);
}

main(archivo, dry).catch((err: unknown) => {
  console.error('❌ Error importando precios:', err);
  process.exit(1);
});
