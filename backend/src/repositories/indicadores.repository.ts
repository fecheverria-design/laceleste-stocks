import { and, asc, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { indicadoresMensuales } from '../db/schema.js';
import type { InflacionModo } from '../services/indicadores.service.js';

// Ventas e inflación por mes. Tabla chica de carga manual: no hay paginado ni filtros
// complejos a propósito, son doce filas por año.

export type FilaIndicador = {
  periodo: string;
  ventas: string | null;
  inflacion: string | null;
  inflacion_modo: InflacionModo;
  actualizado_en: Date;
};

const columnas = {
  periodo: indicadoresMensuales.periodo,
  ventas: indicadoresMensuales.ventas,
  inflacion: indicadoresMensuales.inflacion,
  inflacion_modo: indicadoresMensuales.inflacionModo,
  actualizado_en: indicadoresMensuales.actualizadoEn,
};

export async function listarIndicadores(rango?: { desde?: string; hasta?: string }): Promise<FilaIndicador[]> {
  const conds = [];
  if (rango?.desde) conds.push(gte(indicadoresMensuales.periodo, rango.desde));
  if (rango?.hasta) conds.push(lte(indicadoresMensuales.periodo, rango.hasta));

  const filas = await db
    .select(columnas)
    .from(indicadoresMensuales)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(indicadoresMensuales.periodo));
  return filas as FilaIndicador[];
}

/**
 * Alta o corrección de un mes. Solo pisa los campos que vinieron: mandar ventas no borra la
 * inflación ya cargada, que es justo lo que pasa en la práctica (se cargan en momentos
 * distintos del mes).
 *
 * El modo viaja pegado a la inflación —nunca solo—: cambiar el modo sin el número
 * reinterpretaría en silencio un dato ya cargado, que es exactamente el problema que esta
 * columna vino a resolver.
 */
export async function guardarIndicador(datos: {
  periodo: string;
  ventas?: number | null;
  inflacion?: number | null;
  inflacion_modo?: InflacionModo;
  usuarioId: number;
}): Promise<FilaIndicador> {
  const set: Record<string, unknown> = { actualizadoEn: sql`now()`, usuarioId: datos.usuarioId };
  if (datos.ventas !== undefined) set.ventas = datos.ventas === null ? null : String(datos.ventas);
  if (datos.inflacion !== undefined) {
    set.inflacion = datos.inflacion === null ? null : String(datos.inflacion);
    set.inflacionModo = datos.inflacion_modo ?? 'MENSUAL';
  }

  const [fila] = await db
    .insert(indicadoresMensuales)
    .values({
      periodo: datos.periodo,
      ventas: datos.ventas === undefined || datos.ventas === null ? null : String(datos.ventas),
      inflacion: datos.inflacion === undefined || datos.inflacion === null ? null : String(datos.inflacion),
      inflacionModo: datos.inflacion_modo ?? 'MENSUAL',
      usuarioId: datos.usuarioId,
    })
    .onConflictDoUpdate({ target: indicadoresMensuales.periodo, set })
    .returning(columnas);
  if (!fila) throw new Error('No se pudo guardar el indicador mensual');
  return fila as FilaIndicador;
}
