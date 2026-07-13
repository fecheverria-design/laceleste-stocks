import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos as productosT, tiposMovimiento, ubicaciones as ubicacionesT, usuarios } from './schema.js';
import {
  buscarUbicacionPorDep3c,
  EMAIL_USUARIO_INTEGRACION,
  generarNro,
  insertarCabecera,
  insertarDetalle,
  refrescarStock,
  resolverUsuarioIntegracion,
  tipoPorCodigo,
  type RenglonInput,
} from '../repositories/movimientos.repository.js';
import { anularMovimiento, registrarAbastecimiento } from '../services/movimientos.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Seed de DATOS DE DEMO para ver el front con algo realista. NO es el seed de
// producción (ese es seed.ts: solo catálogo + usuario de integración). Idempotente:
// no recrea ubicaciones/productos/movimientos si ya existen.
// ─────────────────────────────────────────────────────────────────────────────

const TIPOS = [
  { codigo: 'RECEPCION', nombre: 'Recepción de mercadería', signoStock: 1 },
  { codigo: 'RINT', nombre: 'Remito interno a área', signoStock: -1 },
  { codigo: 'AJUSTE', nombre: 'Ajuste de stock', signoStock: 0 },
  { codigo: 'INVENTARIO', nombre: 'Recuento de inventario', signoStock: 0 },
];

const DEPOSITO_DEP3C = 1;
const PANADERIA_DEP3C = 47;
const COCINA_DEP3C = 48;
const PROVEEDORES_DEP3C = 102; // balde virtual de proveedores (sin stock)

const UBICACIONES = [
  // El depósito lleva stock; áreas y proveedores no (modelo: stock solo en depósitos reales).
  { nombre: 'Depósito Central', tipo: 'DEPOSITO', depId3c: DEPOSITO_DEP3C, llevaStock: true },
  { nombre: 'Panadería', tipo: 'AREA', depId3c: PANADERIA_DEP3C },
  { nombre: 'Cocina', tipo: 'AREA', depId3c: COCINA_DEP3C },
  { nombre: 'Proveedores', tipo: 'AREA', depId3c: PROVEEDORES_DEP3C },
];

const PRODUCTOS = [
  { codigo3c: '401', nombre: 'Harina 000', unidadBase: 'KG' },
  { codigo3c: '402', nombre: 'Azúcar', unidadBase: 'KG' },
  { codigo3c: '405', nombre: 'Levadura fresca', unidadBase: 'KG' },
  { codigo3c: '410', nombre: 'Aceite de girasol', unidadBase: 'LT' },
];

