import { Router } from 'express';
import { healthRouter } from './health.routes.js';
import { movimientosRouter } from './movimientos.routes.js';

// Router raíz de la API. Se monta bajo /api en app.ts.
export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(movimientosRouter);
