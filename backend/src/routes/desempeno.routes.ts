import { Router } from 'express';
import { getDesempeno, getDesempenoCsv } from '../controllers/desempeno.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const desempenoRouter = Router();

// Desempeño del depósito: app del compañero vs 3c por (área, producto). Requiere login.
desempenoRouter.get('/desempeno', requireAuth, getDesempeno);
desempenoRouter.get('/desempeno/export.csv', requireAuth, getDesempenoCsv);
