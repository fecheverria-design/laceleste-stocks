import { Router } from 'express';
import {
  getAbastecimiento,
  getAbastecimientoCsv,
  putRevision,
} from '../controllers/abastecimiento.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const abastecimientoRouter = Router();

// ¿Despachó lo que había que despachar? Requiere login: la revisión queda a nombre de quien
// la hace (regla #7), así que no puede ser anónima.
abastecimientoRouter.get('/abastecimiento', requireAuth, getAbastecimiento);
abastecimientoRouter.get('/abastecimiento/export.csv', requireAuth, getAbastecimientoCsv);
abastecimientoRouter.put('/abastecimiento/revision', requireAuth, putRevision);
