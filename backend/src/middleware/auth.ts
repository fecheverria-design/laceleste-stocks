import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppError, forbidden, unauthorized } from '../domain/errors.js';
import type { AuthUser, Rol } from '../domain/auth.schema.js';
import { verificarToken } from '../services/auth.service.js';
import { env } from '../config/env.js';

// Adjunta la identidad autenticada al request. Express 5 reenvía los throws sync
// al errorHandler, así que lanzar AppError acá se traduce a la respuesta HTTP.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Exige un Bearer válido; cuelga req.user. 401 si falta o es inválido/expirado.
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('NO_AUTENTICADO', 'Falta el token Bearer en Authorization');
  }
  const token = header.slice('Bearer '.length).trim();
  req.user = verificarToken(token);
  next();
}

// Comparación de strings en tiempo constante (evita timing attacks sobre la API key).
function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Exige la API key M2M en el header `x-api-key`. Para endpoints máquina-a-máquina
// (app del compañero). 503 si el server no tiene M2M_API_KEY configurada (endpoint
// cerrado por seguridad); 401 si falta o no coincide.
export function requireApiKey(req: Request, _res: Response, next: NextFunction): void {
  const esperado = env.M2M_API_KEY;
  if (!esperado) {
    throw new AppError('M2M_NO_CONFIGURADO', 'Endpoint M2M deshabilitado: falta configurar M2M_API_KEY', 503);
  }
  const recibido = req.headers['x-api-key'];
  if (typeof recibido !== 'string' || !igualSeguro(recibido, esperado)) {
    throw unauthorized('API_KEY_INVALIDA', 'Falta o es inválida la API key (header x-api-key)');
  }
  next();
}

// Exige que el usuario autenticado tenga uno de los roles dados. 403 si no.
// Usar SIEMPRE después de requireAuth.
export function requireRole(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized('NO_AUTENTICADO', 'Falta autenticación');
    if (!roles.includes(req.user.rol)) {
      throw forbidden('SIN_PERMISO', `Acción restringida al rol: ${roles.join(' o ')}`);
    }
    next();
  };
}
