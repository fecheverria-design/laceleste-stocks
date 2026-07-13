import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { LoginSchema } from '../domain/auth.schema.js';
import { login } from '../services/auth.service.js';

// POST /api/auth/login — valida credenciales y devuelve { token, user }.
export async function postLogin(req: Request, res: Response): Promise<void> {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const sesion = await login(parsed.data);
  res.status(200).json(sesion);
}

// GET /api/auth/me — devuelve la identidad del token (requiere requireAuth).
export function getMe(req: Request, res: Response): void {
  res.status(200).json(req.user);
}
