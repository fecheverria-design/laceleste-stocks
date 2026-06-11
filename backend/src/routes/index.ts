import { Router } from 'express';
import { healthRouter } from './health.routes.js';

// Router raíz de la API. Se monta bajo /api en app.ts.
// Acá se irán sumando los routers de movimientos, stock, etc. (Fase 1+).
export const apiRouter = Router();

apiRouter.use(healthRouter);
