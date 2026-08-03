import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest } from '../domain/errors.js';
import { dec, enviarCsv } from '../lib/csv.js';
import { ControlPreciosQuerySchema, CrearPrecioSchema, EditarPrecioSchema } from '../domain/precios.schema.js';
import {
  crearPrecio,
  editarPrecio,
  eliminarPrecio,
  obtenerHistorialPrecios,
  obtenerPreciosVigentes,
  obtenerValorizacionStock,
} from '../services/precios.service.js';
import { controlDePrecios } from '../services/control-precios.service.js';

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });
const PreciosCsvQuerySchema = z.object({ familia: z.string().trim().min(1).max(64).optional() });
const ProductoParamSchema = z.object({ codigo: z.string().trim().min(1).max(32) });

// GET /api/precios — precio vigente por producto (incluye los sin precio).
export async function getPrecios(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerPreciosVigentes());
}

// GET /api/precios/control?abc=A[&familia=] — la hoja de trabajo del área de compras:
// cada producto con sus cotizaciones y por qué hay que revisarlo.
export async function getControlPrecios(req: Request, res: Response): Promise<void> {
  const parsed = ControlPreciosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await controlDePrecios(parsed.data));
}

// GET /api/precios/export.csv — el precio vigente de cada producto, para Excel.
// Incluye los que no tienen precio (columna vacía): saber cuáles faltan es medio punto
// del archivo, y filtrarlos acá los escondería.
export async function getPreciosCsv(req: Request, res: Response): Promise<void> {
  const parsed = PreciosCsvQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { familia } = parsed.data;
  const todas = await obtenerPreciosVigentes();
  // Mismo filtro que la pantalla: si estás mirando una familia, el archivo trae esa
  // familia y no el maestro entero.
  const filas = familia ? todas.filter((p) => p.producto_familia === familia) : todas;
  enviarCsv(
    res,
    'precios.csv',
    ['Codigo', 'Producto', 'Familia', 'Unidad', 'Precio', 'Vigente desde', 'Tipo', 'Proveedor ID', 'Proveedor'],
    filas.map((p) => [
      p.producto_3c,
      p.producto_nombre,
      p.producto_familia ?? '',
      p.unidad_base,
      p.precio ? dec(p.precio) : '',
      p.vigente_desde ?? '',
      p.tipo ?? '',
      p.proveedor_numero_3c ?? '',
      p.proveedor_nombre ?? '',
    ]),
  );
}

// GET /api/valorizacion — valor del stock (cantidad × precio vigente): total,
// por depósito y top productos.
export async function getValorizacion(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerValorizacionStock());
}

// GET /api/productos/:codigo/precios — historial de precios de un producto.
export async function getHistorialPrecios(req: Request, res: Response): Promise<void> {
  const parsed = ProductoParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await obtenerHistorialPrecios(parsed.data.codigo));
}

// POST /api/precios — cargar un precio nuevo (con fecha). Cualquier usuario logueado.
export async function postPrecio(req: Request, res: Response): Promise<void> {
  const parsed = CrearPrecioSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  if (!req.user) {
    throw new AppError('NO_AUTENTICADO', 'Falta autenticación', 401);
  }
  const precio = await crearPrecio(parsed.data, { usuarioId: req.user.id });
  res.status(201).json(precio);
}

// PUT /api/precios/:id — corregir un precio (monto y/o fecha).
export async function putPrecio(req: Request, res: Response): Promise<void> {
  const idParsed = IdParamSchema.safeParse(req.params);
  if (!idParsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(idParsed.error));
  }
  const bodyParsed = EditarPrecioSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(bodyParsed.error));
  }
  const precio = await editarPrecio(idParsed.data.id, bodyParsed.data);
  res.status(200).json(precio);
}

// DELETE /api/precios/:id — borrar un precio mal cargado.
export async function deletePrecio(req: Request, res: Response): Promise<void> {
  const parsed = IdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  await eliminarPrecio(parsed.data.id);
  res.status(204).send();
}
