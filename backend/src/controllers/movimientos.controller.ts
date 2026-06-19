import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest } from '../domain/errors.js';
import { AbastecimientoSchema, MovimientosQuerySchema } from '../domain/movimientos.schema.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import {
  anularMovimiento,
  listarMovimientos,
  obtenerMovimientoPorId,
  obtenerStock,
  registrarAbastecimiento,
} from '../services/movimientos.service.js';

// POST /api/abastecimientos — ingreso desde la app del compañero (RINT auto-confirmado).
export async function postAbastecimiento(req: Request, res: Response): Promise<void> {
  const parsed = AbastecimientoSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }

  // Mientras no haya auth JWT, se audita al usuario de integración (regla #7).
  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new AppError(
      'USUARIO_INTEGRACION_FALTA',
      'No existe el usuario de integración (corré el seed: npm run db:seed)',
      500,
    );
  }

  const movimiento = await registrarAbastecimiento(parsed.data, { usuarioId });
  res.status(201).json(movimiento);
}

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// PUT /api/movimientos/:id/anular — CONFIRMADO → ANULADO (flip de estado, transaccional).
export async function putAnularMovimiento(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }

  // Mientras no haya auth JWT, se atribuye al usuario de integración (regla #7). Cambia con JWT.
  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new AppError(
      'USUARIO_INTEGRACION_FALTA',
      'No existe el usuario de integración (corré el seed: npm run db:seed)',
      500,
    );
  }

  const movimiento = await anularMovimiento(parsed.data.id, { usuarioId });
  res.status(200).json(movimiento);
}

// GET /api/movimientos — listado con filtros (desde/hasta/tipo/estado/ubicacion) + paginado.
export async function getMovimientos(req: Request, res: Response): Promise<void> {
  const parsed = MovimientosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { desde, hasta, tipo, estado, ubicacion, page, limit } = parsed.data;
  const result = await listarMovimientos({
    desde,
    hasta,
    tipo,
    estado,
    ubicacionId: ubicacion,
    page,
    limit,
  });
  res.status(200).json(result);
}

// GET /api/movimientos/:id — detalle (cabecera + renglones).
export async function getMovimiento(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const movimiento = await obtenerMovimientoPorId(parsed.data.id);
  res.status(200).json(movimiento);
}

const StockQuerySchema = z.object({
  ubicacion_id: z.coerce.number().int().positive().optional(),
  producto_3c: z.string().trim().min(1).optional(),
});

// GET /api/stock — stock actual (matview), filtrable por ubicación y/o producto.
export async function getStock(req: Request, res: Response): Promise<void> {
  const parsed = StockQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const stock = await obtenerStock({
    ubicacionId: parsed.data.ubicacion_id,
    producto3c: parsed.data.producto_3c,
  });
  res.status(200).json(stock);
}
