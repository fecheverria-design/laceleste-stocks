import { Router } from 'express';
import {
  getHistorial,
  getMovimiento,
  getMovimientos,
  getStock,
  postAbastecimiento,
  putAnularMovimiento,
  putEditarMovimiento,
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
movimientosRouter.get('/movimientos/:id/historial', requireAuth, getHistorial);
movimientosRouter.get('/stock', requireAuth, getStock);

// Edición: cualquier usuario logueado (decisión de J). Reemplazo completo +
// recalculo de stock + historial. No editable si está ANULADO.
movimientosRouter.put('/movimientos/:id', requireAuth, putEditarMovimiento);

// Anulación: solo ADMIN (CLAUDE.md: DEPOSITO no anula). CONFIRMADO → ANULADO.
movimientosRouter.put('/movimientos/:id/anular', requireAuth, requireRole('ADMIN'), putAnularMovimiento);
