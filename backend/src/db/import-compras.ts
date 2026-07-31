import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { compras, productos, proveedores } from './schema.js';
import { parseDelimited } from './csv.js';
import { interpretarCompras } from './compras-lectura.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';

// Importa las COMPRAS reales a proveedores (base del gasto por proveedor). Una fila = un
// renglón de factura/orden. Columnas (por nombre, en cualquier orden):
//   NUMERO, FECHA (dd/mm/yyyy), ARTICU_ID (producto), CANTIDAD, PRECIO_UNITARIO,
//   PRECIO_TOTAL (neto), PERSONAS_ID (= numero de proveedor), FAMILIA, IVA (alícuota),
//   VALOR TOTAL (con IVA), PROVEEDORES (nombre), DENOMINACION. DOC_ID/ID/MES/AÑO se ignoran.
//
// Idempotente: upsert por (numero, producto_3c, renglon). El RENGLÓN existe porque un mismo
// remito puede traer el mismo producto en varias líneas y 3c no exporta un id de línea
// (DOC_ID es del documento y se repite): los numera compras-lectura.ts por orden de aparición.
// Con la clave vieja, sin renglón, la segunda línea pisaba a la primera — 65 renglones y
// $60.705.167 perdidos en el export del 31/07/2026 (ver migración 0016).
// Auto-crea productos (y setea su familia) y proveedores faltantes.
// Uso: npm run import:compras -- <archivo> [--dry]
//
// Excluye las familias que NO son compras reales (SERVICIOS, TRANSPORTE TERCERIZADO,
// AJUSTE DE SALDO, GASTOS SOCIOS, IMPUESTOS, GASTOS BANCARIOS — ver domain/familias.ts):
// no entran al gasto por proveedor.

async function main(archivo: string, dry: boolean): Promise<void> {
  const filas = parseDelimited(readFileSync(archivo, 'utf8'));
  const { registros, saltadas, excluidasFamilia } = interpretarCompras(filas);

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
    renglon: r.renglon,
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
        target: [compras.numero, compras.producto3c, compras.renglon],
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
