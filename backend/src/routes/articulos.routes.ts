import { Router } from 'express';
import {
  getArticulos,
  getFamiliasArticulos,
  postArticulo,
  putArticulo,
} from '../controllers/articulos.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const articulosRouter = Router();

// Maestro de artículos. Todo requiere login. /familias antes de /:codigo por si acaso
// (aunque acá no colisiona: son paths distintos).
articulosRouter.get('/articulos', requireAuth, getArticulos);
articulosRouter.get('/articulos/familias', requireAuth, getFamiliasArticulos);
articulosRouter.post('/articulos', requireAuth, postArticulo);
articulosRouter.put('/articulos/:codigo', requireAuth, putArticulo);
