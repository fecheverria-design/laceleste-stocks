import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/domain/errors.js';
import {
  cambiarActivo,
  cambiarPassword,
  crearUsuario,
  listarUsuariosPublicos,
  login,
} from '../src/services/auth.service.js';
import { cerrarPool, limpiar } from './helpers/db.js';

// Alta y mantenimiento de usuarios (hoy por consola: npm run usuarios).
// Lo que importa acá es que el usuario creado PUEDA LOGUEAR de verdad: si el hash o la
// normalización del email fallan, el alta "funciona" pero la persona no entra nunca.

const ALTA = {
  nombre: 'Juan Perez',
  email: 'juan@laceleste.com.ar',
  password: 'unaClaveLarga1',
  rol: 'ADMIN',
};

describe('usuarios (alta por consola)', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('crea el usuario y puede loguear con esa contraseña', async () => {
    const u = await crearUsuario(ALTA);
    expect(u).toMatchObject({ nombre: 'Juan Perez', email: 'juan@laceleste.com.ar', rol: 'ADMIN', activo: true });

    const sesion = await login({ email: ALTA.email, password: ALTA.password });
    expect(sesion.user.id).toBe(u.id);
    expect(sesion.user.rol).toBe('ADMIN');
    expect(sesion.token).toBeTruthy();
  });

  it('el email se guarda en minúsculas (si no, el login nunca lo encontraría)', async () => {
    const u = await crearUsuario({ ...ALTA, email: '  Juan@LaCeleste.com.AR  ' });
    expect(u.email).toBe('juan@laceleste.com.ar');

    // Y se puede loguear escribiéndolo con mayúsculas (el schema de login lo baja también).
    const sesion = await login({ email: 'juan@laceleste.com.ar', password: ALTA.password });
    expect(sesion.user.email).toBe('juan@laceleste.com.ar');
  });

  it('no permite email repetido', async () => {
    await crearUsuario(ALTA);
    await expect(crearUsuario({ ...ALTA, nombre: 'Otro' })).rejects.toMatchObject({ code: 'EMAIL_EN_USO' });
  });

  it('rechaza rol fuera del catálogo y SISTEMA (que es el de integración)', async () => {
    await expect(crearUsuario({ ...ALTA, rol: 'GERENTE' })).rejects.toMatchObject({ code: 'ROL_INVALIDO' });
    await expect(crearUsuario({ ...ALTA, rol: 'SISTEMA' })).rejects.toMatchObject({ code: 'ROL_INVALIDO' });
  });

  it('rechaza contraseñas cortas', async () => {
    await expect(crearUsuario({ ...ALTA, password: 'corta' })).rejects.toBeInstanceOf(AppError);
  });

  it('cambiar contraseña: la vieja deja de servir y la nueva entra', async () => {
    await crearUsuario(ALTA);
    await cambiarPassword(ALTA.email, 'otraClaveLarga2');

    await expect(login({ email: ALTA.email, password: ALTA.password })).rejects.toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
    });
    await expect(login({ email: ALTA.email, password: 'otraClaveLarga2' })).resolves.toBeTruthy();
  });

  it('baja: no puede loguear más, pero el usuario NO se borra (los movimientos lo auditan)', async () => {
    const u = await crearUsuario(ALTA);
    await cambiarActivo(ALTA.email, false);

    await expect(login({ email: ALTA.email, password: ALTA.password })).rejects.toMatchObject({
      code: 'CREDENCIALES_INVALIDAS',
    });
    expect(await listarUsuariosPublicos()).toContainEqual(expect.objectContaining({ id: u.id, activo: false }));

    // Y se puede reactivar.
    await cambiarActivo(ALTA.email, true);
    await expect(login({ email: ALTA.email, password: ALTA.password })).resolves.toBeTruthy();
  });

  it('cambiar contraseña / baja de un email inexistente: error claro', async () => {
    await expect(cambiarPassword('nadie@laceleste.com.ar', 'unaClaveLarga1')).rejects.toMatchObject({
      code: 'USUARIO_NO_ENCONTRADO',
    });
    await expect(cambiarActivo('nadie@laceleste.com.ar', false)).rejects.toMatchObject({
      code: 'USUARIO_NO_ENCONTRADO',
    });
  });
});
