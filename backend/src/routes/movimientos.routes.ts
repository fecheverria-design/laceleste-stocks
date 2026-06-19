import { Router } from 'express';
import { getStock, postAbastecimiento } from '../controllers/movimientos.controller.js';

export const movimientosRouter = Router();

// Ingreso de abastecimiento (RINT auto-confirmado) desde la app del compañero.
movimientosRouter.post('/abastecimientos', postAbastecimiento);

// Stock actual recalculado.
movimientosRouter.get('/stock', getStock);
