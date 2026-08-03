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

// ─────────────────────────────────────────────────────────────────────────────
// Matriz de precios / cotizaciones — solapas "Matriz & Variación" y "Ahorro potencial",
// y la hoja de Control de precios.
//
// Por defecto la unidad de análisis es el producto de PRIORIDAD A, igual que el informe de
// la planilla (que se limita a la hoja Prioridad). El Control de precios usa el mismo dato
// pero deja elegir prioridad y familia, porque ahí se trabaja también sobre B y C.
// ─────────────────────────────────────────────────────────────────────────────

export type FiltroProductos = { abc?: 'A' | 'B' | 'C' | 'TODOS'; familia?: string };

// Condición de prioridad + familia, compartida por todas las consultas de precios.
function condProductos({ abc = 'A', familia }: FiltroProductos = {}) {
  return sql`${abc === 'TODOS' ? sql`TRUE` : sql`pr.clasificacion_abc = ${abc}`}
          ${familia ? sql`AND upper(COALESCE(pr.familia, '')) = upper(${familia})` : sql``}`;
}

export type FilaCotizacion = {
  id: number; // id de la fila de `precios`, para poder accionar sobre ella
  producto_3c: string;
  producto: string;
  familia: string | null;
  proveedor_id: number | null;
  proveedor: string | null;
  precio: string;
  fecha: string; // vigente_desde, 'YYYY-MM-DD'
  tipo: string; // 'COMPRA' | 'ACTUALIZACION'
  dias: number; // antigüedad de esa cotización, en días
};

// Última cotización de CADA proveedor para cada producto A. De acá salen la matriz
// expandible, el conteo de proveedores con cotización vigente y el cálculo de ahorro.
//
// Una fila por (producto, proveedor): la más reciente. `dias` se calcula en SQL contra
// CURRENT_DATE para que la antigüedad no dependa del reloj del proceso.
export async function cotizacionesProductos(filtro?: FiltroProductos): Promise<FilaCotizacion[]> {
  const res = await db.execute<FilaCotizacion>(
    sql`SELECT DISTINCT ON (p.producto_3c, p.proveedor_id)
               p.id,
               p.producto_3c,
               pr.nombre AS producto,
               pr.familia,
               p.proveedor_id,
               pv.nombre AS proveedor,
               p.precio::text,
               p.vigente_desde::text AS fecha,
               p.tipo,
               (CURRENT_DATE - p.vigente_desde)::int AS dias
        FROM precios p
        JOIN productos pr ON pr.codigo_3c = p.producto_3c
        LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
        WHERE ${condProductos(filtro)}
          AND p.precio > 0
          AND p.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
        ORDER BY p.producto_3c, p.proveedor_id, p.vigente_desde DESC, p.id DESC`,
  );
  return res.rows;
}

// El precio con el que efectivamente se compra (el "tick Usar" de la planilla): la última
// fila de tipo COMPRA. Si el producto nunca tuvo COMPRA cae a la última ACTUALIZACION y se
// marca `sin_compra` — el informe lo reporta como control de datos ("sin True").
export type FilaPrecioUsado = {
  producto_3c: string;
  proveedor_id: number | null;
  proveedor: string | null;
  precio: string;
  fecha: string;
  dias: number;
  sin_compra: boolean;
};

export async function preciosUsadosProductos(filtro?: FiltroProductos): Promise<FilaPrecioUsado[]> {
  const res = await db.execute<FilaPrecioUsado>(
    sql`SELECT DISTINCT ON (p.producto_3c)
               p.producto_3c,
               p.proveedor_id,
               pv.nombre AS proveedor,
               p.precio::text,
               p.vigente_desde::text AS fecha,
               (CURRENT_DATE - p.vigente_desde)::int AS dias,
               (p.tipo <> 'COMPRA') AS sin_compra
        FROM precios p
        JOIN productos pr ON pr.codigo_3c = p.producto_3c
        LEFT JOIN proveedores pv ON pv.id = p.proveedor_id
        WHERE ${condProductos(filtro)}
          AND p.precio > 0
          AND p.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
        -- La COMPRA gana siempre sobre la ACTUALIZACION, sea cual sea la fecha.
        ORDER BY p.producto_3c, (p.tipo = 'COMPRA') DESC, p.vigente_desde DESC, p.id DESC`,
  );
  return res.rows;
}

export type FilaPrecioMesCargado = {
  mes: string;
  producto_3c: string;
  familia: string | null;
  precio: string;
};

// Serie mensual del precio de COMPRA: el último precio con tick CARGADO en ese mes.
//
// ⚠ Distinto de `preciosVigentesPorMes`, que arrastra el último precio conocido hacia
// adelante. Acá un mes sin compra queda SIN dato, que es lo que hace el script: comparar
// contra un precio arrastrado daría 0% de variación, y "no compré" no es "no cambió".
// Lo usan el gráfico de variación 1/3/6m, la canasta A y la detección de saltos.
export async function preciosCompraPorMesCargado(
  desde: string,
  hasta: string,
  filtro?: FiltroProductos,
): Promise<FilaPrecioMesCargado[]> {
  const res = await db.execute<FilaPrecioMesCargado>(
    sql`SELECT DISTINCT ON (to_char(p.vigente_desde, 'YYYY-MM'), p.producto_3c)
               to_char(p.vigente_desde, 'YYYY-MM') AS mes,
               p.producto_3c,
               pr.familia,
               p.precio::text
        FROM precios p
        JOIN productos pr ON pr.codigo_3c = p.producto_3c
        WHERE ${condProductos(filtro)}
          AND p.tipo = 'COMPRA'
          AND p.precio > 0
          AND to_char(p.vigente_desde, 'YYYY-MM') BETWEEN ${desde} AND ${hasta}
          AND p.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
        ORDER BY 1, 2, p.vigente_desde DESC, p.id DESC`,
  );
  return res.rows;
}

export type FilaGastoProducto = {
  producto_3c: string;
  producto: string;
  familia: string | null;
  gasto: string;
};

// Gasto (con IVA) por producto en un mes. Pondera el ahorro y la canasta: un producto que
// subió mucho pero se compra poco casi no mueve el índice.
export async function gastoPorProductoDelMes(mes: string): Promise<FilaGastoProducto[]> {
  const res = await db.execute<FilaGastoProducto>(
    sql`SELECT c.producto_3c,
               p.nombre AS producto,
               p.familia,
               sum(COALESCE(c.total_con_iva, c.precio_total))::text AS gasto
        FROM compras c
        JOIN productos p ON p.codigo_3c = c.producto_3c
        WHERE to_char(c.fecha, 'YYYY-MM') = ${mes}
          AND c.producto_3c NOT IN (${sql.join(
            PRODUCTOS_FICTICIOS.map((cod) => sql`${cod}`),
            sql`, `,
          )})
          AND upper(COALESCE(p.familia, '')) IN (${sql.join(
            FAMILIAS_CON_COMPRADOR.map((f) => sql`${f}`),
            sql`, `,
          )})
        GROUP BY 1, 2, 3`,
  );
  return res.rows;
}
