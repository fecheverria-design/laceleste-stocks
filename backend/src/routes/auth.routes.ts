import { Router } from 'express';
import { getMe, getUsuarios, postLogin } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

// Login: público (es donde se obtiene el token).
authRouter.post('/auth/login', postLogin);

// Identidad actual: requiere token válido.
authRouter.get('/auth/me', requireAuth, getMe);

// Lista de usuarios (campos públicos) para selects; ej. filtro "quién cargó".
authRouter.get('/usuarios', requireAuth, getUsuarios);
