import { Router } from 'express';
import {
  deleteInventario,
  getInventario,
  getInventarios,
  postConfirmar,
  postInventario,
  postLinea,
  putLineas,
} from '../controllers/inventarios.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const inventariosRouter = Router();

// Inventarios (conteo físico → AJUSTE). Todo requiere login.
inventariosRouter.get('/inventarios', requireAuth, getInventarios);
inventariosRouter.post('/inventarios', requireAuth, postInventario);
inventariosRouter.get('/inventarios/:id', requireAuth, getInventario);
inventariosRouter.put('/inventarios/:id/lineas', requireAuth, putLineas);
inventariosRouter.post('/inventarios/:id/lineas', requireAuth, postLinea);
inventariosRouter.post('/inventarios/:id/confirmar', requireAuth, postConfirmar);
inventariosRouter.delete('/inventarios/:id', requireAuth, deleteInventario);
