import { Router } from 'express';
import {
  deletePrecio,
  getControlPrecios,
  getHistorialPrecios,
  getPrecios,
  getPreciosCsv,
  getValorizacion,
  postPrecio,
  putPrecio,
  putPrecioControlado,
} from '../controllers/precios.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const preciosRouter = Router();

// Precios de productos (historial con fecha de vigencia). Todo requiere login.
preciosRouter.get('/precios', requireAuth, getPrecios);
// Antes que cualquier ruta con parámetro, para que 'control' no se lea como un id.
preciosRouter.get('/precios/control', requireAuth, getControlPrecios);
preciosRouter.get('/precios/export.csv', requireAuth, getPreciosCsv);
preciosRouter.get('/valorizacion', requireAuth, getValorizacion);
preciosRouter.get('/productos/:codigo/precios', requireAuth, getHistorialPrecios);
preciosRouter.post('/precios', requireAuth, postPrecio);
preciosRouter.put('/precios/:id', requireAuth, putPrecio);
// Marcar/desmarcar EL precio del producto (independiente del tipo de la fila).
preciosRouter.put('/precios/:id/controlado', requireAuth, putPrecioControlado);
preciosRouter.delete('/precios/:id', requireAuth, deletePrecio);
