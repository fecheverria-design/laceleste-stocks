import { Router } from 'express';
import { getIndicadores, putIndicador } from '../controllers/indicadores.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const indicadoresRouter = Router();

// Ventas e inflación de carga manual (una fila por mes). Todo requiere login.
indicadoresRouter.get('/indicadores', requireAuth, getIndicadores);
indicadoresRouter.put('/indicadores', requireAuth, putIndicador);
