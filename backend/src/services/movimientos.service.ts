import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { AppError, badRequest, notFound } from '../domain/errors.js';
import type { AbastecimientoInput } from '../domain/movimientos.schema.js';
import {
  buscarUbicacionPorDep3c,
  consultarStock,
  generarNro,
  insertarCabecera,
  insertarDetalle,
  obtenerMovimiento,
  productosExistentes,
  refrescarStock,
  tipoPorCodigo,
  type FilaStock,
  type MovimientoConDetalle,
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

export async function obtenerStock(filtros: {
  ubicacionId?: number;
  producto3c?: string;
}): Promise<FilaStock[]> {
  return consultarStock(filtros);
}
