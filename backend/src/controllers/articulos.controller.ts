import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { ArticulosQuerySchema, CrearArticuloSchema, EditarArticuloSchema } from '../domain/articulos.schema.js';
import {
  crearArticulo,
  editarArticulo,
  obtenerArticulos,
  obtenerFamiliasArticulos,
} from '../services/articulos.service.js';

// GET /api/articulos — maestro con filtros (q, familia, activo) + paginado.
export async function getArticulos(req: Request, res: Response): Promise<void> {
  const parsed = ArticulosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { page, limit, q, familia, activo } = parsed.data;
  res.status(200).json(await obtenerArticulos({ page, limit, q, familia, activo }));
}

// GET /api/articulos/familias — familias distintas (filtro + arranque de inventario).
export async function getFamiliasArticulos(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerFamiliasArticulos());
}

// POST /api/articulos — alta de artículo nuevo (código autogenerado).
export async function postArticulo(req: Request, res: Response): Promise<void> {
  const parsed = CrearArticuloSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(201).json(await crearArticulo(parsed.data));
}

// PUT /api/articulos/:codigo — edición (el código no cambia).
export async function putArticulo(req: Request, res: Response): Promise<void> {
  const raw = req.params.codigo;
  const codigo = (Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).trim();
  if (!codigo) throw badRequest('VALIDACION', 'Falta el código del artículo');
  const parsed = EditarArticuloSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await editarArticulo(codigo, parsed.data));
}
