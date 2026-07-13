import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { proveedores } from '../db/schema.js';
import { FAMILIAS_EXCLUIDAS_GASTO, PRODUCTOS_FICTICIOS } from '../domain/familias.js';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedores + su gasto (de la tabla `compras`). El gasto se mide por `precio_total`
// (neto, sin IVA). Las familias salen de productos.familia de lo que se le compró.
//
// El gráfico de gasto muestra SOLO compras de insumos reales: excluye las familias que no
// son compra (servicios, ajustes, impuestos…), los productos esporádicos y los productos
// de prueba (ver domain/familias.ts, decisión de J 2026-07-02). El filtro va a nivel query
// porque estas compras se cargaron ANTES de que existiera la regla en el import.
// ─────────────────────────────────────────────────────────────────────────────

// Condición SQL de "cuenta en el gasto". Requiere alias `c` (compras) y `p` (productos).
// Un producto sin familia se conserva (no cae en la lista de familias excluidas).
const CUENTA_EN_GASTO = sql`c.producto_3c NOT IN (${sql.join(
  PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
  sql`, `,
)}) AND (p.familia IS NULL OR upper(p.familia) NOT IN (${sql.join(
  FAMILIAS_EXCLUIDAS_GASTO.map((f) => sql`${f}`),
  sql`, `,
)}))`;

// Filtros opcionales de la vista de proveedores (misma barra que los gráficos).
export type FiltrosGasto = { familia?: string; desde?: string; hasta?: string };

// "Cuenta en el gasto" + filtros opcionales de familia/período. Requiere alias `c` y `p`.
function condGasto(filtros?: FiltrosGasto) {
  const parts = [CUENTA_EN_GASTO];
  if (filtros?.familia) parts.push(sql`p.familia = ${filtros.familia}`);
  if (filtros?.desde) parts.push(sql`c.fecha >= ${filtros.desde}`);
  if (filtros?.hasta) parts.push(sql`c.fecha <= ${filtros.hasta}`);
  return sql.join(parts, sql` AND `);
}

export type FilaProveedor = {
  id: number;
  numero_3c: number | null;
  nombre: string;
  cuit: string | null;
  compras: number;
  gasto_neto: string;
  familias: string[] | null;
};

// Lista de proveedores con su gasto y las familias que le compramos. Los filtros de
// familia/período (misma barra que los gráficos) recortan las agregaciones: compras,
// gasto y familias reflejan solo lo que entra al filtro; el proveedor igual aparece.
export async function listarProveedores(filtros?: FiltrosGasto): Promise<FilaProveedor[]> {
  const cond = condGasto(filtros);
  const res = await db.execute<FilaProveedor>(
    sql`SELECT pv.id, pv.numero_3c, pv.nombre, pv.cuit,
               count(c.id) FILTER (WHERE ${cond})::int AS compras,
               COALESCE(sum(c.precio_total) FILTER (WHERE ${cond}), 0)::text AS gasto_neto,
               array_remove(array_agg(DISTINCT p.familia) FILTER (WHERE ${cond}), NULL) AS familias
        FROM proveedores pv
        LEFT JOIN compras c ON c.proveedor_id = pv.id
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        GROUP BY pv.id, pv.numero_3c, pv.nombre, pv.cuit
        ORDER BY sum(c.precio_total) FILTER (WHERE ${cond}) DESC NULLS LAST, pv.nombre`,
  );
  return res.rows;
}

export type GastoProveedor = {
  proveedor_id: number;
  nombre: string;
  familia: string | null;
  compras: number;
  gasto_neto: string;
};

// Gasto por (proveedor, familia), filtrable por familia y rango de fechas. Alimenta el
// gráfico (ej. ranking de proveedores de PACKAGING).
export async function gastoPorProveedorFamilia(filtros: {
  familia?: string;
  desde?: string;
  hasta?: string;
}): Promise<GastoProveedor[]> {
  const conds = [sql`c.proveedor_id IS NOT NULL`, CUENTA_EN_GASTO];
  if (filtros.familia) conds.push(sql`p.familia = ${filtros.familia}`);
  if (filtros.desde) conds.push(sql`c.fecha >= ${filtros.desde}`);
  if (filtros.hasta) conds.push(sql`c.fecha <= ${filtros.hasta}`);

  const res = await db.execute<GastoProveedor>(
    sql`SELECT c.proveedor_id, pv.nombre, p.familia,
               count(c.id)::int AS compras,
               sum(c.precio_total)::text AS gasto_neto
        FROM compras c
        JOIN proveedores pv ON pv.id = c.proveedor_id
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY c.proveedor_id, pv.nombre, p.familia
        ORDER BY sum(c.precio_total) DESC`,
  );
  return res.rows;
}

