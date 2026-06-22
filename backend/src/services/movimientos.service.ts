import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { AppError, badRequest, conflict, notFound } from '../domain/errors.js';
import type { AbastecimientoInput, CrearMovimientoInput, EditarMovimientoInput } from '../domain/movimientos.schema.js';
import {
  actualizarCabecera,
  bloquearMovimiento,
  borrarDetalle,
  buscarUbicacionPorDep3c,
  consultarStock,
  contarMovimientos,
  generarNro,
  insertarAuditoria,
  insertarCabecera,
  insertarDetalle,
  leerSnapshotMovimiento,
  listarMovimientos as repoListarMovimientos,
  marcarAnulado,
  movimientosDeProducto,
  movimientosParaExport,
  obtenerAuditoria,
  obtenerMovimiento,
  productosExistentes,
  refrescarStock,
  tipoPorCodigo,
  type CambioAuditoria,
  type FilaAuditoria,
  type FilaStock,
  type ListaFiltros,
  type MovimientoConDetalle,
  type MovimientoDeProducto,
  type MovimientoResumen,
  type RenglonExport,
  type RenglonSnapshot,
  type SnapshotMovimiento,
} from '../repositories/movimientos.repository.js';

export interface RegistrarAbastecimientoOpts {
  usuarioId: number; // a quién se audita el movimiento (regla #7)
}

// Fecha local YYYY-MM-DD y hora HH:MM:SS para las columnas date/time.
function partesFechaHora(): { fecha: string; hora: string; anio: number } {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return { fecha: `${yyyy}-${mm}-${dd}`, hora: `${hh}:${mi}:${ss}`, anio: yyyy };
}

