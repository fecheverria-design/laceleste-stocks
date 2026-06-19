import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, type Tx } from '../db/client.js';
import {
  movimientos,
  movimientosDetalle,
  productos,
  tiposMovimiento,
  ubicaciones,
} from '../db/schema.js';

// Email del usuario de integración: a quién se le atribuyen los movimientos que
// entran por API mientras no exista auth JWT (Fase 1 — middleware auth pendiente).
export const EMAIL_USUARIO_INTEGRACION = 'integracion@laceleste.local';

export interface CabeceraInput {
  nro: string;
  tipoId: number;
  fecha: string;
  hora: string;
  turno?: string;
  proyeccion?: string;
  origenId: number;
  destinoId: number;
  usuarioId: number;
  observaciones?: string;
}

export interface RenglonInput {
  producto3c: string;
  cantidadReal: string;
  cantidadSugerida?: string;
  stockContado?: string;
  unidad: string;
  observaciones?: string;
}

// ── Resolución de catálogos (corren dentro de la tx) ─────────────────────────

export async function buscarUbicacionPorDep3c(
  tx: Tx,
  depId3c: number,
): Promise<{ id: number; tipo: string; nombre: string } | undefined> {
  const [row] = await tx
    .select({ id: ubicaciones.id, tipo: ubicaciones.tipo, nombre: ubicaciones.nombre })
    .from(ubicaciones)
    .where(eq(ubicaciones.depId3c, depId3c))
    .limit(1);
  return row;
}

export async function productosExistentes(tx: Tx, codigos: string[]): Promise<Set<string>> {
  if (codigos.length === 0) return new Set();
  const rows = await tx
    .select({ codigo: productos.codigo3c })
    .from(productos)
    .where(inArray(productos.codigo3c, codigos));
  return new Set(rows.map((r) => r.codigo));
}

export async function tipoPorCodigo(
  tx: Tx,
  codigo: string,
): Promise<{ id: number; signoStock: number } | undefined> {
  const [row] = await tx
    .select({ id: tiposMovimiento.id, signoStock: tiposMovimiento.signoStock })
    .from(tiposMovimiento)
    .where(eq(tiposMovimiento.codigo, codigo))
    .limit(1);
  return row;
}

// ── Escritura del movimiento confirmado (dentro de la tx) ────────────────────

// Correlativo propio vía la función plpgsql generar_nro (RINT-2026-00452).
export async function generarNro(tx: Tx, tipoCodigo: string, anio: number): Promise<string> {
  const res = await tx.execute<{ nro: string }>(
    sql`SELECT generar_nro(${tipoCodigo}, ${anio}) AS nro`,
  );
  const nro = res.rows[0]?.nro;
  if (!nro) throw new Error('generar_nro no devolvió correlativo');
  return nro;
}

export async function insertarCabecera(tx: Tx, data: CabeceraInput): Promise<number> {
  const [row] = await tx
    .insert(movimientos)
    .values({
      nro: data.nro,
      tipoId: data.tipoId,
      fecha: data.fecha,
      hora: data.hora,
      turno: data.turno,
      origenId: data.origenId,
      destinoId: data.destinoId,
      estado: 'CONFIRMADO',
      proyeccion: data.proyeccion,
      usuarioId: data.usuarioId,
      observaciones: data.observaciones,
      confirmadoEn: sql`now()`,
    })
    .returning({ id: movimientos.id });
  if (!row) throw new Error('insertarCabecera no devolvió id');
  return row.id;
}

export async function insertarDetalle(tx: Tx, movimientoId: number, renglones: RenglonInput[]): Promise<void> {
  await tx.insert(movimientosDetalle).values(
    renglones.map((r) => ({
      movimientoId,
      producto3c: r.producto3c,
      cantidadReal: r.cantidadReal,
      cantidadSugerida: r.cantidadSugerida,
      stockContado: r.stockContado,
      unidad: r.unidad,
      observaciones: r.observaciones,
    })),
  );
}

// Clave del advisory lock que serializa el refresh de stock entre transacciones.
// Arbitraria pero estable: todas las confirmaciones/anulaciones usan la misma.
const STOCK_REFRESH_LOCK_KEY = 727274;

