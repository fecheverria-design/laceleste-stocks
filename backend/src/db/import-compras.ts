import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { compras, productos, proveedores } from './schema.js';
import { parseDelimited } from './csv.js';
import { esCompraReal } from '../domain/familias.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Importa las COMPRAS reales a proveedores (base del gasto por proveedor). Una fila = un
// renglón de factura/orden. Columnas (por nombre, en cualquier orden):
//   NUMERO, FECHA (dd/mm/yyyy), ARTICU_ID (producto), CANTIDAD, PRECIO_UNITARIO,
//   PRECIO_TOTAL (neto), PERSONAS_ID (= numero de proveedor), FAMILIA, IVA (alícuota),
//   VALOR TOTAL (con IVA), PROVEEDORES (nombre), DENOMINACION. DOC_ID/ID/MES/AÑO se ignoran.
//
// Idempotente: upsert por (numero, producto_3c). Auto-crea productos (y setea su familia)
// y proveedores faltantes. Uso: npm run import:compras -- <archivo> [--dry]
//
// Excluye las familias que NO son compras reales (SERVICIOS, TRANSPORTE TERCERIZADO,
// AJUSTE DE SALDO, GASTOS SOCIOS, IMPUESTOS, GASTOS BANCARIOS — ver domain/familias.ts):
// no entran al gasto por proveedor.

function parseFecha(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
}

// es-AR: coma = decimal, punto = miles. "5.395.000,00" -> 5395000 ; "107,90" -> 107.9.
function parseNum(s: string): number {
  let t = s.trim();
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Number(t);
}

