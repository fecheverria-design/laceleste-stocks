import { Router } from 'express';
import {
  getAhorroCsv,
  getInformeCompradores,
  getInformeCsv,
  getInformeEvolucion,
  getInformeMeses,
  getInformePrecios,
  getMatrizCsv,
} from '../controllers/informe.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const informeRouter = Router();

// Informe de Compras (solapa "Por Comprador"). Todo requiere login.
informeRouter.get('/informe/compradores', requireAuth, getInformeCompradores);
informeRouter.get('/informe/evolucion', requireAuth, getInformeEvolucion);
informeRouter.get('/informe/meses', requireAuth, getInformeMeses);
informeRouter.get('/informe/export.csv', requireAuth, getInformeCsv);
// Solapas de precios: matriz, cobertura, control, ahorro, variación 1/3/6m, canasta y evolución.
informeRouter.get('/informe/precios', requireAuth, getInformePrecios);
informeRouter.get('/informe/matriz.csv', requireAuth, getMatrizCsv);
informeRouter.get('/informe/ahorro.csv', requireAuth, getAhorroCsv);
