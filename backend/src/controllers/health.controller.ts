import type { Request, Response } from 'express';
import { getHealth } from '../services/health.service.js';

// Capa controller: recibe el request, llama al service, arma la respuesta.
export async function healthController(_req: Request, res: Response): Promise<void> {
  const health = await getHealth();
  res.status(health.db === 'up' ? 200 : 503).json(health);
}
