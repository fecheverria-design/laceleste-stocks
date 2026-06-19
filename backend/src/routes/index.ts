import { Router } from 'express';
import { authRouter } from './auth.routes.js';
import { catalogosRouter } from './catalogos.routes.js';
import { healthRouter } from './health.routes.js';
import { movimientosRouter } from './movimientos.routes.js';

// Router raíz de la API. Se monta bajo /api en app.ts.
export const apiRouter = Router();

apiRouter.use(authRouter);
apiRouter.use(healthRouter);
apiRouter.use(catalogosRouter);
apiRouter.use(movimientosRouter);
