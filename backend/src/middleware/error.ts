import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../domain/errors.js';

// Middleware de errores (4 args — Express lo reconoce por la firma).
// Traduce AppError a HTTP; cualquier otra cosa es un 500 sin filtrar detalles.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  console.error('Error no controlado:', err);
  res.status(500).json({ error: 'INTERNAL', message: 'Error interno del servidor' });
}
