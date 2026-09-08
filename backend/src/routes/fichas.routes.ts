import { Router } from 'express';
import type { Request, Response } from 'express';
import { fichasPorHoja } from '../services/fichas.service.js';
import { requireAuth } from '../middleware/auth.js';

export const fichasRouter = Router();

// GET /api/fichas — el fundamento de cada número de la app, agrupado por hoja.
fichasRouter.get('/fichas', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json(await fichasPorHoja());
});
