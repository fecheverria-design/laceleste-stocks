import type { Request, Response } from 'express';
import { obtenerProductos, obtenerTipos, obtenerUbicaciones } from '../services/catalogos.service.js';

export async function getUbicaciones(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerUbicaciones());
}

export async function getProductos(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerProductos());
}

export async function getTipos(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerTipos());
}
