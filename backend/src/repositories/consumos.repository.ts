import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { ordenPrecio } from './precio-vigente.js';

// ─────────────────────────────────────────────────────────────────────────────
// Consumo por área: lo que SALE de FABRICA (dep 1) hacia un área de consumo, por
// producto. "Área de consumo" = destino que NO lleva stock y no es balde (101/102):
// Panadería, Pastelería, Recetas, etc. (OJO: algunas áreas están tipeadas DEPOSITO en
// 3c, por eso el filtro es por lleva_stock, no por tipo). Alimenta el promedio semanal.
// ─────────────────────────────────────────────────────────────────────────────

export type FilaConsumo = {
  producto_3c: string;
  producto_nombre: string;
  unidad_base: string;
  area_id: number;
  area_dep_id_3c: number;
  area_nombre: string;
  total: string;
  renglones: number;
  precio_vigente: string | null; // última compra > 0; null = sin precio
  costo: string | null; // total × precio_vigente; null si no hay precio
};

export async function consumoPorArea(filtros: {
  desde: string;
  hasta: string;
  producto3c?: string;
}): Promise<FilaConsumo[]> {
  const conds = [
    sql`m.estado = 'CONFIRMADO'`,
    sql`uo.dep_id_3c = 1`, // sale de FABRICA
    sql`ud.lleva_stock = false`, // hacia un área (no depósito/acopio)
    sql`ud.dep_id_3c NOT IN (101, 102)`, // ni baldes virtuales
    sql`m.fecha BETWEEN ${filtros.desde} AND ${filtros.hasta}`,
  ];
  if (filtros.producto3c) conds.push(sql`d.producto_3c = ${filtros.producto3c}`);

  const res = await db.execute<FilaConsumo>(
    sql`SELECT d.producto_3c, p.nombre AS producto_nombre, p.unidad_base,
               ud.id AS area_id, ud.dep_id_3c AS area_dep_id_3c, ud.nombre AS area_nombre,
               sum(d.cantidad_real)::text AS total, count(*)::int AS renglones,
               v.precio::text AS precio_vigente,
               (sum(d.cantidad_real) * v.precio)::text AS costo
        FROM movimientos_detalle d
        JOIN movimientos m ON m.id = d.movimiento_id
        JOIN ubicaciones uo ON uo.id = m.origen_id
        JOIN ubicaciones ud ON ud.id = m.destino_id
        JOIN productos p ON p.codigo_3c = d.producto_3c
        LEFT JOIN LATERAL (
          -- precio vigente del producto (misma prelación que el panel): ver precio-vigente.ts
          SELECT precio FROM precios
          WHERE producto_3c = d.producto_3c AND vigente_desde <= current_date AND precio > 0
          ORDER BY ${ordenPrecio()} LIMIT 1
        ) v ON TRUE
        WHERE ${sql.join(conds, sql` AND `)}
        GROUP BY d.producto_3c, p.nombre, p.unidad_base, ud.id, ud.dep_id_3c, ud.nombre, v.precio
        ORDER BY p.nombre, sum(d.cantidad_real) DESC`,
  );
  return res.rows;
}