// Refresca la vista materializada de stock. CONCURRENTLY exige el unique index
// (idx_stock_prod_ubic) y corre dentro de la tx de confirmación (regla #6, verificado).
//
// El advisory lock a nivel transacción serializa el par refresh+commit: sin él, dos
// transacciones simultáneas pueden refrescar con snapshots que no ven el commit de la
// otra y la matview queda sin uno de los movimientos (regla #5/#6). Con el lock, la
// segunda transacción espera al commit de la primera, así su refresh ve ambos. Se
// libera solo al terminar la tx (xact-level).
export async function refrescarStock(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${STOCK_REFRESH_LOCK_KEY})`);
  await tx.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY stock_actual`);
}

// ── Anulación (flip de estado, dentro de la tx) ──────────────────────────────

// Lee y BLOQUEA la fila (FOR UPDATE) para serializar dos anulaciones simultáneas
// del mismo movimiento: la segunda espera y, al desbloquear, ve estado='ANULADO'
// (READ COMMITTED re-lee la versión confirmada) → falla con YA_ANULADO (regla #5).
export async function bloquearMovimiento(
  tx: Tx,
  id: number,
): Promise<{ id: number; estado: string } | undefined> {
  const [row] = await tx
    .select({ id: movimientos.id, estado: movimientos.estado })
    .from(movimientos)
    .where(eq(movimientos.id, id))
    .limit(1)
    .for('update');
  return row;
}

// Flip CONFIRMADO → ANULADO + sellos de auditoría (regla #7). NO toca el detalle
// ni las cantidades del original: la inmutabilidad de la cantidad se preserva.
export async function marcarAnulado(tx: Tx, id: number, usuarioId: number): Promise<void> {
  await tx
    .update(movimientos)
    .set({ estado: 'ANULADO', anuladoPor: usuarioId, anuladoEn: sql`now()` })
    .where(eq(movimientos.id, id));
}

// ── Lecturas (fuera de tx, sobre el pool normal) ─────────────────────────────

export interface MovimientoConDetalle {
  id: number;
  nro: string;
  estado: string;
  fecha: string;
  origen_id: number;
  destino_id: number;
  confirmado_en: string | null;
  anulado_en: string | null;
  detalle: {
    producto_3c: string;
    cantidad_real: string;
    cantidad_sugerida: string | null;
    unidad: string;
  }[];
}

export async function obtenerMovimiento(
  ejecutor: typeof db | Tx,
  id: number,
): Promise<MovimientoConDetalle | undefined> {
  const [cab] = await ejecutor
    .select({
      id: movimientos.id,
      nro: movimientos.nro,
      estado: movimientos.estado,
      fecha: movimientos.fecha,
      origen_id: movimientos.origenId,
      destino_id: movimientos.destinoId,
      confirmado_en: movimientos.confirmadoEn,
      anulado_en: movimientos.anuladoEn,
    })
    .from(movimientos)
    .where(eq(movimientos.id, id))
    .limit(1);
  if (!cab) return undefined;

  const renglones = await ejecutor
    .select({
      producto_3c: movimientosDetalle.producto3c,
      cantidad_real: movimientosDetalle.cantidadReal,
      cantidad_sugerida: movimientosDetalle.cantidadSugerida,
      unidad: movimientosDetalle.unidad,
    })
    .from(movimientosDetalle)
    .where(eq(movimientosDetalle.movimientoId, id));

  return {
    ...cab,
    confirmado_en: cab.confirmado_en ? new Date(cab.confirmado_en).toISOString() : null,
    anulado_en: cab.anulado_en ? new Date(cab.anulado_en).toISOString() : null,
    detalle: renglones,
  };
}

// ── Listado de movimientos (paginado, fuera de tx) ───────────────────────────

export interface ListaFiltros {
  desde?: string; // YYYY-MM-DD (fecha >=)
  hasta?: string; // YYYY-MM-DD (fecha <=)
  tipo?: string; // codigo de tipos_movimiento
  ubicacionId?: number; // matchea origen O destino
  estado?: string;
}

