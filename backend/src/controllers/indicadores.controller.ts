import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest } from '../domain/errors.js';
import { GuardarIndicadorSchema, IndicadoresQuerySchema } from '../domain/indicadores.schema.js';
import { obtenerIndicadores, registrarIndicador } from '../services/indicadores.service.js';

// GET /api/indicadores[?desde=YYYY-MM&hasta=YYYY-MM] — ventas e inflación por mes.
export async function getIndicadores(req: Request, res: Response): Promise<void> {
  const parsed = IndicadoresQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerIndicadores(parsed.data));
}

// PUT /api/indicadores — carga o corrige un mes. Solo pisa los campos que mandes.
export async function putIndicador(req: Request, res: Response): Promise<void> {
  const parsed = GuardarIndicadorSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  if (!req.user) {
    throw new AppError('NO_AUTENTICADO', 'Falta autenticación', 401);
  }
  res.status(200).json(await registrarIndicador(parsed.data, { usuarioId: req.user.id }));
}
