import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest } from '../domain/errors.js';
import {
  AbastecimientoSchema,
  CrearMovimientoSchema,
  EditarMovimientoSchema,
  MovimientosQuerySchema,
} from '../domain/movimientos.schema.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import {
  anularMovimiento,
  crearMovimiento,
  editarMovimiento,
  listarMovimientos,
  obtenerHistorial,
  obtenerMovimientoPorId,
  obtenerMovimientosDeProducto,
  obtenerMovimientosExport,
  obtenerStock,
  registrarAbastecimiento,
} from '../services/movimientos.service.js';

// POST /api/abastecimientos — ingreso desde la app del compañero (RINT auto-confirmado).
export async function postAbastecimiento(req: Request, res: Response): Promise<void> {
  const parsed = AbastecimientoSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }

  // Mientras no haya auth JWT, se audita al usuario de integración (regla #7).
  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new AppError(
      'USUARIO_INTEGRACION_FALTA',
      'No existe el usuario de integración (corré el seed: npm run db:seed)',
      500,
    );
  }

  const movimiento = await registrarAbastecimiento(parsed.data, { usuarioId });
  res.status(201).json(movimiento);
}

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// PUT /api/movimientos/:id/anular — CONFIRMADO → ANULADO (flip de estado, transaccional).
// Protegido (requireAuth + requireRole ADMIN): se audita al usuario del token (regla #7).
export async function putAnularMovimiento(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  if (!req.user) {
    throw new AppError('NO_AUTENTICADO', 'Falta autenticación', 401);
  }

  const movimiento = await anularMovimiento(parsed.data.id, { usuarioId: req.user.id });
  res.status(200).json(movimiento);
}

// GET /api/movimientos — listado con filtros (desde/hasta/tipo/estado/ubicacion) + paginado.
export async function getMovimientos(req: Request, res: Response): Promise<void> {
  const parsed = MovimientosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { desde, hasta, tipo, estado, ubicacion, producto, familia, usuario, nro, page, limit } = parsed.data;
  const result = await listarMovimientos({
    desde,
    hasta,
    tipo,
    estado,
    ubicacionId: ubicacion,
    producto,
    familia,
    usuarioId: usuario,
    nro,
    page,
    limit,
  });
  res.status(200).json(result);
}

// GET /api/movimientos/:id — detalle (cabecera + renglones).
export async function getMovimiento(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const movimiento = await obtenerMovimientoPorId(parsed.data.id);
  res.status(200).json(movimiento);
}

// PUT /api/movimientos/:id — editar (reemplazo completo). Cualquier usuario logueado.
// Recalcula stock y deja historial del cambio (regla #4 relajada + regla #7).
export async function putEditarMovimiento(req: Request, res: Response): Promise<void> {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(idParsed.error));
  }
  const bodyParsed = EditarMovimientoSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(bodyParsed.error));
  }
  if (!req.user) {
    throw new AppError('NO_AUTENTICADO', 'Falta autenticación', 401);
  }

  const movimiento = await editarMovimiento(idParsed.data.id, bodyParsed.data, { usuarioId: req.user.id });
  res.status(200).json(movimiento);
}

// GET /api/movimientos/:id/historial — ediciones del movimiento (más reciente primero).
export async function getHistorial(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const historial = await obtenerHistorial(parsed.data.id);
  res.status(200).json(historial);
}

// POST /api/movimientos — crear un movimiento (auto-confirmado). Cualquier usuario logueado.
export async function postMovimiento(req: Request, res: Response): Promise<void> {
  const parsed = CrearMovimientoSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  if (!req.user) {
    throw new AppError('NO_AUTENTICADO', 'Falta autenticación', 401);
  }
  const movimiento = await crearMovimiento(parsed.data, { usuarioId: req.user.id });
  res.status(201).json(movimiento);
}

const StockQuerySchema = z.object({
  ubicacion_id: z.coerce.number().int().positive().optional(),
  producto_3c: z.string().trim().min(1).optional(),
});

// GET /api/stock — stock actual (matview), filtrable por ubicación y/o producto.
export async function getStock(req: Request, res: Response): Promise<void> {
  const parsed = StockQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const stock = await obtenerStock({
    ubicacionId: parsed.data.ubicacion_id,
    producto3c: parsed.data.producto_3c,
  });
  res.status(200).json(stock);
}

// CSV apto para Excel es-AR: separador ';', decimales con coma, comillas si hace falta.
function celdaCsv(v: string | number): string {
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function filaCsv(campos: (string | number)[]): string {
  return campos.map(celdaCsv).join(';');
}
function aCsv(headers: string[], filas: (string | number)[][]): string {
  const lineas = [filaCsv(headers), ...filas.map(filaCsv)];
  return '﻿' + lineas.join('\r\n'); // BOM para que Excel lea UTF-8
}
const dec = (s: string): string => s.replace('.', ','); // 1380.000 -> 1380,000

// GET /api/movimientos/export.csv — export del listado (mismos filtros) a CSV/Excel.
export async function getMovimientosCsv(req: Request, res: Response): Promise<void> {
  const parsed = MovimientosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { desde, hasta, tipo, estado, ubicacion, producto, familia, usuario, nro } = parsed.data;
  const filas = await obtenerMovimientosExport({
    desde,
    hasta,
    tipo,
    estado,
    ubicacionId: ubicacion,
    producto,
    familia,
    usuarioId: usuario,
    nro,
  });
  // Cada entidad (origen/destino/producto) va con su ID y su nombre en COLUMNAS separadas,
  // nunca "47 - Panaderia" en una sola celda (rompe el filtrado/tabla dinámica en Excel).
  const csv = aCsv(
    ['Nro', 'Fecha', 'Hora', 'Tipo', 'Estado', 'Origen ID', 'Origen', 'Destino ID', 'Destino', 'Codigo', 'Producto', 'Cantidad', 'Unidad'],
    filas.map((r) => [
      r.nro,
      r.fecha,
      r.hora,
      r.tipo,
      r.estado,
      r.origen_dep_id_3c,
      r.origen_nombre,
      r.destino_dep_id_3c,
      r.destino_nombre,
      r.producto_3c,
      r.producto_nombre,
      dec(r.cantidad_real),
      r.unidad,
    ]),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="movimientos.csv"');
  res.status(200).send(csv);
}

const MovimientosProductoQuerySchema = z.object({
  producto_3c: z.string().trim().min(1),
  ubicacion_id: z.coerce.number().int().positive().optional(),
});

// GET /api/stock/movimientos — movimientos de un producto (desplegable de stock).
export async function getMovimientosDeProducto(req: Request, res: Response): Promise<void> {
  const parsed = MovimientosProductoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const movimientos = await obtenerMovimientosDeProducto(parsed.data.producto_3c, parsed.data.ubicacion_id);
  res.status(200).json(movimientos);
}