export interface MovimientoResumen {
  id: number;
  nro: string;
  tipo: string; // codigo
  estado: string;
  fecha: string;
  hora: string;
  origen_id: number;
  destino_id: number;
  usuario_id: number;
  creado_en: string | null;
  confirmado_en: string | null;
  anulado_en: string | null;
}

// Condiciones compartidas entre el listado y el count (mismo filtro, mismo total).
function condicionesLista(f: ListaFiltros): SQL[] {
  const conds: SQL[] = [];
  if (f.desde) conds.push(gte(movimientos.fecha, f.desde));
  if (f.hasta) conds.push(lte(movimientos.fecha, f.hasta));
  if (f.estado) conds.push(eq(movimientos.estado, f.estado));
  if (f.tipo) conds.push(eq(tiposMovimiento.codigo, f.tipo));
  if (f.ubicacionId !== undefined) {
    conds.push(or(eq(movimientos.origenId, f.ubicacionId), eq(movimientos.destinoId, f.ubicacionId))!);
  }
  return conds;
}

export async function listarMovimientos(
  f: ListaFiltros,
  page: number,
  limit: number,
): Promise<MovimientoResumen[]> {
  const conds = condicionesLista(f);
  const rows = await db
    .select({
      id: movimientos.id,
      nro: movimientos.nro,
      tipo: tiposMovimiento.codigo,
      estado: movimientos.estado,
      fecha: movimientos.fecha,
      hora: movimientos.hora,
      origen_id: movimientos.origenId,
      destino_id: movimientos.destinoId,
      usuario_id: movimientos.usuarioId,
      creado_en: movimientos.creadoEn,
      confirmado_en: movimientos.confirmadoEn,
      anulado_en: movimientos.anuladoEn,
    })
    .from(movimientos)
    .innerJoin(tiposMovimiento, eq(tiposMovimiento.id, movimientos.tipoId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(movimientos.fecha), desc(movimientos.id)) // recientes primero; id desempata
    .limit(limit)
    .offset((page - 1) * limit);

  return rows.map((r) => ({
    ...r,
    creado_en: r.creado_en ? new Date(r.creado_en).toISOString() : null,
    confirmado_en: r.confirmado_en ? new Date(r.confirmado_en).toISOString() : null,
    anulado_en: r.anulado_en ? new Date(r.anulado_en).toISOString() : null,
  }));
}

export async function contarMovimientos(f: ListaFiltros): Promise<number> {
  const conds = condicionesLista(f);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(movimientos)
    .innerJoin(tiposMovimiento, eq(tiposMovimiento.id, movimientos.tipoId))
    .where(conds.length ? and(...conds) : undefined);
  return row?.n ?? 0;
}

export async function resolverUsuarioIntegracion(): Promise<number | undefined> {
  const { usuarios } = await import('../db/schema.js');
  const [row] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.email, EMAIL_USUARIO_INTEGRACION))
    .limit(1);
  return row?.id;
}

export interface FilaStock {
  producto_3c: string;
  ubicacion_id: number;
  cantidad: number;
  actualizado_en: string | null;
}

export async function consultarStock(filtros: {
  ubicacionId?: number;
  producto3c?: string;
}): Promise<FilaStock[]> {
  const conds = [sql`TRUE`];
  if (filtros.ubicacionId !== undefined) conds.push(sql`ubicacion_id = ${filtros.ubicacionId}`);
  if (filtros.producto3c !== undefined) conds.push(sql`producto_3c = ${filtros.producto3c}`);

  const res = await db.execute<{
    producto_3c: string;
    ubicacion_id: number;
    cantidad: string;
    actualizado_en: string | null;
  }>(
    sql`SELECT producto_3c, ubicacion_id, cantidad, actualizado_en
        FROM stock_actual
        WHERE ${sql.join(conds, sql` AND `)}
        ORDER BY producto_3c, ubicacion_id`,
  );

  return res.rows.map((r) => ({
    producto_3c: r.producto_3c,
    ubicacion_id: r.ubicacion_id,
    cantidad: Number(r.cantidad),
    actualizado_en: r.actualizado_en ? new Date(r.actualizado_en).toISOString() : null,
  }));
}
