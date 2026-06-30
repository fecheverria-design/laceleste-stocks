import { z } from 'zod';

// Roles v1 (CLAUDE.md). SISTEMA es el usuario de integración (M2M, sin login humano).
export const ROLES = ['ADMIN', 'DEPOSITO', 'SISTEMA'] as const;
export type Rol = (typeof ROLES)[number];

// Schema de login (regla #8: mismo schema back/front).
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Identidad autenticada que viaja en el token y se expone en req.user.
export interface AuthUser {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
}

// Lo que se devuelve al loguear: token + datos del usuario (sin pass_hash).
export interface SesionResult {
  token: string;
  user: AuthUser;
}