// Ingreso de abastecimiento de la app del compañero → RINT auto-confirmado.
// TODO transaccional (regla #6): correlativo + cabecera CONFIRMADO + detalle +
// refresh de stock_actual. El stock se descuenta del DEPÓSITO (origen) por
// cantidad_real (regla #2). Si algo falla, la tx entera hace rollback (regla #5).
export async function registrarAbastecimiento(
  input: AbastecimientoInput,
  opts: RegistrarAbastecimientoOpts,
): Promise<MovimientoConDetalle> {
  const origenDep = input.origen_dep_id_3c ?? env.DEPOSITO_PRINCIPAL_DEP_ID_3C;
  if (origenDep === undefined) {
    throw badRequest(
      'ORIGEN_REQUERIDO',
      'Falta origen_dep_id_3c y no hay DEPOSITO_PRINCIPAL_DEP_ID_3C configurado',
    );
  }

  const { anio, ...defaultFechaHora } = partesFechaHora();
  const fecha = input.fecha ?? defaultFechaHora.fecha;
  // El correlativo usa el año de la fecha del movimiento, no el del reloj.
  const anioNro = input.fecha ? Number(input.fecha.slice(0, 4)) : anio;

  return db.transaction(async (tx) => {
    const origen = await buscarUbicacionPorDep3c(tx, origenDep);
    if (!origen) {
      throw notFound('UBICACION_NO_ENCONTRADA', `No existe ubicación con dep_id_3c=${origenDep} (origen)`);
    }

    const destino = await buscarUbicacionPorDep3c(tx, input.destino_dep_id_3c);
    if (!destino) {
      throw notFound(
        'UBICACION_NO_ENCONTRADA',
        `No existe ubicación con dep_id_3c=${input.destino_dep_id_3c} (destino)`,
      );
    }

    const codigos = input.detalle.map((r) => r.producto_3c);
    const existentes = await productosExistentes(tx, codigos);
    const faltan = [...new Set(codigos)].filter((c) => !existentes.has(c));
    if (faltan.length > 0) {
      throw notFound('PRODUCTO_NO_ENCONTRADO', `Productos inexistentes en el maestro: ${faltan.join(', ')}`);
    }

    const tipo = await tipoPorCodigo(tx, 'RINT');
    if (!tipo) {
      throw new AppError('TIPO_NO_ENCONTRADO', 'Falta el tipo RINT en tipos_movimiento (corré el seed)', 500);
    }

    const nro = await generarNro(tx, 'RINT', anioNro);

    const movimientoId = await insertarCabecera(tx, {
      nro,
      tipoId: tipo.id,
      fecha,
      hora: defaultFechaHora.hora,
      turno: input.turno,
      proyeccion: input.proyeccion,
      origenId: origen.id,
      destinoId: destino.id,
      usuarioId: opts.usuarioId,
      observaciones: input.observaciones,
    });

    await insertarDetalle(
      tx,
      movimientoId,
      input.detalle.map((r) => ({
        producto3c: r.producto_3c,
        cantidadReal: r.cantidad_real.toString(),
        cantidadSugerida: r.cantidad_sugerida?.toString(),
        stockContado: r.stock_contado?.toString(),
        unidad: r.unidad,
        observaciones: r.observaciones,
      })),
    );

    // Descuenta stock del depósito recalculando la matview, dentro de la misma tx.
    await refrescarStock(tx);

    const creado = await obtenerMovimiento(tx, movimientoId);
    if (!creado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento recién creado', 500);
    return creado;
  });
}

export interface AnularMovimientoOpts {
  usuarioId: number; // a quién se atribuye la anulación (regla #7)
}

// Anulación por flip de estado (decisión 2026-06-19): CONFIRMADO → ANULADO en una
// sola tx (regla #6). El stock se revierte SOLO porque stock_actual filtra
// estado='CONFIRMADO'; por eso NO se genera contramovimiento (duplicaría la
// reversión). El original no se edita salvo el flip + sellos de auditoría (regla #7).
// La inmutabilidad de cantidad/producto del movimiento se preserva.
export async function anularMovimiento(
  id: number,
  opts: AnularMovimientoOpts,
): Promise<MovimientoConDetalle> {
  return db.transaction(async (tx) => {
    // FOR UPDATE serializa dos anulaciones simultáneas del mismo movimiento (regla #5).
    const mov = await bloquearMovimiento(tx, id);
    if (!mov) {
      throw notFound('MOVIMIENTO_NO_ENCONTRADO', `No existe el movimiento id=${id}`);
    }
    if (mov.estado === 'ANULADO') {
      throw conflict('YA_ANULADO', `El movimiento id=${id} ya está anulado`);
    }
    if (mov.estado !== 'CONFIRMADO') {
      throw conflict(
        'ESTADO_INVALIDO',
        `Solo se anula un movimiento CONFIRMADO (estado actual: ${mov.estado})`,
      );
    }

    await marcarAnulado(tx, id, opts.usuarioId);
    // La matview deja de contar el movimiento anulado → revierte el stock, sin contramovimiento.
    await refrescarStock(tx);

    const anulado = await obtenerMovimiento(tx, id);
    if (!anulado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento anulado', 500);
    return anulado;
  });
}

export interface ListarMovimientosParams extends ListaFiltros {
  page: number;
  limit: number;
}

export interface ListaMovimientosResult {
  items: MovimientoResumen[];
  page: number;
  limit: number;
  total: number;
}

// Listado paginado con filtros. items y total comparten el mismo filtro para que
// la paginación sea coherente (total = cuántos matchean, no cuántos se devuelven).
export async function listarMovimientos(params: ListarMovimientosParams): Promise<ListaMovimientosResult> {
  const { page, limit, ...filtros } = params;
  const [items, total] = await Promise.all([
    repoListarMovimientos(filtros, page, limit),
    contarMovimientos(filtros),
  ]);
  return { items, page, limit, total };
}

export async function obtenerMovimientoPorId(id: number): Promise<MovimientoConDetalle> {
  const mov = await obtenerMovimiento(db, id);
  if (!mov) throw notFound('MOVIMIENTO_NO_ENCONTRADO', `No existe el movimiento id=${id}`);
  return mov;
}

export interface EditarMovimientoOpts {
  usuarioId: number; // quién edita (queda en el historial)
}

// Normaliza renglones a una forma comparable (cantidades como número) para el diff.
function renglonesComparables(detalle: RenglonSnapshot[]): unknown {
  return detalle.map((r) => ({
    producto_3c: r.producto_3c,
    cantidad_real: Number(r.cantidad_real),
    cantidad_sugerida: r.cantidad_sugerida === null ? null : Number(r.cantidad_sugerida),
    stock_contado: r.stock_contado === null ? null : Number(r.stock_contado),
    unidad: r.unidad,
    observaciones: r.observaciones ?? null,
  }));
}

function snapshotDesdeInput(input: EditarMovimientoInput): Omit<SnapshotMovimiento, 'estado'> {
  return {
    tipo: input.tipo,
    origen_dep_id_3c: input.origen_dep_id_3c,
    destino_dep_id_3c: input.destino_dep_id_3c,
    fecha: input.fecha,
    turno: input.turno ?? null,
    proyeccion: input.proyeccion ?? null,
    observaciones: input.observaciones ?? null,
    detalle: input.detalle.map((r) => ({
      producto_3c: r.producto_3c,
      cantidad_real: String(r.cantidad_real),
      cantidad_sugerida: r.cantidad_sugerida === undefined ? null : String(r.cantidad_sugerida),
      stock_contado: r.stock_contado === undefined ? null : String(r.stock_contado),
      unidad: r.unidad,
      observaciones: r.observaciones ?? null,
    })),
  };
}

function diffSnapshots(antes: SnapshotMovimiento, despues: Omit<SnapshotMovimiento, 'estado'>): CambioAuditoria[] {
  const cambios: CambioAuditoria[] = [];
  const escalares = [
    'tipo',
    'origen_dep_id_3c',
    'destino_dep_id_3c',
    'fecha',
    'turno',
    'proyeccion',
    'observaciones',
  ] as const;
  for (const campo of escalares) {
    if (antes[campo] !== despues[campo]) {
      cambios.push({ campo, antes: antes[campo], despues: despues[campo] });
    }
  }
  const detAntes = renglonesComparables(antes.detalle);
  const detDespues = renglonesComparables(despues.detalle);
  if (JSON.stringify(detAntes) !== JSON.stringify(detDespues)) {
    cambios.push({ campo: 'detalle', antes: detAntes, despues: detDespues });
  }
  return cambios;
}

// Edición de un movimiento (regla #4 relajada: editable con historial). Reemplazo
// completo en una tx (regla #6): valida referencias, actualiza cabecera + renglones,
// registra el diff en movimientos_auditoria (regla #7) y recalcula el stock.
// Cualquier usuario logueado puede editar; un ANULADO no se edita.
export async function editarMovimiento(
  id: number,
  input: EditarMovimientoInput,
  opts: EditarMovimientoOpts,
): Promise<MovimientoConDetalle> {
  return db.transaction(async (tx) => {
    const antes = await leerSnapshotMovimiento(tx, id);
    if (!antes) {
      throw notFound('MOVIMIENTO_NO_ENCONTRADO', `No existe el movimiento id=${id}`);
    }
    if (antes.estado === 'ANULADO') {
      throw conflict('MOVIMIENTO_ANULADO', 'No se puede editar un movimiento anulado');
    }

    const origen = await buscarUbicacionPorDep3c(tx, input.origen_dep_id_3c);
    if (!origen) {
      throw notFound('UBICACION_NO_ENCONTRADA', `No existe ubicación con dep_id_3c=${input.origen_dep_id_3c} (origen)`);
    }
    const destino = await buscarUbicacionPorDep3c(tx, input.destino_dep_id_3c);
    if (!destino) {
      throw notFound(
        'UBICACION_NO_ENCONTRADA',
        `No existe ubicación con dep_id_3c=${input.destino_dep_id_3c} (destino)`,
      );
    }
    const tipo = await tipoPorCodigo(tx, input.tipo);
    if (!tipo) {
      throw badRequest('TIPO_INVALIDO', `Tipo de movimiento desconocido: ${input.tipo}`);
    }

    const codigos = input.detalle.map((r) => r.producto_3c);
    const existentes = await productosExistentes(tx, codigos);
    const faltan = [...new Set(codigos)].filter((c) => !existentes.has(c));
    if (faltan.length > 0) {
      throw notFound('PRODUCTO_NO_ENCONTRADO', `Productos inexistentes en el maestro: ${faltan.join(', ')}`);
    }

    await actualizarCabecera(tx, id, {
      tipoId: tipo.id,
      origenId: origen.id,
      destinoId: destino.id,
      fecha: input.fecha,
      turno: input.turno,
      proyeccion: input.proyeccion,
      observaciones: input.observaciones,
    });
    await borrarDetalle(tx, id);
    await insertarDetalle(
      tx,
      id,
      input.detalle.map((r) => ({
        producto3c: r.producto_3c,
        cantidadReal: r.cantidad_real.toString(),
        cantidadSugerida: r.cantidad_sugerida?.toString(),
        stockContado: r.stock_contado?.toString(),
        unidad: r.unidad,
        observaciones: r.observaciones,
      })),
    );

    const cambios = diffSnapshots(antes, snapshotDesdeInput(input));
    if (cambios.length > 0) {
      await insertarAuditoria(tx, { movimientoId: id, usuarioId: opts.usuarioId, accion: 'EDICION', cambios });
    }

    // El stock puede cambiar (cantidad, tipo, origen/destino): recalcular en la misma tx.
    await refrescarStock(tx);

    const actualizado = await obtenerMovimiento(tx, id);
    if (!actualizado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento editado', 500);
    return actualizado;
  });
}

export async function obtenerHistorial(id: number): Promise<FilaAuditoria[]> {
  return obtenerAuditoria(id);
}

export interface CrearMovimientoOpts {
  usuarioId: number;
}

// Crea un movimiento de cualquier tipo y lo AUTO-CONFIRMA en una tx (regla #6):
// correlativo según el tipo + cabecera CONFIRMADO + detalle + refresh de stock.
// Lo usa el front (humano logueado). Hermano de registrarAbastecimiento, que es el
// caso M2M específico de RINT desde la app del compañero.
export async function crearMovimiento(
  input: CrearMovimientoInput,
  opts: CrearMovimientoOpts,
): Promise<MovimientoConDetalle> {
  const hora = partesFechaHora().hora;
  const anioNro = Number(input.fecha.slice(0, 4));

  return db.transaction(async (tx) => {
    const origen = await buscarUbicacionPorDep3c(tx, input.origen_dep_id_3c);
    if (!origen) {
      throw notFound('UBICACION_NO_ENCONTRADA', `No existe ubicación con dep_id_3c=${input.origen_dep_id_3c} (origen)`);
    }
    const destino = await buscarUbicacionPorDep3c(tx, input.destino_dep_id_3c);
    if (!destino) {
      throw notFound(
        'UBICACION_NO_ENCONTRADA',
        `No existe ubicación con dep_id_3c=${input.destino_dep_id_3c} (destino)`,
      );
    }
    const tipo = await tipoPorCodigo(tx, input.tipo);
    if (!tipo) {
      throw badRequest('TIPO_INVALIDO', `Tipo de movimiento desconocido: ${input.tipo}`);
    }

    const codigos = input.detalle.map((r) => r.producto_3c);
    const existentes = await productosExistentes(tx, codigos);
    const faltan = [...new Set(codigos)].filter((c) => !existentes.has(c));
    if (faltan.length > 0) {
      throw notFound('PRODUCTO_NO_ENCONTRADO', `Productos inexistentes en el maestro: ${faltan.join(', ')}`);
    }

    const nro = await generarNro(tx, input.tipo, anioNro);
    const movimientoId = await insertarCabecera(tx, {
      nro,
      tipoId: tipo.id,
      fecha: input.fecha,
      hora,
      turno: input.turno,
      proyeccion: input.proyeccion,
      origenId: origen.id,
      destinoId: destino.id,
      usuarioId: opts.usuarioId,
      observaciones: input.observaciones,
    });
    await insertarDetalle(
      tx,
      movimientoId,
      input.detalle.map((r) => ({
        producto3c: r.producto_3c,
        cantidadReal: r.cantidad_real.toString(),
        cantidadSugerida: r.cantidad_sugerida?.toString(),
        stockContado: r.stock_contado?.toString(),
        unidad: r.unidad,
        observaciones: r.observaciones,
      })),
    );

    await refrescarStock(tx);

    const creado = await obtenerMovimiento(tx, movimientoId);
    if (!creado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento recién creado', 500);
    return creado;
  });
}

export async function obtenerStock(filtros: {
  ubicacionId?: number;
  producto3c?: string;
}): Promise<FilaStock[]> {
  return consultarStock(filtros);
}

// Movimientos de un producto (para el desplegable de stock al tocar una fila).
export async function obtenerMovimientosDeProducto(
  producto3c: string,
  ubicacionId?: number,
): Promise<MovimientoDeProducto[]> {
  return movimientosDeProducto(producto3c, ubicacionId);
}

// Renglones para exportar a Excel (mismos filtros del listado, sin paginar).
export async function obtenerMovimientosExport(filtros: ListaFiltros): Promise<RenglonExport[]> {
  return movimientosParaExport(filtros);
}
