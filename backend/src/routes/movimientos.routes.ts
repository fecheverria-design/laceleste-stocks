import { Router } from 'express';
import {
  getHistorial,
  getMovimiento,
  getMovimientos,
  getMovimientosDeProducto,
  getStock,
  postAbastecimiento,
  postMovimiento,
  putAnularMovimiento,
  putEditarMovimiento,
} from '../controllers/movimientos.controller.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const movimientosRouter = Router();

// Ingreso de abastecimiento (RINT auto-confirmado) desde la app del compañero.
// M2M: lo invoca la app del compañero, no un humano. Auth de máquina pendiente
// (API key) — por ahora abierto y auditado al usuario de integración.
movimientosRouter.post('/abastecimientos', postAbastecimiento);

// Crear movimiento (auto-confirmado): cualquier usuario logueado.
movimientosRouter.post('/movimientos', requireAuth, postMovimiento);

// Lecturas: cualquier usuario logueado (ADMIN o DEPOSITO).
movimientosRouter.get('/movimientos', requireAuth, getMovimientos);
movimientosRouter.get('/movimientos/:id', requireAuth, getMovimiento);
movimientosRouter.get('/movimientos/:id/historial', requireAuth, getHistorial);
movimientosRouter.get('/stock', requireAuth, getStock);
movimientosRouter.get('/stock/movimientos', requireAuth, getMovimientosDeProducto);

// Edición: cualquier usuario logueado (decisión de J). Reemplazo completo +
// recalculo de stock + historial. No editable si está ANULADO.
movimientosRouter.put('/movimientos/:id', requireAuth, putEditarMovimiento);

// Anulación: solo ADMIN (CLAUDE.md: DEPOSITO no anula). CONFIRMADO → ANULADO.
movimientosRouter.put('/movimientos/:id/anular', requireAuth, requireRole('ADMIN'), putAnularMovimiento);
