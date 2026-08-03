import { and, asc, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { indicadoresMensuales } from '../db/schema.js';

// Ventas e inflación por mes. Tabla chica de carga manual: no hay paginado ni filtros
// complejos a propósito, son doce filas por año.

export type FilaIndicador = {
  periodo: string;
  ventas: string | null;
  inflacion: string | null;
  actualizado_en: Date;
};

export async function listarIndicadores(rango?: { desde?: string; hasta?: string }): Promise<FilaIndicador[]> {
  const conds = [];
  if (rango?.desde) conds.push(gte(indicadoresMensuales.periodo, rango.desde));
  if (rango?.hasta) conds.push(lte(indicadoresMensuales.periodo, rango.hasta));

  const filas = await db
    .select({
      periodo: indicadoresMensuales.periodo,
      ventas: indicadoresMensuales.ventas,
      inflacion: indicadoresMensuales.inflacion,
      actualizado_en: indicadoresMensuales.actualizadoEn,
    })
    .from(indicadoresMensuales)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(indicadoresMensuales.periodo));
  return filas;
}

/**
 * Alta o corrección de un mes. Solo pisa los campos que vinieron: mandar ventas no borra la
 * inflación ya cargada, que es justo lo que pasa en la práctica (se cargan en momentos
 * distintos del mes).
 */
export async function guardarIndicador(datos: {
  periodo: string;
  ventas?: number | null;
  inflacion?: number | null;
  usuarioId: number;
}): Promise<FilaIndicador> {
  const set: Record<string, unknown> = { actualizadoEn: sql`now()`, usuarioId: datos.usuarioId };
  if (datos.ventas !== undefined) set.ventas = datos.ventas === null ? null : String(datos.ventas);
  if (datos.inflacion !== undefined) set.inflacion = datos.inflacion === null ? null : String(datos.inflacion);

  const [fila] = await db
    .insert(indicadoresMensuales)
    .values({
      periodo: datos.periodo,
      ventas: datos.ventas === undefined || datos.ventas === null ? null : String(datos.ventas),
      inflacion: datos.inflacion === undefined || datos.inflacion === null ? null : String(datos.inflacion),
      usuarioId: datos.usuarioId,
    })
    .onConflictDoUpdate({ target: indicadoresMensuales.periodo, set })
    .returning({
      periodo: indicadoresMensuales.periodo,
      ventas: indicadoresMensuales.ventas,
      inflacion: indicadoresMensuales.inflacion,
      actualizado_en: indicadoresMensuales.actualizadoEn,
    });
  if (!fila) throw new Error('No se pudo guardar el indicador mensual');
  return fila;
}
