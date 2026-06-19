import { Router } from 'express';
import {
  getMovimiento,
  getMovimientos,
  getStock,
  postAbastecimiento,
  putAnularMovimiento,
} from '../controllers/movimientos.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const movimientosRouter = Router();

// Ingreso de abastecimiento (RINT auto-confirmado) desde la app del compañero.
// M2M: lo invoca la app del compañero, no un humano. Auth de máquina pendiente
// (API key) — por ahora abierto y auditado al usuario de integración.
movimientosRouter.post('/abastecimientos', postAbastecimiento);

// Lecturas: cualquier usuario logueado (ADMIN o DEPOSITO).
movimientosRouter.get('/movimientos', requireAuth, getMovimientos);
movimientosRouter.get('/movimientos/:id', requireAuth, getMovimiento);
movimientosRouter.get('/stock', requireAuth, getStock);

// Anulación: solo ADMIN (CLAUDE.md: DEPOSITO no anula). CONFIRMADO → ANULADO.
movimientosRouter.put('/movimientos/:id/anular', requireAuth, requireRole('ADMIN'), putAnularMovimiento);
