import { Router } from 'express';
import { getStock, postAbastecimiento, putAnularMovimiento } from '../controllers/movimientos.controller.js';

export const movimientosRouter = Router();

// Ingreso de abastecimiento (RINT auto-confirmado) desde la app del compañero.
movimientosRouter.post('/abastecimientos', postAbastecimiento);

// Anulación: CONFIRMADO → ANULADO (flip de estado, transaccional). Revierte stock.
movimientosRouter.put('/movimientos/:id/anular', putAnularMovimiento);

// Stock actual recalculado.
movimientosRouter.get('/stock', getStock);
