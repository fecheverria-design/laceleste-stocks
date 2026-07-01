import { env } from '../config/env.js';
import { db, type Tx } from '../db/client.js';
import { AppError, badRequest, conflict, notFound } from '../domain/errors.js';
import type {
  AbastecimientoInput,
  CrearMovimientoInput,
  EditarMovimientoInput,
  RecepcionInput,
} from '../domain/movimientos.schema.js';
import {
  actualizarCabecera,
  bloquearMovimiento,
  borrarDetalle,
  buscarPorIdempotencia,
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
  // Modo RECONCILIAR (sync "en vivo", opt-in): si ya existe un movimiento con la misma
  // idempotency_key, en vez de devolverlo tal cual (foto de la 1ª corrida), reeditarlo
  // con el estado fresco de la app del compañero → auditado + stock recalculado. Sin
  // cambios = no-op (no ensucia el historial). Default (false / undefined) → el POST M2M
  // sigue siendo "crear una vez". Detalle en registrarAutoConfirmado.
  reconciliar?: boolean;
}

// Recepción comparte la misma forma de opts (a quién se audita).
export type RegistrarRecepcionOpts = RegistrarAbastecimientoOpts;

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

// Campos de cabecera/renglones comunes a abastecimiento y recepción (lo que el helper
// auto-confirmado necesita además del tipo + origen/destino ya resueltos).
type AutoConfirmadoInput = Pick<
  AbastecimientoInput,
  'fecha' | 'turno' | 'proyeccion' | 'observaciones' | 'idempotency_key' | 'detalle'
>;

