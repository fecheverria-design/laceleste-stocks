import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../domain/errors.js';
import { ROLES, type AuthUser, type LoginInput, type Rol, type SesionResult } from '../domain/auth.schema.js';
import { buscarUsuarioPorEmail, type UsuarioConHash } from '../repositories/usuarios.repository.js';

function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

function aAuthUser(u: UsuarioConHash): AuthUser {
  if (!esRol(u.rol)) {
    // Dato inconsistente en DB: rol fuera del catálogo. No es culpa del cliente.
    throw new Error(`Rol desconocido en usuario ${u.id}: ${u.rol}`);
  }
  return { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol };
}

// Firma un JWT con la identidad del usuario. expiresIn en segundos (env).
export function firmarToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, nombre: user.nombre, rol: user.rol }, env.JWT_SECRET, {
    subject: String(user.id),
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });
}

// Verifica un JWT y reconstruye el AuthUser. Lanza 401 si es inválido/expirado.
export function verificarToken(token: string): AuthUser {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw unauthorized('TOKEN_INVALIDO', 'Token inválido o expirado');
  }
  if (typeof payload === 'string' || payload.sub === undefined || !esRol(payload.rol)) {
    throw unauthorized('TOKEN_INVALIDO', 'Token mal formado');
  }
  return {
    id: Number(payload.sub),
    email: String(payload.email),
    nombre: String(payload.nombre),
    rol: payload.rol,
  };
}

// Login: valida credenciales contra el hash bcrypt y devuelve token + usuario.
// Mensaje genérico (no revela si el email existe) y se rechaza usuario inactivo.
export async function login(input: LoginInput): Promise<SesionResult> {
  const u = await buscarUsuarioPorEmail(input.email);
  const invalidas = () => unauthorized('CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos');

  if (!u || !u.activo) {
    // Igual corremos un compare dummy para no filtrar por tiempo si el email existe o no.
    await bcrypt.compare(input.password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    throw invalidas();
  }

  const ok = await bcrypt.compare(input.password, u.passHash);
  if (!ok) throw invalidas();

  const user = aAuthUser(u);
  return { token: firmarToken(user), user };
}
