import { Router } from 'express';
import {
  getInformeCompradores,
  getInformeCsv,
  getInformeEvolucion,
  getInformeMeses,
} from '../controllers/informe.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const informeRouter = Router();

// Informe de Compras (solapa "Por Comprador"). Todo requiere login.
informeRouter.get('/informe/compradores', requireAuth, getInformeCompradores);
informeRouter.get('/informe/evolucion', requireAuth, getInformeEvolucion);
informeRouter.get('/informe/meses', requireAuth, getInformeMeses);
informeRouter.get('/informe/export.csv', requireAuth, getInformeCsv);
