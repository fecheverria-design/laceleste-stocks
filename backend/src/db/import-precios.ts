import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { precios, productos, proveedores } from './schema.js';
import { parseDelimited } from './csv.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Importa el HISTÓRICO de precios de 3c. Una fila = un precio de un proveedor en una
// fecha, con un TIPO: COMPRA (lo que se pagó) o ACTUALIZACION (precio de lista). Se
// guardan todas: el "precio vigente" es la última COMPRA (lo resuelve la query); el
// gráfico usa solo las COMPRA.
//
// Columnas esperadas (por nombre, en cualquier orden):
//   ID (producto_3c), DENOMINACION, PRECIO_UNITARIO, PERSONAS_ID (= numero de proveedor),
//   PROVEEDORES (nombre), FECHA (dd/mm/yyyy), TIPO (COMPRA|ACTUALIZACION).
//   FAMILIA / AÑO / MES / RESPONSABLE se ignoran.
//
// Idempotente: upsert por (producto_3c, proveedor_id, vigente_desde, tipo). Auto-crea
// productos y proveedores faltantes.
//
// Uso: npm run import:precios -- <archivo> [--dry] [--controlado]
//
// --controlado: además de importarlos, MARCA cada precio como EL precio controlado de su
// producto (el que le gana a todo en la prelación, ver repositories/precio-vigente.ts). Es
// para cargar de una lo que compras controló en el mes, sin marcarlo a mano de a uno en la
// hoja de Control de precios. Como solo puede haber UN controlado por producto (índice
// parcial `uq_precio_controlado_producto`), si el archivo trae varias filas del mismo
// producto gana la de fecha más nueva, y se avisa cuántas quedaron afuera. Desmarca el
// controlado anterior de esos productos, igual que hace la hoja.

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. "1.200,00" -> 1200 ; "507,50" -> 507.5.
function parsePrecio(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

// Normaliza el TIPO sin depender de mayúsculas/tildes. Default COMPRA si viene raro.
function normalizarTipo(s: string): 'COMPRA' | 'ACTUALIZACION' {
  const t = s.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return t.startsWith('ACTUALIZ') ? 'ACTUALIZACION' : 'COMPRA';
}

export interface FilaPrecio {
  producto3c: string;
  nombre: string;
  proveedorNum: number;
  proveedorNombre: string;
  precio: number;
  tipo: 'COMPRA' | 'ACTUALIZACION';
  vigenteDesde: string;
}

// De todas las filas del archivo, cuál se marca como controlada por producto: solo puede
// haber UNA (índice parcial `uq_precio_controlado_producto`). Gana la de fecha más nueva;
// a igualdad de fecha, la última del archivo. Aparte para poder testearla sin DB.
export function unoPorProducto(registros: FilaPrecio[]): Map<string, FilaPrecio> {
  const elegidos = new Map<string, FilaPrecio>();
  for (const r of registros) {
    const previa = elegidos.get(r.producto3c);
    if (previa === undefined || r.vigenteDesde >= previa.vigenteDesde) elegidos.set(r.producto3c, r);
  }
  return elegidos;
}

async function main(archivo: string, dry: boolean, controlado: boolean): Promise<void> {
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
    ID: idx(['ID', 'CODIGO', 'ARTICU_ID']),
    DENOMINACION: idx(['DENOMINACION', 'ARTICULO']),
    PRECIO: idx(['PRECIO_UNITARIO', 'PRECIO_LISTA', 'PRECIO']),
    PERSONAS_ID: idx(['PERSONAS_ID', 'COD. PROVEEDOR', 'ID PROVEEDOR']),
    PROVEEDOR: idx(['PROVEEDORES', 'PROVEEDOR', 'NOMBRE']),
    FECHA: idx(['FECHA', 'ULTIMA_ACT_PRECIO']),
    TIPO: idx(['TIPO']),
  };
  const c = (f: string[], k: keyof typeof col) => (f[col[k]] ?? '').trim();

  // Dedup intra-archivo por (producto, proveedor, fecha, tipo): la última fila gana.
  const porClave = new Map<string, FilaPrecio>();
  let saltados = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const producto3c = c(f, 'ID').slice(0, 32);
    const proveedorNum = Number(c(f, 'PERSONAS_ID'));
    const precio = parsePrecio(c(f, 'PRECIO'));
    const vigenteDesde = parseFecha(c(f, 'FECHA'));
    const tipo = normalizarTipo(c(f, 'TIPO'));
    if (!producto3c || !Number.isInteger(proveedorNum) || proveedorNum <= 0 || !Number.isFinite(precio) || precio < 0 || !vigenteDesde) {
      saltados++;
      continue;
    }
    porClave.set(`${producto3c}|${proveedorNum}|${vigenteDesde}|${tipo}`, {
      producto3c,
      nombre: c(f, 'DENOMINACION').slice(0, 200) || `Producto ${producto3c}`,
      proveedorNum,
      proveedorNombre: c(f, 'PROVEEDOR').slice(0, 150) || `Proveedor ${proveedorNum}`,
      precio,
      tipo,
      vigenteDesde,
    });
  }
  const registros = [...porClave.values()];
  const compras = registros.filter((r) => r.tipo === 'COMPRA').length;

  const prods = new Map<string, { codigo3c: string; nombre: string; unidadBase: string }>();
  const provs = new Map<number, { numero3c: number; nombre: string }>();
  for (const r of registros) {
    if (!prods.has(r.producto3c)) prods.set(r.producto3c, { codigo3c: r.producto3c, nombre: r.nombre, unidadBase: 'UN' });
    if (!provs.has(r.proveedorNum)) provs.set(r.proveedorNum, { numero3c: r.proveedorNum, nombre: r.proveedorNombre });
  }

  console.log(
    `Filas: ${filas.length - 1} · válidas: ${registros.length} (compras: ${compras}, actualizaciones: ${registros.length - compras}) · saltadas: ${saltados} · productos: ${prods.size} · proveedores: ${provs.size}`,
  );
  const aControlar = controlado ? unoPorProducto(registros) : new Map<string, FilaPrecio>();
  if (controlado) {
    console.log(
      `  --controlado: se marcarán ${aControlar.size} precio(s), uno por producto` +
        (registros.length > aControlar.size ? ` (${registros.length - aControlar.size} fila(s) del archivo comparten producto y NO se marcan)` : ''),
    );
  }

  if (dry) {
    console.log('— DRY RUN: no se escribió nada. Muestra (primeras 5):');
    for (const r of registros.slice(0, 5)) {
      console.log(`  ${r.producto3c} ${r.nombre} · ${r.tipo} $${r.precio} · ${r.vigenteDesde} · ${r.proveedorNombre}`);
    }
    await pool.end();
    return;
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('No existe el usuario de integración (corré: npm run db:seed).');

  const prodList = [...prods.values()];
  for (let i = 0; i < prodList.length; i += 500) {
    await db.insert(productos).values(prodList.slice(i, i + 500)).onConflictDoNothing({ target: productos.codigo3c });
  }

  const provList = [...provs.values()];
  for (let i = 0; i < provList.length; i += 500) {
    await db
      .insert(proveedores)
      .values(provList.slice(i, i + 500))
      .onConflictDoUpdate({ target: proveedores.numero3c, set: { nombre: sql`excluded.nombre` } });
  }

  const provRows = await db.select({ id: proveedores.id, numero3c: proveedores.numero3c }).from(proveedores);
  const idPorNumero = new Map<number, number>();
  for (const p of provRows) if (p.numero3c !== null) idPorNumero.set(p.numero3c, p.id);

  const values = registros.map((r) => ({
    producto3c: r.producto3c,
    proveedorId: idPorNumero.get(r.proveedorNum) ?? null,
    precio: String(r.precio),
    tipo: r.tipo,
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
        target: [precios.producto3c, precios.proveedorId, precios.vigenteDesde, precios.tipo],
        set: { precio: sql`excluded.precio`, usuarioId: sql`excluded.usuario_id` },
      });
    escritos += lote.length;
  }

  console.log(`✔ Precios importados/actualizados: ${escritos} (compras: ${compras}). Productos/proveedores faltantes auto-creados.`);

  if (controlado && aControlar.size > 0) {
    const marcados = await marcarControlados([...aControlar.values()], idPorNumero, usuarioId);
    console.log(`✔ Precios marcados como CONTROLADOS: ${marcados} (uno por producto; le ganan a cualquier compra posterior).`);
  }
  await pool.end();
}

