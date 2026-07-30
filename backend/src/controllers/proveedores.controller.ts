import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { dec, enviarCsv } from '../lib/csv.js';
import { CrearProveedorSchema, GastoQuerySchema } from '../domain/proveedores.schema.js';
import {
  crearProveedor,
  obtenerFamilias,
  obtenerGastoMensual,
  obtenerGastoProveedores,
  obtenerProductosProveedor,
  obtenerProveedores,
} from '../services/proveedores.service.js';

// GET /api/proveedores — lista con gasto y familias, filtrable por familia/período.
export async function getProveedores(req: Request, res: Response): Promise<void> {
  const parsed = GastoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerProveedores(parsed.data));
}

// GET /api/proveedores/export.csv — la lista con su gasto, respetando el mismo filtro de
// familia/período que la pantalla (si no, el archivo no cuadraría con lo que se ve).
export async function getProveedoresCsv(req: Request, res: Response): Promise<void> {
  const parsed = GastoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const filas = await obtenerProveedores(parsed.data);
  enviarCsv(
    res,
    'proveedores.csv',
    ['Numero 3c', 'Proveedor', 'CUIT', 'Compras', 'Gasto neto', 'Familias'],
    filas.map((p) => [
      p.numero_3c ?? '',
      p.nombre,
      p.cuit ?? '',
      p.compras,
      dec(p.gasto_neto),
      (p.familias ?? []).join(' / '),
    ]),
  );
}

// GET /api/familias — familias distintas (para el filtro del gráfico).
export async function getFamilias(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerFamilias());
}

// GET /api/proveedores/gasto — gasto por (proveedor, familia), filtrable.
export async function getGastoProveedores(req: Request, res: Response): Promise<void> {
  const parsed = GastoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerGastoProveedores(parsed.data));
}

// GET /api/proveedores/gasto-mensual — gasto neto por mes, filtrable.
export async function getGastoMensual(req: Request, res: Response): Promise<void> {
  const parsed = GastoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerGastoMensual(parsed.data));
}

// GET /api/proveedores/:id/productos — detalle de productos que le compramos (de qué es el
// gasto), filtrable por familia/período (misma barra que la lista y los gráficos).
export async function getProductosProveedor(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest('VALIDACION', 'id de proveedor inválido');
  }
  const parsed = GastoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerProductosProveedor(id, parsed.data));
}

// POST /api/proveedores — alta (numero_3c obligatorio).
export async function postProveedor(req: Request, res: Response): Promise<void> {
  const parsed = CrearProveedorSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const proveedor = await crearProveedor(parsed.data);
  res.status(201).json(proveedor);
}
