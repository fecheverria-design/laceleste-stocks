import { Router } from 'express';
import { getMe, postLogin } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// Login: público (es donde se obtiene el token).
authRouter.post('/auth/login', postLogin);

// Identidad actual: requiere token válido.
authRouter.get('/auth/me', requireAuth, getMe);
