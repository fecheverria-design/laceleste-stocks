import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { FAMILIAS_CON_COMPRADOR, FAMILIAS_EXCLUIDAS_GASTO, PRODUCTOS_FICTICIOS } from '../domain/familias.js';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Compras — datos crudos. Devuelve el gasto agregado por
// (mes, proveedor, producto) de los DOS meses que el informe compara: el pedido y el
// anterior. El pivoteo y las variaciones se calculan en el service (JS testeable).
//
// GASTO = `total_con_iva` (la columna "VALOR TOTAL" de la hoja de J). El informe de la
// planilla trabaja CON IVA; el resto de la app muestra el neto. Se devuelven los dos para
// no tener que elegir acá. Ver docs/IMPORTACION-3C.md.
//
// Solo entran las familias que tienen comprador (regla de negocio en domain/familias.ts),
// que además ya excluye servicios, esporádicos y los productos ficticios.
// ─────────────────────────────────────────────────────────────────────────────

export type FilaGastoMes = {
  mes: string;
  proveedor_id: number | null;
  proveedor: string | null;
  producto_3c: string;
  producto: string;
  familia: string | null;
  clasificacion_abc: string | null;
  gasto: string; // con IVA
  gasto_neto: string;
  cantidad: string;
  renglones: number;
};

export async function gastoPorMesProveedorProducto(meses: string[]): Promise<FilaGastoMes[]> {
  const res = await db.execute<FilaGastoMes>(
    sql`SELECT to_char(c.fecha, 'YYYY-MM') AS mes,
               c.proveedor_id,
               pv.nombre AS proveedor,
               c.producto_3c,
               p.nombre AS producto,
               p.familia,
               p.clasificacion_abc,
               sum(COALESCE(c.total_con_iva, c.precio_total))::text AS gasto,
               sum(c.precio_total)::text AS gasto_neto,
               sum(c.cantidad)::text AS cantidad,
               count(*)::int AS renglones
        FROM compras c
        JOIN productos p ON p.codigo_3c = c.producto_3c
        LEFT JOIN proveedores pv ON pv.id = c.proveedor_id
        WHERE to_char(c.fecha, 'YYYY-MM') IN (${sql.join(
          meses.map((m) => sql`${m}`),
          sql`, `,
        )})
          AND c.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
          AND upper(COALESCE(p.familia, '')) NOT IN (${sql.join(
            FAMILIAS_EXCLUIDAS_GASTO.map((f) => sql`${f}`),
            sql`, `,
          )})
          AND upper(COALESCE(p.familia, '')) IN (${sql.join(
            FAMILIAS_CON_COMPRADOR.map((f) => sql`${f}`),
            sql`, `,
          )})
        GROUP BY 1, 2, 3, 4, 5, 6, 7
        ORDER BY 8 DESC`,
  );
  return res.rows;
}

export type FilaPrecioMes = {
  mes: string;
  producto_3c: string;
  precio: string;
};

// Precio VIGENTE al cierre de cada mes, que es el que usa el informe para la variación:
// la última COMPRA con fecha <= fin de mes (el "tick Usar" de la planilla de J). Si un
// producto nunca tuvo COMPRA, cae a la última ACTUALIZACION, igual que el precio vigente del
// resto de la app (ver docs/IMPORTACION-3C.md).
//
// Sale de la tabla `precios`, NO de las compras: por eso un precio corregido a mano en la
// hoja de Precios mueve el informe en la corrida siguiente, sin reimportar nada.
export async function preciosVigentesPorMes(meses: string[]): Promise<FilaPrecioMes[]> {
  const res = await db.execute<FilaPrecioMes>(
    sql`WITH ventana(mes) AS (VALUES ${sql.join(
      meses.map((m) => sql`(${m}::text)`),
      sql`, `,
    )}),
         cierres AS (
           SELECT mes, (to_date(mes || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date AS fin
           FROM ventana
         ),
         ordenados AS (
           SELECT c.mes,
                  p.producto_3c,
                  p.precio::text AS precio,
                  row_number() OVER (
                    PARTITION BY c.mes, p.producto_3c
                    -- La COMPRA gana siempre sobre la ACTUALIZACION, sea cual sea la fecha.
                    ORDER BY (p.tipo = 'COMPRA') DESC, p.vigente_desde DESC, p.id DESC
                  ) AS rn
           FROM cierres c
           JOIN precios p ON p.vigente_desde <= c.fin AND p.precio > 0
         )
    SELECT mes, producto_3c, precio FROM ordenados WHERE rn = 1`,
  );
  return res.rows;
}

export type FilaGastoMensual = {
  mes: string;
  proveedor_id: number | null;
  proveedor: string | null;
  familia: string | null;
  gasto: string;
};

// Gasto (con IVA) por (mes, proveedor) para la evolución de 12 meses. Más liviano que traer
// el detalle por producto: el gráfico no necesita el renglón, solo la serie.
export async function gastoMensualPorProveedor(desde: string, hasta: string): Promise<FilaGastoMensual[]> {
  const res = await db.execute<FilaGastoMensual>(
    sql`SELECT to_char(c.fecha, 'YYYY-MM') AS mes,
               c.proveedor_id,
               pv.nombre AS proveedor,
               p.familia,
               sum(COALESCE(c.total_con_iva, c.precio_total))::text AS gasto
        FROM compras c
        JOIN productos p ON p.codigo_3c = c.producto_3c
        LEFT JOIN proveedores pv ON pv.id = c.proveedor_id
        WHERE to_char(c.fecha, 'YYYY-MM') BETWEEN ${desde} AND ${hasta}
          AND c.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
          AND upper(COALESCE(p.familia, '')) IN (${sql.join(
            FAMILIAS_CON_COMPRADOR.map((f) => sql`${f}`),
            sql`, `,
          )})
        GROUP BY 1, 2, 3, 4`,
  );
  return res.rows;
}

// Meses con compras cargadas (para el selector del informe), más nuevo primero.
export async function mesesConCompras(): Promise<string[]> {
  const res = await db.execute<{ mes: string }>(
    sql`SELECT DISTINCT to_char(fecha, 'YYYY-MM') AS mes FROM compras ORDER BY 1 DESC`,
  );
  return res.rows.map((r) => r.mes);
}
