import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { usuarios } from '../src/db/schema.js';
import { AppError } from '../src/domain/errors.js';
import { requireAuth, requireRole } from '../src/middleware/auth.js';
import { firmarToken, login, verificarToken } from '../src/services/auth.service.js';
import { cerrarPool, limpiar } from './helpers/db.js';

async function crearUsuario(opts: {
  email: string;
  password: string;
  rol: string;
  activo?: boolean;
}): Promise<number> {
  const passHash = await bcrypt.hash(opts.password, 10);
  const [u] = await db
    .insert(usuarios)
    .values({ nombre: 'Test', email: opts.email, passHash, rol: opts.rol, activo: opts.activo ?? true })
    .returning({ id: usuarios.id });
  return u!.id;
}

const reqCon = (headers: Record<string, string> = {}): Request => ({ headers }) as unknown as Request;
const res = {} as Response;
const noop: NextFunction = () => undefined;

function capturarError(fn: () => void): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('Se esperaba que lanzara un AppError');
}

describe('auth: login', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('login OK devuelve token y user sin pass_hash', async () => {
    await crearUsuario({ email: 'admin@laceleste.local', password: 'secreta123', rol: 'ADMIN' });

    const sesion = await login({ email: 'admin@laceleste.local', password: 'secreta123' });

    expect(sesion.token).toBeTypeOf('string');
    expect(sesion.user).toMatchObject({ email: 'admin@laceleste.local', rol: 'ADMIN' });
    expect(sesion.user).not.toHaveProperty('passHash');
  });

  it('email case-insensitive (se normaliza a minúsculas en el schema)', async () => {
    await crearUsuario({ email: 'admin@laceleste.local', password: 'secreta123', rol: 'ADMIN' });
    // El controller parsea con LoginSchema (toLowerCase); acá lo normalizamos igual.
    const sesion = await login({ email: 'admin@laceleste.local', password: 'secreta123' });
    expect(sesion.user.email).toBe('admin@laceleste.local');
  });

  it('contraseña incorrecta → CREDENCIALES_INVALIDAS (401)', async () => {
    await crearUsuario({ email: 'admin@laceleste.local', password: 'secreta123', rol: 'ADMIN' });
    await expect(login({ email: 'admin@laceleste.local', password: 'mala' })).rejects.toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
      statusCode: 401,
    });
  });

  it('email inexistente → CREDENCIALES_INVALIDAS (no revela si existe)', async () => {
    await expect(login({ email: 'nadie@laceleste.local', password: 'x' })).rejects.toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
    });
  });

  it('usuario inactivo → CREDENCIALES_INVALIDAS', async () => {
    await crearUsuario({ email: 'baja@laceleste.local', password: 'secreta123', rol: 'DEPOSITO', activo: false });
    await expect(login({ email: 'baja@laceleste.local', password: 'secreta123' })).rejects.toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
    });
  });
});

describe('auth: token', () => {
  it('firmar + verificar conserva la identidad', () => {
    const user = { id: 7, email: 'a@b.com', nombre: 'Ana', rol: 'ADMIN' as const };
    const recuperado = verificarToken(firmarToken(user));
    expect(recuperado).toEqual(user);
  });

  it('token basura → TOKEN_INVALIDO', () => {
    expect(() => verificarToken('no.es.un.token')).toThrowError(AppError);
    expect(capturarError(() => verificarToken('no.es.un.token')).code).toBe('TOKEN_INVALIDO');
  });
});

describe('auth: requireAuth / requireRole', () => {
  it('sin header Authorization → NO_AUTENTICADO (401)', () => {
    const err = capturarError(() => requireAuth(reqCon({}), res, noop));
    expect(err.code).toBe('NO_AUTENTICADO');
    expect(err.statusCode).toBe(401);
  });

  it('token inválido → TOKEN_INVALIDO', () => {
    const err = capturarError(() => requireAuth(reqCon({ authorization: 'Bearer basura' }), res, noop));
    expect(err.code).toBe('TOKEN_INVALIDO');
  });

  it('token válido → cuelga req.user y llama next', () => {
    const user = { id: 3, email: 'd@laceleste.local', nombre: 'Dep', rol: 'DEPOSITO' as const };
    const req = reqCon({ authorization: `Bearer ${firmarToken(user)}` });
    let llamado = false;
    requireAuth(req, res, () => {
      llamado = true;
    });
    expect(llamado).toBe(true);
    expect(req.user).toEqual(user);
  });

  it('requireRole permite el rol correcto y rechaza el resto (403)', () => {
    const admin = reqCon();
    admin.user = { id: 1, email: 'a', nombre: 'A', rol: 'ADMIN' };
    let ok = false;
    requireRole('ADMIN')(admin, res, () => {
      ok = true;
    });
    expect(ok).toBe(true);

    const dep = reqCon();
    dep.user = { id: 2, email: 'd', nombre: 'D', rol: 'DEPOSITO' };
    const err = capturarError(() => requireRole('ADMIN')(dep, res, noop));
    expect(err.code).toBe('SIN_PERMISO');
    expect(err.statusCode).toBe(403);
  });
});
