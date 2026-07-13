import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { badRequest, conflict, notFound, unauthorized } from '../domain/errors.js';
import { ROLES, type AuthUser, type LoginInput, type Rol, type SesionResult } from '../domain/auth.schema.js';
import {
  actualizarActivo,
  actualizarPassHash,
  buscarUsuarioPorEmail,
  insertarUsuario,
  listarUsuarios,
  type UsuarioConHash,
  type UsuarioPublico,
} from '../repositories/usuarios.repository.js';

// Costo del hash bcrypt. Mismo valor que usa el seed.
const BCRYPT_ROUNDS = 10;
const PASS_MINIMA = 8;

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

// ── Alta y mantenimiento de usuarios (hoy solo por consola: npm run usuarios) ────────
// El rol SISTEMA queda fuera a propósito: es el usuario de integración que crea el seed
// (no tiene login humano). A mano solo se dan de alta ADMIN y DEPOSITO.
const ROLES_HUMANOS = ['ADMIN', 'DEPOSITO'] as const;
export type RolHumano = (typeof ROLES_HUMANOS)[number];

export interface CrearUsuarioInput {
  nombre: string;
  email: string;
  password: string;
  rol: string;
}

function normalizarEmail(email: string): string {
  // El email se guarda y se consulta SIEMPRE en minúsculas (buscarUsuarioPorEmail no
  // hace lower()): si se guardara con mayúsculas, el login no lo encontraría nunca.
  return email.trim().toLowerCase();
}

function validarPassword(password: string): void {
  if (password.length < PASS_MINIMA) {
    throw badRequest('PASSWORD_CORTA', `La contraseña necesita al menos ${PASS_MINIMA} caracteres`);
  }
}

export async function crearUsuario(input: CrearUsuarioInput): Promise<UsuarioPublico> {
  const email = normalizarEmail(input.email);
  const nombre = input.nombre.trim();

  if (!(ROLES_HUMANOS as readonly string[]).includes(input.rol)) {
    throw badRequest('ROL_INVALIDO', `Rol inválido: ${input.rol}. Válidos: ${ROLES_HUMANOS.join(' | ')}`);
  }
  if (nombre === '') throw badRequest('NOMBRE_REQUERIDO', 'El nombre es obligatorio');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('EMAIL_INVALIDO', `Email inválido: ${input.email}`);
  }
  validarPassword(input.password);

  if (await buscarUsuarioPorEmail(email)) {
    throw conflict('EMAIL_EN_USO', `Ya existe un usuario con el email ${email}`);
  }

  const passHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return insertarUsuario({ nombre, email, passHash, rol: input.rol });
}

// Reset de contraseña (el usuario no la cambia solo: no hay pantalla de perfil todavía).
export async function cambiarPassword(email: string, password: string): Promise<UsuarioPublico> {
  validarPassword(password);
  const passHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const actualizado = await actualizarPassHash(normalizarEmail(email), passHash);
  if (!actualizado) throw notFound('USUARIO_NO_ENCONTRADO', `No existe un usuario con el email ${email}`);
  return actualizado;
}

// Baja lógica: el usuario deja de poder loguear (login rechaza inactivo) pero NO se borra,
// para que los movimientos que auditó sigan apuntando a alguien (regla #7).
export async function cambiarActivo(email: string, activo: boolean): Promise<UsuarioPublico> {
  const actualizado = await actualizarActivo(normalizarEmail(email), activo);
  if (!actualizado) throw notFound('USUARIO_NO_ENCONTRADO', `No existe un usuario con el email ${email}`);
  return actualizado;
}

export async function listarUsuariosPublicos(): Promise<UsuarioPublico[]> {
  return listarUsuarios();
}
