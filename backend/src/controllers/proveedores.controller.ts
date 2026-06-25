import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { CrearProveedorSchema, GastoQuerySchema } from '../domain/proveedores.schema.js';
import {
  crearProveedor,
  obtenerFamilias,
  obtenerGastoProveedores,
  obtenerProveedores,
} from '../services/proveedores.service.js';

// GET /api/proveedores — lista con gasto total y familias.
export async function getProveedores(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerProveedores());
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

// POST /api/proveedores — alta (numero_3c obligatorio).
export async function postProveedor(req: Request, res: Response): Promise<void> {
  const parsed = CrearProveedorSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const proveedor = await crearProveedor(parsed.data);
  res.status(201).json(proveedor);
}