interface FilaCompra {
  numero: string;
  fecha: string;
  producto3c: string;
  nombre: string;
  familia: string;
  proveedorNum: number;
  proveedorNombre: string;
  cantidad: number;
  precioUnitario: number;
  precioTotal: number;
  iva: number | null;
  totalConIva: number | null;
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
  const opt = (aliases: string[]): number => {
    for (const a of aliases) {
      const i = norm.indexOf(a.toUpperCase());
      if (i !== -1) return i;
    }
    return -1;
  };
  const col = {
    NUMERO: idx(['NUMERO']),
    FECHA: idx(['FECHA']),
    ARTICU_ID: idx(['ARTICU_ID', 'ID ARTICULO', 'CODIGO']),
    CANTIDAD: idx(['CANTIDAD']),
    PRECIO_UNITARIO: idx(['PRECIO_UNITARIO', 'PRECIO']),
    PRECIO_TOTAL: idx(['PRECIO_TOTAL']),
    PERSONAS_ID: idx(['PERSONAS_ID', 'COD. PROVEEDOR', 'ID PROVEEDOR']),
    PROVEEDOR: idx(['PROVEEDORES', 'PROVEEDOR']),
    DENOMINACION: opt(['DENOMINACION', 'ARTICULO']),
    FAMILIA: opt(['FAMILIA']),
    IVA: opt(['IVA']),
    VALOR_TOTAL: opt(['VALOR TOTAL', 'VALOR_TOTAL', 'TOTAL']),
  };
  const c = (f: string[], i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');

  const porClave = new Map<string, FilaCompra>();
  let saltadas = 0;
  let excluidasFamilia = 0;
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]!;
    const numero = c(f, col.NUMERO);
    const fecha = parseFecha(c(f, col.FECHA));
    const producto3c = c(f, col.ARTICU_ID).slice(0, 32);
    const proveedorNum = Number(c(f, col.PERSONAS_ID));
    const cantidad = parseNum(c(f, col.CANTIDAD));
    const precioUnitario = parseNum(c(f, col.PRECIO_UNITARIO));
    const precioTotal = parseNum(c(f, col.PRECIO_TOTAL));
    if (!numero || !fecha || !producto3c || !Number.isInteger(proveedorNum) || proveedorNum <= 0 || !Number.isFinite(precioTotal)) {
      saltadas++;
      continue;
    }
    const familia = c(f, col.FAMILIA).slice(0, 64);
    // Familias que no son compras reales (servicios, flete tercerizado, ajuste de
    // saldo) no cuentan en el gasto (ver domain/familias.ts, decisión de J 2026-07-01).
    if (!esCompraReal(familia)) {
      excluidasFamilia++;
      continue;
    }
    const ivaRaw = c(f, col.IVA);
    const totalRaw = c(f, col.VALOR_TOTAL);
    porClave.set(`${numero}|${producto3c}`, {
      numero,
      fecha,
      producto3c,
      nombre: c(f, col.DENOMINACION).slice(0, 200) || `Art ${producto3c}`,
      familia,
      proveedorNum,
      proveedorNombre: c(f, col.PROVEEDOR).slice(0, 150) || `Proveedor ${proveedorNum}`,
      cantidad: Number.isFinite(cantidad) ? cantidad : 0,
      precioUnitario: Number.isFinite(precioUnitario) ? precioUnitario : 0,
      precioTotal,
      iva: ivaRaw ? parseNum(ivaRaw) : null,
      totalConIva: totalRaw ? parseNum(totalRaw) : null,
    });
  }
  const registros = [...porClave.values()];

  const prods = new Map<string, { codigo3c: string; nombre: string; unidadBase: string; familia: string | null }>();
  const provs = new Map<number, { numero3c: number; nombre: string }>();
  for (const r of registros) {
    if (!prods.has(r.producto3c)) prods.set(r.producto3c, { codigo3c: r.producto3c, nombre: r.nombre, unidadBase: 'UN', familia: r.familia || null });
    if (!provs.has(r.proveedorNum)) provs.set(r.proveedorNum, { numero3c: r.proveedorNum, nombre: r.proveedorNombre });
  }

  const gastoTotal = registros.reduce((a, r) => a + r.precioTotal, 0);
  console.log(
    `Filas: ${filas.length - 1} · compras válidas: ${registros.length} · saltadas: ${saltadas} · excluidas por familia (no compra real): ${excluidasFamilia} · productos: ${prods.size} · proveedores: ${provs.size} · gasto neto total: $${gastoTotal.toLocaleString('es-AR')}`,
  );
  if (dry) {
    console.log('— DRY RUN: no se escribió nada. Muestra (primeras 5):');
    for (const r of registros.slice(0, 5)) {
      console.log(`  ${r.fecha} ${r.numero} · ${r.producto3c} ${r.nombre} · ${r.proveedorNombre} · ${r.cantidad} × $${r.precioUnitario} = $${r.precioTotal} (${r.familia})`);
    }
    await pool.end();
    return;
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('No existe el usuario de integración (corré: npm run db:seed).');

  // Productos: crear faltantes y setear familia (sin pisar nombre/unidad existentes).
  const prodList = [...prods.values()];
  for (let i = 0; i < prodList.length; i += 500) {
    await db
      .insert(productos)
      .values(prodList.slice(i, i + 500))
      .onConflictDoUpdate({ target: productos.codigo3c, set: { familia: sql`coalesce(excluded.familia, ${productos.familia})` } });
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
    numero: r.numero,
    fecha: r.fecha,
    producto3c: r.producto3c,
    proveedorId: idPorNumero.get(r.proveedorNum) ?? null,
    cantidad: String(r.cantidad),
    precioUnitario: String(r.precioUnitario),
    precioTotal: String(r.precioTotal),
    iva: r.iva === null ? null : String(r.iva),
    totalConIva: r.totalConIva === null ? null : String(r.totalConIva),
    usuarioId,
  }));
  let escritos = 0;
  for (let i = 0; i < values.length; i += 500) {
    const lote = values.slice(i, i + 500);
    await db
      .insert(compras)
      .values(lote)
      .onConflictDoUpdate({
        target: [compras.numero, compras.producto3c],
        set: {
          fecha: sql`excluded.fecha`,
          proveedorId: sql`excluded.proveedor_id`,
          cantidad: sql`excluded.cantidad`,
          precioUnitario: sql`excluded.precio_unitario`,
          precioTotal: sql`excluded.precio_total`,
          iva: sql`excluded.iva`,
          totalConIva: sql`excluded.total_con_iva`,
        },
      });
    escritos += lote.length;
  }

  console.log(`✔ Compras importadas/actualizadas: ${escritos}. Productos/proveedores faltantes auto-creados, familia seteada.`);
  await pool.end();
}

const archivo = process.argv[2];
const dry = process.argv.includes('--dry');
if (!archivo) {
  console.error('Uso: npm run import:compras -- <archivo.csv|tsv> [--dry]');
  process.exit(1);
}

main(archivo, dry).catch((err: unknown) => {
  console.error('❌ Error importando compras:', err);
  process.exit(1);
});
