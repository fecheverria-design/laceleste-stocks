import express from 'express';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { notFound } from './middleware/notFound.js';

// Factory de la app Express. Separada del arranque del server para poder
// instanciarla en tests sin abrir un puerto.
export function createApp(): express.Express {
  const app = express();

  app.use(express.json());

  app.use('/api', apiRouter);

  // 404 + manejador de errores al final de la cadena.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