async function contar(tabla: string): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.raw(tabla)}`);
  return res.rows[0]?.n ?? 0;
}

// RECEPCIÓN al depósito (mercadería que entra desde proveedores). El stock se suma
// al destino (depósito, que lleva stock); el origen (proveedores) no acumula.
async function recepcionAlDeposito(usuarioId: number, fecha: string, renglones: RenglonInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    const dep = await buscarUbicacionPorDep3c(tx, DEPOSITO_DEP3C);
    const prov = await buscarUbicacionPorDep3c(tx, PROVEEDORES_DEP3C);
    const tipo = await tipoPorCodigo(tx, 'RECEPCION');
    if (!dep || !prov || !tipo) throw new Error('Falta depósito/proveedores o tipo RECEPCION (corré db:migrate + db:seed)');
    const nro = await generarNro(tx, 'RECEPCION', 2026);
    const movId = await insertarCabecera(tx, {
      nro,
      tipoId: tipo.id,
      fecha,
      hora: '08:00:00',
      origenId: prov.id,
      destinoId: dep.id,
      usuarioId,
    });
    await insertarDetalle(tx, movId, renglones);
    await refrescarStock(tx);
  });
}

async function main(): Promise<void> {
  console.log('▶ Seed dev: catálogo base…');
  await db.insert(tiposMovimiento).values(TIPOS).onConflictDoNothing({ target: tiposMovimiento.codigo });
  await db
    .insert(usuarios)
    .values({ nombre: 'Integración (API)', email: EMAIL_USUARIO_INTEGRACION, passHash: 'x-sin-login', rol: 'SISTEMA' })
    .onConflictDoNothing({ target: usuarios.email });

  // Usuarios de login para DEV. Contraseña: "laceleste123" (solo demo, NO producción).
  console.log('▶ Seed dev: usuarios de login (admin / deposito, pass: laceleste123)…');
  const hash = await bcrypt.hash('laceleste123', 10);
  await db
    .insert(usuarios)
    .values([
      { nombre: 'Admin Dev', email: 'admin@laceleste.local', passHash: hash, rol: 'ADMIN' },
      { nombre: 'Depósito Dev', email: 'deposito@laceleste.local', passHash: hash, rol: 'DEPOSITO' },
    ])
    .onConflictDoNothing({ target: usuarios.email });

  if ((await contar('ubicaciones')) === 0) {
    console.log('▶ Seed dev: ubicaciones…');
    await db.insert(ubicacionesT).values(UBICACIONES);
  }
  if ((await contar('productos')) === 0) {
    console.log('▶ Seed dev: productos…');
    await db.insert(productosT).values(PRODUCTOS);
  }

  if ((await contar('movimientos')) > 0) {
    console.log('✔ Ya hay movimientos cargados, no se recrean. Seed dev listo.');
    await pool.end();
    return;
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) throw new Error('Falta el usuario de integración (corré db:seed)');

  console.log('▶ Seed dev: recepciones al depósito…');
  await recepcionAlDeposito(usuarioId, '2026-06-15', [
    { producto3c: '401', cantidadReal: '1000', unidad: 'KG' },
    { producto3c: '402', cantidadReal: '500', unidad: 'KG' },
    { producto3c: '405', cantidadReal: '40', unidad: 'KG' },
    { producto3c: '410', cantidadReal: '200', unidad: 'LT' },
  ]);
  await recepcionAlDeposito(usuarioId, '2026-06-16', [{ producto3c: '401', cantidadReal: '500', unidad: 'KG' }]);

  console.log('▶ Seed dev: abastecimientos (RINT) a áreas…');
  await registrarAbastecimiento(
    {
      destino_dep_id_3c: PANADERIA_DEP3C,
      origen_dep_id_3c: DEPOSITO_DEP3C,
      fecha: '2026-06-17',
      turno: 'MAÑANA',
      detalle: [
        { producto_3c: '401', cantidad_real: 150, cantidad_sugerida: 145, unidad: 'KG' },
        { producto_3c: '402', cantidad_real: 30, cantidad_sugerida: 30, unidad: 'KG' },
      ],
    },
    { usuarioId },
  );
  await registrarAbastecimiento(
    {
      destino_dep_id_3c: COCINA_DEP3C,
      origen_dep_id_3c: DEPOSITO_DEP3C,
      fecha: '2026-06-18',
      turno: 'MAÑANA',
      detalle: [
        { producto_3c: '405', cantidad_real: 5, cantidad_sugerida: 4, unidad: 'KG' },
        { producto_3c: '410', cantidad_real: 12, cantidad_sugerida: 10, unidad: 'LT' },
      ],
    },
    { usuarioId },
  );

  // Uno anulado, para ver el estado ANULADO y que NO impacte el stock.
  const anulable = await registrarAbastecimiento(
    {
      destino_dep_id_3c: PANADERIA_DEP3C,
      origen_dep_id_3c: DEPOSITO_DEP3C,
      fecha: '2026-06-18',
      turno: 'TARDE',
      detalle: [{ producto_3c: '401', cantidad_real: 80, unidad: 'KG' }],
    },
    { usuarioId },
  );
  await anularMovimiento(anulable.id, { usuarioId });

  console.log('✔ Seed dev completo: 3 ubicaciones, 4 productos, 5 movimientos (1 anulado).');
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error en seed dev:', err);
  process.exit(1);
});
