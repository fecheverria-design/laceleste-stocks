import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { proveedores } from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedores + su gasto (de la tabla `compras`). El gasto se mide por `precio_total`
// (neto, sin IVA). Las familias salen de productos.familia de lo que se le compró.
// ─────────────────────────────────────────────────────────────────────────────

export type FilaProveedor = {
  id: number;
  numero_3c: number | null;
  nombre: string;
  cuit: string | null;
  compras: number;
  gasto_neto: string;
  familias: string[] | null;
};

// Lista de proveedores con su gasto total y las familias que le compramos.
export async function listarProveedores(): Promise<FilaProveedor[]> {
  const res = await db.execute<FilaProveedor>(
    sql`SELECT pv.id, pv.numero_3c, pv.nombre, pv.cuit,
               count(c.id)::int AS compras,
               COALESCE(sum(c.precio_total), 0)::text AS gasto_neto,
               array_remove(array_agg(DISTINCT p.familia), NULL) AS familias
        FROM proveedores pv
        LEFT JOIN compras c ON c.proveedor_id = pv.id
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        GROUP BY pv.id, pv.numero_3c, pv.nombre, pv.cuit
        ORDER BY sum(c.precio_total) DESC NULLS LAST, pv.nombre`,
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
  const conds = [sql`c.proveedor_id IS NOT NULL`];
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

export type GastoMes = { mes: string; gasto_neto: string; compras: number };

// Gasto neto por mes (YYYY-MM), filtrable por familia y rango. Para la vista mensual.
export async function gastoMensual(filtros: {
  familia?: string;
  desde?: string;
  hasta?: string;
}): Promise<GastoMes[]> {
  const conds = [sql`TRUE`];
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

// Familias distintas (para el filtro del gráfico).
export async function listarFamilias(): Promise<string[]> {
  const res = await db.execute<{ familia: string }>(
    sql`SELECT DISTINCT familia FROM productos WHERE familia IS NOT NULL ORDER BY familia`,
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
