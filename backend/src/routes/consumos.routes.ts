import { Router } from 'express';
import { getConsumos } from '../controllers/consumos.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const consumosRouter = Router();

// Consumo por área (lo que sale de FABRICA a las áreas) + promedio semanal. Requiere login.
consumosRouter.get('/consumos', requireAuth, getConsumos);
