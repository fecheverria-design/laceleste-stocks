import { Router } from 'express';
import { getProductos, getTipos, getUbicaciones } from '../controllers/catalogos.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const catalogosRouter = Router();

// Catálogos para selects del front. Requieren login.
catalogosRouter.get('/ubicaciones', requireAuth, getUbicaciones);
catalogosRouter.get('/productos', requireAuth, getProductos);
catalogosRouter.get('/tipos', requireAuth, getTipos);
