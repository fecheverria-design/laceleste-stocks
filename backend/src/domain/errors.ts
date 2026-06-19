// Errores tipados del dominio. Los services lanzan AppError; el middleware de
// errores los traduce a respuestas HTTP. Nunca exponer errores crudos al cliente.
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Helpers para los casos más comunes. Mantienen códigos estables para el cliente.
export const notFound = (code: string, message: string): AppError => new AppError(code, message, 404);
export const badRequest = (code: string, message: string): AppError => new AppError(code, message, 400);
export const conflict = (code: string, message: string): AppError => new AppError(code, message, 409);
