import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { abastecimientoRevisiones } from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// El cruce pedido-vs-despacho, por (día, área, producto). Las dos cantidades salen del
// MISMO renglón de la app del compañero, así que no hay corrimiento de fecha: por eso acá
// sí se mide día por día (decisión de J 2026-09-09).
//
// Solo las áreas que usan la app: las demás no la usan y aparecían como si nunca se les
// hubiera abastecido nada. Se pasan por parámetro para que la lista viva en un solo lugar.
// ─────────────────────────────────────────────────────────────────────────────

/** Áreas que trabajan con la app del compañero. Las otras no se miden (decisión de J). */
export const AREAS_MEDIDAS = [47, 48, 49, 50] as const; // Panadería, Pastelería, Recetas, Sandwichería

const DEP_FABRICA = 1;

export type FilaAbastecimiento = {
  fecha: string;
  area_dep_3c: number;
  area_nombre: string;
  producto_3c: string;
  producto_nombre: string | null;
  unidad_base: string | null;
  presentacion_compra: string | null;
  unidades_por_bulto: string | null;
  pedido: string;
  despacho: string;
  renglones: number;
  // Revisión manual, si alguien ya juzgó este caso.
  veredicto: string | null;
  nota: string | null;
  revisado_por: string | null;
  revisado_en: string | null;
};

export async function pedidoContraDespacho(filtros: {
  desde: string;
  hasta: string;
  areas: readonly number[];
}): Promise<FilaAbastecimiento[]> {
  const areas = sql.raw(filtros.areas.join(', '));
  const res = await db.execute<FilaAbastecimiento>(
    sql`WITH caso AS (
          SELECT m.fecha, ud.dep_id_3c AS area_dep_3c, ud.nombre AS area_nombre, d.producto_3c,
                 sum(d.cantidad_sugerida) AS pedido,
                 sum(d.cantidad_real)     AS despacho,
                 count(*)::int            AS renglones
          FROM movimientos_detalle d
          JOIN movimientos m       ON m.id = d.movimiento_id
          JOIN tipos_movimiento tm ON tm.id = m.tipo_id
          JOIN ubicaciones uo      ON uo.id = m.origen_id
          JOIN ubicaciones ud      ON ud.id = m.destino_id
          WHERE m.nro_3c IS NULL
            AND tm.codigo = 'RINT'
            AND m.fecha BETWEEN ${filtros.desde} AND ${filtros.hasta}
            AND uo.dep_id_3c = ${DEP_FABRICA}
            AND ud.dep_id_3c IN (${areas})
            AND d.cantidad_sugerida IS NOT NULL
          GROUP BY 1, 2, 3, 4
          -- Sin pedido no hay nada que juzgar: tratar un extra como "pidió 0" lo convertiría
          -- en un despacho de más gigante.
          HAVING sum(d.cantidad_sugerida) > 0
        )
        SELECT c.fecha::text AS fecha, c.area_dep_3c, c.area_nombre, c.producto_3c,
               p.nombre AS producto_nombre, p.unidad_base, p.presentacion_compra,
               p.unidades_por_bulto::text AS unidades_por_bulto,
               c.pedido::text AS pedido, c.despacho::text AS despacho, c.renglones,
               r.veredicto, r.nota, u.nombre AS revisado_por,
               to_char(r.revisado_en, 'DD/MM/YYYY HH24:MI') AS revisado_en
        FROM caso c
        LEFT JOIN productos p ON p.codigo_3c = c.producto_3c
        LEFT JOIN abastecimiento_revisiones r
               ON r.fecha = c.fecha AND r.area_dep_3c = c.area_dep_3c AND r.producto_3c = c.producto_3c
        LEFT JOIN usuarios u ON u.id = r.usuario_id
        ORDER BY c.fecha DESC, c.area_nombre, p.nombre NULLS LAST`,
  );
  return res.rows;
}

/** Guarda (o pisa) la revisión manual de un caso. Revisar de nuevo reemplaza la anterior. */
export async function guardarRevision(datos: {
  fecha: string;
  areaDep3c: number;
  producto3c: string;
  veredicto: string;
  nota: string | null;
  usuarioId: number;
}): Promise<void> {
  await db
    .insert(abastecimientoRevisiones)
    .values({
      fecha: datos.fecha,
      areaDep3c: datos.areaDep3c,
      producto3c: datos.producto3c,
      veredicto: datos.veredicto,
      nota: datos.nota,
      usuarioId: datos.usuarioId,
    })
    .onConflictDoUpdate({
      target: [abastecimientoRevisiones.fecha, abastecimientoRevisiones.areaDep3c, abastecimientoRevisiones.producto3c],
      set: {
        veredicto: sql`excluded.veredicto`,
        nota: sql`excluded.nota`,
        usuarioId: sql`excluded.usuario_id`,
        revisadoEn: sql`now()`,
      },
    });
}

/** Saca la revisión de un caso (volver a dejarlo como lo dejó la regla). */
export async function borrarRevision(datos: {
  fecha: string;
  areaDep3c: number;
  producto3c: string;
}): Promise<void> {
  await db.execute(
    sql`DELETE FROM abastecimiento_revisiones
        WHERE fecha = ${datos.fecha} AND area_dep_3c = ${datos.areaDep3c} AND producto_3c = ${datos.producto3c}`,
  );
}
