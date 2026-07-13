import { randomBytes } from 'node:crypto';
import { pool } from './client.js';
import { AppError } from '../domain/errors.js';
import {
  cambiarActivo,
  cambiarPassword,
  crearUsuario,
  listarUsuariosPublicos,
} from '../services/auth.service.js';

// ABM de usuarios por consola (no hay pantalla de usuarios en la app; decisión de J).
// La lógica vive en auth.service (hash bcrypt, validaciones); acá solo se parsean args.
//
//   npm run usuarios -- listar
//   npm run usuarios -- crear --nombre "Juan Perez" --email juan@laceleste.com.ar --rol ADMIN
//   npm run usuarios -- crear --nombre "Depósito" --email dep@laceleste.com.ar --rol DEPOSITO --pass "loquesea123"
//   npm run usuarios -- pass  --email juan@laceleste.com.ar --pass "nueva-contraseña"
//   npm run usuarios -- baja  --email juan@laceleste.com.ar     (no puede loguear más; NO se borra)
//   npm run usuarios -- alta  --email juan@laceleste.com.ar     (lo reactiva)
//
// Si en `crear` no pasás --pass, se genera una al azar y se imprime UNA sola vez.
// Roles: ADMIN (puede anular movimientos) | DEPOSITO (carga y consulta, no anula).

function flag(args: string[], nombre: string): string | undefined {
  const pref = `--${nombre}=`;
  const conIgual = args.find((a) => a.startsWith(pref));
  if (conIgual) return conIgual.slice(pref.length);
  // Forma separada: --email juan@... (la más cómoda de tipear)
  const i = args.indexOf(`--${nombre}`);
  const valor = i !== -1 ? args[i + 1] : undefined;
  return valor && !valor.startsWith('--') ? valor : undefined;
}

function requerir(args: string[], nombre: string): string {
  const v = flag(args, nombre);
  if (v === undefined || v.trim() === '') throw new Error(`Falta --${nombre}`);
  return v;
}

// Contraseña legible pero no adivinable, para el alta cuando no la eligen a mano.
function passwordAlAzar(): string {
  return randomBytes(9).toString('base64url'); // 12 caracteres
}

function imprimir(u: { id: number; nombre: string; email: string; rol: string; activo: boolean }): void {
  console.log(`  #${u.id}  ${u.nombre}  <${u.email}>  ${u.rol}  ${u.activo ? 'activo' : 'INACTIVO'}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const comando = args[0];

  switch (comando) {
    case 'listar': {
      const us = await listarUsuariosPublicos();
      console.log(`Usuarios (${us.length}):`);
      us.forEach(imprimir);
      break;
    }
    case 'crear': {
      const pass = flag(args, 'pass') ?? passwordAlAzar();
      const generada = flag(args, 'pass') === undefined;
      const u = await crearUsuario({
        nombre: requerir(args, 'nombre'),
        email: requerir(args, 'email'),
        rol: requerir(args, 'rol').toUpperCase(),
        password: pass,
      });
      console.log('✔ Usuario creado:');
      imprimir(u);
      if (generada) console.log(`\n  🔑 Contraseña generada: ${pass}\n  (anotala: no se muestra de nuevo)`);
      break;
    }
    case 'pass': {
      const u = await cambiarPassword(requerir(args, 'email'), requerir(args, 'pass'));
      console.log('✔ Contraseña cambiada:');
      imprimir(u);
      break;
    }
    case 'baja':
    case 'alta': {
      const u = await cambiarActivo(requerir(args, 'email'), comando === 'alta');
      console.log(comando === 'alta' ? '✔ Usuario reactivado:' : '✔ Usuario dado de baja (no puede loguear):');
      imprimir(u);
      break;
    }
    default:
      console.error(
        'Uso:\n' +
          '  npm run usuarios -- listar\n' +
          '  npm run usuarios -- crear --nombre "Juan Perez" --email juan@laceleste.com.ar --rol ADMIN|DEPOSITO [--pass ...]\n' +
          '  npm run usuarios -- pass  --email juan@laceleste.com.ar --pass "nueva"\n' +
          '  npm run usuarios -- baja  --email juan@laceleste.com.ar\n' +
          '  npm run usuarios -- alta  --email juan@laceleste.com.ar',
      );
      process.exitCode = 1;
  }
}

main()
  .catch((e: unknown) => {
    console.error(`✗ ${e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
