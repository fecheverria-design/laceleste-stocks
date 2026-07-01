import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import {
  AgregarLineaSchema,
  CrearInventarioSchema,
  GuardarLineasSchema,
} from '../domain/inventarios.schema.js';
import {
  agregarLineaInventario,
  confirmarInventario,
  crearInventario,
  eliminarInventario,
  guardarLineas,
  obtenerInventarioDetalle,
  obtenerInventarios,
} from '../services/inventarios.service.js';

function idParam(req: Request): number {
  const raw = req.params.id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('VALIDACION', 'Id de inventario inválido');
  return id;
}

// GET /api/inventarios — lista de hojas (con conteo de líneas y contadas).
export async function getInventarios(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerInventarios());
}

// GET /api/inventarios/:id — hoja con líneas + stock del sistema + diferencia/%.
export async function getInventario(req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerInventarioDetalle(idParam(req)));
}

// POST /api/inventarios — crea una hoja BORRADOR (depósito + familias).
export async function postInventario(req: Request, res: Response): Promise<void> {
  const parsed = CrearInventarioSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  res.status(201).json(await crearInventario(parsed.data, req.user!.id));
}

// PUT /api/inventarios/:id/lineas — guarda avances del conteo.
export async function putLineas(req: Request, res: Response): Promise<void> {
  const parsed = GuardarLineasSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  res.status(200).json(await guardarLineas(idParam(req), parsed.data));
}

// POST /api/inventarios/:id/lineas — agrega un producto a la hoja.
export async function postLinea(req: Request, res: Response): Promise<void> {
  const parsed = AgregarLineaSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  res.status(200).json(await agregarLineaInventario(idParam(req), parsed.data.producto_3c));
}

// POST /api/inventarios/:id/confirmar — genera los AJUSTE y cierra la hoja.
export async function postConfirmar(req: Request, res: Response): Promise<void> {
  res.status(200).json(await confirmarInventario(idParam(req), req.user!.id));
}

// DELETE /api/inventarios/:id — descarta una hoja en BORRADOR.
export async function deleteInventario(req: Request, res: Response): Promise<void> {
  await eliminarInventario(idParam(req));
  res.status(204).end();
}
