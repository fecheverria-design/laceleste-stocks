import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { dec, enviarCsv } from '../lib/csv.js';
import { ArticulosQuerySchema, CrearArticuloSchema, EditarArticuloSchema } from '../domain/articulos.schema.js';

// Tope del export: el maestro tiene ~1.200 artículos, así que esto no lo toca nunca. Está
// para que un bug no pueda pedir la tabla entera sin límite.
const LIMITE_EXPORT = 50_000;
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

// GET /api/articulos/export.csv — el maestro filtrado, SIN paginar.
// El listado se ve de a 50, pero el export tiene que traer todo lo que matchea el filtro:
// bajar solo la página visible es justo lo que uno no espera de un botón "descargar".
export async function getArticulosCsv(req: Request, res: Response): Promise<void> {
  const parsed = ArticulosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { q, familia, activo } = parsed.data;
  const { items } = await obtenerArticulos({ page: 1, limit: LIMITE_EXPORT, q, familia, activo });
  enviarCsv(
    res,
    'articulos.csv',
    ['Codigo', 'Nombre', 'Familia', 'Subfamilia', 'Unidad', 'Presentacion', 'Ud por bulto', 'ABC', 'Estado', 'Origen'],
    items.map((a) => [
      a.codigo_3c,
      a.nombre,
      a.familia ?? '',
      a.subfamilia ?? '',
      a.unidad_base,
      a.presentacion_compra ?? '',
      a.unidades_por_bulto ? dec(a.unidades_por_bulto) : '',
      a.clasificacion_abc ?? '',
      a.activo ? 'activo' : 'inactivo',
      a.creado_local ? 'alta local' : '3c',
    ]),
  );
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
