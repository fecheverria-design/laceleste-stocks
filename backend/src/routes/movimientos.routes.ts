import { Router } from 'express';
import {
  getMovimiento,
  getMovimientos,
  getStock,
  postAbastecimiento,
  putAnularMovimiento,
} from '../controllers/movimientos.controller.js';

export const movimientosRouter = Router();

// Ingreso de abastecimiento (RINT auto-confirmado) desde la app del compañero.
movimientosRouter.post('/abastecimientos', postAbastecimiento);

// Listado con filtros + paginado, y detalle por id.
movimientosRouter.get('/movimientos', getMovimientos);
movimientosRouter.get('/movimientos/:id', getMovimiento);

// Anulación: CONFIRMADO → ANULADO (flip de estado, transaccional). Revierte stock.
movimientosRouter.put('/movimientos/:id/anular', putAnularMovimiento);

// Stock actual recalculado.
movimientosRouter.get('/stock', getStock);
