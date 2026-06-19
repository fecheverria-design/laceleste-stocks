import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../domain/errors.js';
import type { AuthUser, Rol } from '../domain/auth.schema.js';
import { verificarToken } from '../services/auth.service.js';

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