export type ProductoDeProveedor = {
  producto_3c: string;
  producto_nombre: string;
  familia: string | null;
  compras: number;
  gasto_neto: string;
};

// Productos que le compramos a un proveedor (el detalle de "de qué es" su gasto).
// Mismo filtro de compras reales + los filtros de familia/período de la barra → recorta
// igual que la lista, así la suma del detalle cuadra con la columna "Gasto neto".
// `compras` = cuántas veces se le compró ese producto en el período. Ordenado por gasto desc.
export async function productosPorProveedor(
  proveedorId: number,
  filtros?: FiltrosGasto,
): Promise<ProductoDeProveedor[]> {
  const res = await db.execute<ProductoDeProveedor>(
    sql`SELECT c.producto_3c,
               COALESCE(p.nombre, '(sin maestro)') AS producto_nombre,
               p.familia,
               count(c.id)::int AS compras,
               sum(c.precio_total)::text AS gasto_neto
        FROM compras c
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        WHERE c.proveedor_id = ${proveedorId} AND ${condGasto(filtros)}
        GROUP BY c.producto_3c, p.nombre, p.familia
        ORDER BY sum(c.precio_total) DESC NULLS LAST`,
  );
  return res.rows;
}

export type GastoMes = { mes: string; gasto_neto: string; compras: number };

// Gasto neto por mes (YYYY-MM), filtrable por familia y rango. Para la vista mensual.
export async function gastoMensual(filtros: {
  familia?: string;
  desde?: string;
  hasta?: string;
}): Promise<GastoMes[]> {
  const conds = [CUENTA_EN_GASTO];
  if (filtros.familia) conds.push(sql`p.familia = ${filtros.familia}`);
  if (filtros.desde) conds.push(sql`c.fecha >= ${filtros.desde}`);
  if (filtros.hasta) conds.push(sql`c.fecha <= ${filtros.hasta}`);
  const res = await db.execute<GastoMes>(
    sql`SELECT to_char(c.fecha, 'YYYY-MM') AS mes,
               sum(c.precio_total)::text AS gasto_neto,
               count(*)::int AS compras
        FROM compras c
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY mes ORDER BY mes`,
  );
  return res.rows;
}

// Familias distintas para el filtro del gráfico. Deja fuera las familias excluidas del
// gasto, así no aparecen como opción (serían siempre 0).
export async function listarFamilias(): Promise<string[]> {
  const res = await db.execute<{ familia: string }>(
    sql`SELECT DISTINCT familia FROM productos
        WHERE familia IS NOT NULL
          AND upper(familia) NOT IN (${sql.join(
            FAMILIAS_EXCLUIDAS_GASTO.map((f) => sql`${f}`),
            sql`, `,
          )})
        ORDER BY familia`,
  );
  return res.rows.map((r) => r.familia);
}

export async function existeNumero3c(numero3c: number): Promise<boolean> {
  const [row] = await db
    .select({ id: proveedores.id })
    .from(proveedores)
    .where(eq(proveedores.numero3c, numero3c))
    .limit(1);
  return row !== undefined;
}

export async function insertarProveedor(datos: {
  numero3c: number;
  nombre: string;
  cuit?: string;
}): Promise<{ id: number; numero_3c: number | null; nombre: string; cuit: string | null }> {
  const [row] = await db
    .insert(proveedores)
    .values({ numero3c: datos.numero3c, nombre: datos.nombre, cuit: datos.cuit ?? null })
    .returning({ id: proveedores.id, numero_3c: proveedores.numero3c, nombre: proveedores.nombre, cuit: proveedores.cuit });
  if (!row) throw new Error('No se pudo crear el proveedor');
  return row;
}
