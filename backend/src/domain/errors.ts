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
