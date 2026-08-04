import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { PRODUCTOS_FICTICIOS } from '../domain/familias.js';
import { ordenPrecio } from './precio-vigente.js';

// ─────────────────────────────────────────────────────────────────────────────
// Valorización del stock = cantidad (stock_actual) × precio vigente del producto.
// El precio vigente es el más reciente <= hoy con precio > 0 (un 0 = sin precio,
// decisión de J). Solo cuenta stock positivo. Devuelve total, valor por depósito y
// top productos por valor — insumo del panel.
// ─────────────────────────────────────────────────────────────────────────────

// CTE compartida: precio vigente por producto + base de stock positivo valorizado.
// (Se inyecta al principio de cada query; `base` deja precio/valor NULL si no hay
// precio real, para poder contar la cobertura.)
const CTE = sql`
  WITH vig AS (
    SELECT p.codigo_3c AS producto_3c, v.precio
    FROM productos p
    LEFT JOIN LATERAL (
      SELECT precio FROM precios
      WHERE producto_3c = p.codigo_3c AND vigente_desde <= current_date AND precio > 0
      -- misma prelación que en todos lados: ver repositories/precio-vigente.ts.
      ORDER BY ${ordenPrecio()} LIMIT 1
    ) v ON TRUE
  ),
  base AS (
    SELECT s.producto_3c, s.ubicacion_id, s.cantidad, vig.precio,
           (s.cantidad * vig.precio) AS valor
    FROM stock_actual s
    JOIN vig ON vig.producto_3c = s.producto_3c
    WHERE s.cantidad > 0
      -- Los productos ficticios/de prueba no valorizan (ver domain/familias.ts).
      AND s.producto_3c NOT IN (${sql.join(
        PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
        sql`, `,
      )})
  )`;

export type ValorPorDeposito = {
  ubicacion_id: number;
  ubicacion_dep_id_3c: number;
  ubicacion_nombre: string;
  valor: string;
  valorizados: number; // items con precio
  sin_precio: number; // items con stock pero sin precio vigente
};

export type TopProducto = {
  producto_3c: string;
  producto_nombre: string;
  cantidad: string;
  precio: string;
  valor: string;
};

export interface Valorizacion {
  total: { valor_total: string; items_valorizados: number; items_sin_precio: number; depositos: number };
  por_deposito: ValorPorDeposito[];
  top_productos: TopProducto[];
}

export async function obtenerValorizacion(topN: number): Promise<Valorizacion> {
  const totalRes = await db.execute<{
    valor_total: string;
    items_valorizados: number;
    items_sin_precio: number;
    depositos: number;
  }>(sql`${CTE}
    SELECT COALESCE(sum(valor), 0)::text AS valor_total,
           count(*) FILTER (WHERE precio IS NOT NULL)::int AS items_valorizados,
           count(*) FILTER (WHERE precio IS NULL)::int AS items_sin_precio,
           count(DISTINCT ubicacion_id)::int AS depositos
    FROM base`);

  const depRes = await db.execute<ValorPorDeposito>(sql`${CTE}
    SELECT u.id AS ubicacion_id, u.dep_id_3c AS ubicacion_dep_id_3c, u.nombre AS ubicacion_nombre,
           COALESCE(sum(b.valor), 0)::text AS valor,
           count(*) FILTER (WHERE b.precio IS NOT NULL)::int AS valorizados,
           count(*) FILTER (WHERE b.precio IS NULL)::int AS sin_precio
    FROM base b JOIN ubicaciones u ON u.id = b.ubicacion_id
    GROUP BY u.id, u.dep_id_3c, u.nombre
    ORDER BY sum(b.valor) DESC NULLS LAST`);

  const topRes = await db.execute<TopProducto>(sql`${CTE}
    SELECT b.producto_3c, pr.nombre AS producto_nombre,
           sum(b.cantidad)::text AS cantidad,
           max(b.precio)::text AS precio,
           sum(b.valor)::text AS valor
    FROM base b JOIN productos pr ON pr.codigo_3c = b.producto_3c
    WHERE b.precio IS NOT NULL
    GROUP BY b.producto_3c, pr.nombre
    ORDER BY sum(b.valor) DESC
    LIMIT ${topN}`);

  const total = totalRes.rows[0] ?? {
    valor_total: '0',
    items_valorizados: 0,
    items_sin_precio: 0,
    depositos: 0,
  };
  return { total, por_deposito: depRes.rows, top_productos: topRes.rows };
}
