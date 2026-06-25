import { Router } from 'express';
import {
  getFamilias,
  getGastoMensual,
  getGastoProveedores,
  getProveedores,
  postProveedor,
} from '../controllers/proveedores.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const proveedoresRouter = Router();

// Proveedores + gasto (de compras reales). Todo requiere login.
proveedoresRouter.get('/proveedores', requireAuth, getProveedores);
proveedoresRouter.get('/proveedores/gasto', requireAuth, getGastoProveedores);
proveedoresRouter.get('/proveedores/gasto-mensual', requireAuth, getGastoMensual);
proveedoresRouter.get('/familias', requireAuth, getFamilias);
proveedoresRouter.post('/proveedores', requireAuth, postProveedor);