// Núcleo transaccional compartido (regla #6): idempotencia + correlativo + cabecera
// CONFIRMADO + detalle + refresh de stock_actual. El stock se mueve por DIRECCIÓN
// (origen resta, destino suma; cada punta solo si lleva_stock) usando cantidad_real
// (regla #2). Si algo falla, la tx entera hace rollback (regla #5). Lo comparten
// registrarAbastecimiento (RINT, descuenta del origen) y registrarRecepcion
// (RECEPCION, suma al destino): la única diferencia es el tipo y qué punta es el
// depósito real.
async function registrarAutoConfirmado(
  tipoCodigo: string,
  origenDep: number,
  destinoDep: number,
  input: AutoConfirmadoInput,
  usuarioId: number,
  reconciliar: boolean,
): Promise<MovimientoConDetalle> {
  const { anio, ...defaultFechaHora } = partesFechaHora();
  const fecha = input.fecha ?? defaultFechaHora.fecha;
  // El correlativo usa el año de la fecha del movimiento, no el del reloj.
  const anioNro = input.fecha ? Number(input.fecha.slice(0, 4)) : anio;

  return db.transaction(async (tx) => {
    // Idempotencia: si ya entró un movimiento con esta key, no se duplica. El índice
    // único uq_mov_idempotencia blinda también las concurrentes.
    if (input.idempotency_key) {
      const existenteId = await buscarPorIdempotencia(tx, input.idempotency_key);
      if (existenteId !== undefined) {
        const existente = await obtenerMovimiento(tx, existenteId);
        if (existente) {
          // Modo RECONCILIAR (sync en vivo, opt-in): en vez de devolver la foto de la
          // 1ª corrida, reeditar el movimiento con el estado fresco que trae ahora la
          // app del compañero. Reusa aplicarEdicion con ESTE MISMO tx (sin transacción
          // anidada) → transaccional, auditado y con stock recalculado. Si nada cambió,
          // el diff da vacío y no escribe auditoría (no-op: los días sin novedad no
          // ensucian el historial). Un movimiento ANULADO a mano NO se resucita: se
          // respeta la anulación y se devuelve tal cual (el sync no lo cuenta como error).
          if (reconciliar && existente.estado !== 'ANULADO') {
            return aplicarEdicion(
              tx,
              existente.id,
              {
                tipo: tipoCodigo,
                origen_dep_id_3c: origenDep,
                destino_dep_id_3c: destinoDep,
                fecha,
                turno: input.turno,
                proyeccion: input.proyeccion,
                observaciones: input.observaciones,
                detalle: input.detalle,
              },
              usuarioId,
            );
          }
          // Modo "crear una vez" (POST M2M por defecto): devolver el existente sin tocar.
          return existente;
        }
      }
    }

    const origen = await buscarUbicacionPorDep3c(tx, origenDep);
    if (!origen) {
      throw notFound('UBICACION_NO_ENCONTRADA', `No existe ubicación con dep_id_3c=${origenDep} (origen)`);
    }

    const destino = await buscarUbicacionPorDep3c(tx, destinoDep);
    if (!destino) {
      throw notFound('UBICACION_NO_ENCONTRADA', `No existe ubicación con dep_id_3c=${destinoDep} (destino)`);
    }

    const codigos = input.detalle.map((r) => r.producto_3c);
    const existentes = await productosExistentes(tx, codigos);
    const faltan = [...new Set(codigos)].filter((c) => !existentes.has(c));
    if (faltan.length > 0) {
      throw notFound('PRODUCTO_NO_ENCONTRADO', `Productos inexistentes en el maestro: ${faltan.join(', ')}`);
    }

    const tipo = await tipoPorCodigo(tx, tipoCodigo);
    if (!tipo) {
      throw new AppError('TIPO_NO_ENCONTRADO', `Falta el tipo ${tipoCodigo} en tipos_movimiento (corré el seed)`, 500);
    }

    const nro = await generarNro(tx, tipoCodigo, anioNro);

    const movimientoId = await insertarCabecera(tx, {
      nro,
      tipoId: tipo.id,
      fecha,
      hora: defaultFechaHora.hora,
      turno: input.turno,
      proyeccion: input.proyeccion,
      origenId: origen.id,
      destinoId: destino.id,
      usuarioId,
      observaciones: input.observaciones,
      idempotenciaKey: input.idempotency_key,
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

    // Recalcula la matview dentro de la misma tx → mueve el stock.
    await refrescarStock(tx);

    const creado = await obtenerMovimiento(tx, movimientoId);
    if (!creado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento recién creado', 500);
    return creado;
  });
}

// Ingreso de abastecimiento de la app del compañero → RINT auto-confirmado.
// El stock se descuenta del DEPÓSITO (origen) por cantidad_real (regla #2). Origen
// opcional: si falta, despacha el DEPOSITO_PRINCIPAL (FABRICA).
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
  return registrarAutoConfirmado(
    'RINT',
    origenDep,
    input.destino_dep_id_3c,
    input,
    opts.usuarioId,
    opts.reconciliar ?? false,
  );
}

// Recepción de mercadería de la app del compañero → RECEPCION auto-confirmada.
// Suma stock al DEPÓSITO que recibe (destino) por cantidad_real (regla #2). El origen
// es el proveedor (requerido por el schema); el destino opcional cae a DEPOSITO_PRINCIPAL
// (FABRICA). Mismo núcleo transaccional/idempotente que el abastecimiento.
export async function registrarRecepcion(
  input: RecepcionInput,
  opts: RegistrarRecepcionOpts,
): Promise<MovimientoConDetalle> {
  const destinoDep = input.destino_dep_id_3c ?? env.DEPOSITO_PRINCIPAL_DEP_ID_3C;
  if (destinoDep === undefined) {
    throw badRequest(
      'DESTINO_REQUERIDO',
      'Falta destino_dep_id_3c y no hay DEPOSITO_PRINCIPAL_DEP_ID_3C configurado',
    );
  }
  return registrarAutoConfirmado(
    'RECEPCION',
    input.origen_dep_id_3c,
    destinoDep,
    input,
    opts.usuarioId,
    opts.reconciliar ?? false,
  );
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

// Aplica una edición DENTRO de una tx YA ABIERTA (no abre transacción propia). Es el
// núcleo compartido de la edición: valida referencias, reemplaza cabecera + renglones,
// audita el diff (regla #7) y recalcula el stock. Lo usan dos caminos:
//   1) editarMovimiento (edición manual desde el front) → abre la tx y delega acá.
//   2) el modo reconciliar de registrarAutoConfirmado (sync en vivo) → ya está dentro de
//      su propia tx y llama a este helper con ese mismo tx.
// Así se reusa toda la lógica auditada/transaccional SIN anidar transacciones (llamar a
// editarMovimiento desde adentro de otra tx abriría una tx separada en otra conexión,
// que no vería lo no-commiteado y podría trabarse). Un movimiento ANULADO no se edita.
async function aplicarEdicion(
  tx: Tx,
  id: number,
  input: EditarMovimientoInput,
  usuarioId: number,
): Promise<MovimientoConDetalle> {
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
    await insertarAuditoria(tx, { movimientoId: id, usuarioId, accion: 'EDICION', cambios });
    // El stock SOLO puede cambiar si cambió tipo/origen/destino/detalle, y todo eso está
    // capturado en el diff. Sin cambios, la matview ya está correcta → evitamos el REFRESH
    // (que escanea todo el histórico). Clave para el sync horario reconciliar: cuando un día
    // no tuvo novedad, la reconciliación es un no-op barato (no refresca stock por gusto).
    await refrescarStock(tx);
  }

  const actualizado = await obtenerMovimiento(tx, id);
  if (!actualizado) throw new AppError('INTERNAL', 'No se pudo releer el movimiento editado', 500);
  return actualizado;
}

// Edición de un movimiento (regla #4 relajada: editable con historial). Abre la tx
// (regla #6) y delega en aplicarEdicion. Cualquier usuario logueado puede editar; un
// ANULADO no se edita.
export async function editarMovimiento(
  id: number,
  input: EditarMovimientoInput,
  opts: EditarMovimientoOpts,
): Promise<MovimientoConDetalle> {
  return db.transaction((tx) => aplicarEdicion(tx, id, input, opts.usuarioId));
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
