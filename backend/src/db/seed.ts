import { db, pool } from './client.js';
import { tiposMovimiento, usuarios } from './schema.js';
import { EMAIL_USUARIO_INTEGRACION } from '../repositories/movimientos.repository.js';

// Catálogo base de tipos de movimiento. Idempotente: ON CONFLICT por codigo.
// RECEPCION suma (+1), RINT resta (-1), AJUSTE/INVENTARIO 0 (el efecto en stock lo da la
// dirección contra el balde 101). INVENTARIO = recuento/carga de foto, separado del AJUSTE
// operativo (decisión de J, 2026-07-01).
const TIPOS = [
  { codigo: 'RECEPCION', nombre: 'Recepción de mercadería', signoStock: 1 },
  { codigo: 'RINT', nombre: 'Remito interno a área', signoStock: -1 },
  { codigo: 'AJUSTE', nombre: 'Ajuste de stock', signoStock: 0 },
  { codigo: 'INVENTARIO', nombre: 'Recuento de inventario', signoStock: 0 },
];

// Usuario de integración: dueño de los movimientos que entran por API mientras no
// haya auth JWT. No tiene login real (pass_hash placeholder). Se reemplaza por la
// identidad del token cuando exista el middleware auth.
const USUARIO_INTEGRACION = {
  nombre: 'Integración (API)',
  email: EMAIL_USUARIO_INTEGRACION,
  passHash: 'x-sin-login',
  rol: 'SISTEMA',
};

async function main(): Promise<void> {
  console.log('▶ Seed: tipos_movimiento…');
  await db.insert(tiposMovimiento).values(TIPOS).onConflictDoNothing({ target: tiposMovimiento.codigo });

  console.log('▶ Seed: usuario de integración…');
  await db.insert(usuarios).values(USUARIO_INTEGRACION).onConflictDoNothing({ target: usuarios.email });

  console.log(`✔ Seed completo (${TIPOS.length} tipos + usuario de integración).`);
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
