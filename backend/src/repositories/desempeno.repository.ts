import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Desempeño del depósito: lo que la app del compañero dice que se despachó contra lo
// que el encargado cargó en 3c. NO es sugerido vs real (corrección de J 2026-09-08):
// mide si lo que salió del depósito quedó registrado igual en las dos puntas.
//
// Las dos fuentes, y por qué son esas:
//   · APP  = movimientos RINT con `nro_3c IS NULL` → los que entraron por el sync de la
//     app del compañero. Los que TIENEN nro_3c vinieron de 3c (import viejo o reemplazo):
//     compararlos sería comparar 3c contra sí mismo. Se incluyen los ANULADOS a propósito:
//     el reemplazo de período los anuló, pero son la constancia de lo que la app registró.
//   · 3C   = la tabla espejo `movimientos_3c` (el export semanal), NO los movimientos con
//     nro_3c. Así el cruce no depende de si el reemplazo se corrió o no en ese período.
//
// Se agrupa por (área, producto) EN EL PERÍODO, nunca por día: el egreso de la tarde que
// se carga al día siguiente daría dos errores (uno de más y uno de menos) cuando en
// realidad está bien. Medido sobre agosto, cruzar por fecha exacta daba 213 casos de "la
// app tiene de más" y por período 9.
//
// Alcance: egresos de FABRICA (dep 1) a las áreas. Se excluyen los baldes virtuales
// 101 (AJUSTES) y 102 (DEPOSITO DE PROVEEDORES): lo que los toca es ajuste o recepción,
// no abastecimiento.
// ─────────────────────────────────────────────────────────────────────────────

// Constantes del cruce. Se EXPORTAN porque la ficha de "cómo se calcula" se arma con ellas:
// si mañana se agrega un balde acá, la ficha lo dice sola (regla de oro de procedencia.ts).
export const DEP_FABRICA = 1;
export const BALDES = [101, 102] as const; // virtuales: AJUSTES y DEPOSITO DE PROVEEDORES
const BALDES_SQL = sql.raw(BALDES.join(', '));

export type FilaCruce = {
  area_dep_3c: number;
  area_nombre: string | null; // null = depósito de 3c sin alta en la app
  producto_3c: string;
  producto_nombre: string | null; // null = producto sin alta en el maestro
  unidad_base: string | null;
  unidades_por_bulto: string | null;
  cantidad_app: string;
  cantidad_3c: string;
  renglones_app: number;
  renglones_3c: number;
};

export async function cruceAppContra3c(filtros: { desde: string; hasta: string }): Promise<FilaCruce[]> {
  const res = await db.execute<FilaCruce>(
    sql`WITH app AS (
          SELECT ud.dep_id_3c AS area_dep_3c, d.producto_3c,
                 sum(d.cantidad_real) AS cantidad, count(*)::int AS renglones
          FROM movimientos_detalle d
          JOIN movimientos m ON m.id = d.movimiento_id
          JOIN tipos_movimiento tm ON tm.id = m.tipo_id
          JOIN ubicaciones uo ON uo.id = m.origen_id
          JOIN ubicaciones ud ON ud.id = m.destino_id
          WHERE m.nro_3c IS NULL
            AND tm.codigo = 'RINT'
            AND m.fecha BETWEEN ${filtros.desde} AND ${filtros.hasta}
            AND uo.dep_id_3c = ${DEP_FABRICA}
            AND ud.dep_id_3c NOT IN (${BALDES_SQL})
          GROUP BY 1, 2
        ),
        tresc AS (
          SELECT destino_dep_3c AS area_dep_3c, producto_3c,
                 sum(cantidad) AS cantidad, count(*)::int AS renglones
          FROM movimientos_3c
          WHERE tipo_doc = 'Rint'
            AND fecha BETWEEN ${filtros.desde} AND ${filtros.hasta}
            AND origen_dep_3c = ${DEP_FABRICA}
            AND destino_dep_3c IS NOT NULL
            AND destino_dep_3c NOT IN (${BALDES_SQL})
          GROUP BY 1, 2
        )
        SELECT coalesce(a.area_dep_3c, t.area_dep_3c) AS area_dep_3c,
               u.nombre AS area_nombre,
               coalesce(a.producto_3c, t.producto_3c) AS producto_3c,
               p.nombre AS producto_nombre,
               p.unidad_base,
               p.unidades_por_bulto::text AS unidades_por_bulto,
               coalesce(a.cantidad, 0)::text AS cantidad_app,
               coalesce(t.cantidad, 0)::text AS cantidad_3c,
               coalesce(a.renglones, 0) AS renglones_app,
               coalesce(t.renglones, 0) AS renglones_3c
        FROM app a
        FULL OUTER JOIN tresc t ON t.area_dep_3c = a.area_dep_3c AND t.producto_3c = a.producto_3c
        LEFT JOIN ubicaciones u ON u.dep_id_3c = coalesce(a.area_dep_3c, t.area_dep_3c)
        LEFT JOIN productos p ON p.codigo_3c = coalesce(a.producto_3c, t.producto_3c)
        ORDER BY u.nombre NULLS LAST, p.nombre NULLS LAST`,
  );
  return res.rows;
}

// Ventana que cubre el espejo de 3c. El cruce no puede decir nada fuera de acá: si el
// período pedido se pasa, lo que falta no es "el encargado no cargó", es que el export
// todavía no se importó (J lo trae 1× por semana).
export async function ventanaEspejo(): Promise<{ desde: string; hasta: string; renglones: number } | null> {
  const res = await db.execute<{ desde: string; hasta: string; renglones: number }>(
    sql`SELECT min(fecha)::text AS desde, max(fecha)::text AS hasta, count(*)::int AS renglones
        FROM movimientos_3c WHERE tipo_doc = 'Rint'`,
  );
  const f = res.rows[0];
  return f && f.desde ? f : null;
}
