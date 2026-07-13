import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { ConsumosQuerySchema } from '../domain/consumos.schema.js';
import { obtenerConsumos } from '../services/consumos.service.js';

// Fecha local YYYY-MM-DD con offset de días.
function ymd(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// GET /api/consumos — consumo por (producto, área) + promedio semanal.
// Default: últimas 12 semanas (84 días).
export async function getConsumos(req: Request, res: Response): Promise<void> {
  const parsed = ConsumosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const desde = parsed.data.desde ?? ymd(-83);
  const hasta = parsed.data.hasta ?? ymd(0);
  res.status(200).json(await obtenerConsumos({ desde, hasta, producto3c: parsed.data.producto_3c }));
}
