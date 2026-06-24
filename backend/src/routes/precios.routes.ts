import { Router } from 'express';
import {
  deletePrecio,
  getHistorialPrecios,
  getPrecios,
  postPrecio,
  putPrecio,
} from '../controllers/precios.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const preciosRouter = Router();

// Precios de productos (historial con fecha de vigencia). Todo requiere login.
preciosRouter.get('/precios', requireAuth, getPrecios);
preciosRouter.get('/productos/:codigo/precios', requireAuth, getHistorialPrecios);
preciosRouter.post('/precios', requireAuth, postPrecio);
preciosRouter.put('/precios/:id', requireAuth, putPrecio);
preciosRouter.delete('/precios/:id', requireAuth, deletePrecio);
