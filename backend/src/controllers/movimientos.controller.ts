import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest } from '../domain/errors.js';
import { AbastecimientoSchema } from '../domain/movimientos.schema.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import { obtenerStock, registrarAbastecimiento } from '../services/movimientos.service.js';

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