// Marca las filas dadas como EL precio controlado de su producto, en UNA transacción:
// primero desmarca el controlado anterior de esos productos (solo puede haber uno) y
// después marca el nuevo. Es la misma semántica que el botón de la hoja de Control de
// precios (repositories/precios.repository.ts → marcarControlado).
async function marcarControlados(
  filas: FilaPrecio[],
  idPorNumero: Map<number, number>,
  usuarioId: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const codigos = filas.map((f) => f.producto3c);
    for (let i = 0; i < codigos.length; i += 500) {
      const lote = codigos.slice(i, i + 500);
      await tx.execute(
        sql`UPDATE precios SET controlado_en = NULL, controlado_por = NULL
            WHERE controlado_en IS NOT NULL
              AND producto_3c IN (${sql.join(lote.map((c) => sql`${c}`), sql`, `)})`,
      );
    }
    let n = 0;
    for (const f of filas) {
      const provId = idPorNumero.get(f.proveedorNum) ?? null;
      const res = await tx.execute(
        sql`UPDATE precios SET controlado_en = now(), controlado_por = ${usuarioId}
            WHERE producto_3c = ${f.producto3c}
              AND proveedor_id IS NOT DISTINCT FROM ${provId}
              AND vigente_desde = ${f.vigenteDesde}
              AND tipo = ${f.tipo}`,
      );
      n += res.rowCount ?? 0;
    }
    return n;
  });
}

// Solo corre como CLI (import:precios). Cuando un test o algún módulo importa
// unoPorProducto(), este bloque NO se ejecuta (import.meta.url ≠ argv[1]).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const dry = process.argv.includes('--dry');
  const controlado = process.argv.includes('--controlado');
  if (!archivo) {
    console.error('Uso: npm run import:precios -- <archivo.csv|tsv> [--dry] [--controlado]');
    process.exit(1);
  }
  main(archivo, dry, controlado).catch((err: unknown) => {
    console.error('❌ Error importando precios:', err);
    process.exit(1);
  });
}
