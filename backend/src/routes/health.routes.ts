import { Router } from 'express';
import { healthController } from '../controllers/health.controller.js';

export const healthRouter = Router();

// GET /api/health — verifica conexión a DB.
healthRouter.get('/health', healthController);
