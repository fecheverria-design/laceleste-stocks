import { sql } from 'drizzle-orm';
import { db, pool } from '../../src/db/client.js';
import { productos, ubicaciones, usuarios } from '../../src/db/schema.js';

// Limpia las tablas de negocio entre tests (tipos_movimiento se conserva: es catálogo).
// RESTART IDENTITY deja los serial en 1 para ids predecibles; CASCADE respeta las FKs.
export async function limpiar(): Promise<void> {
  await db.execute(
    sql`TRUNCATE compras, precios, proveedores, movimientos_detalle, movimientos, productos, ubicaciones, usuarios RESTART IDENTITY CASCADE`,
  );
  await db.execute(sql`REFRESH MATERIALIZED VIEW stock_actual`);
}

export async function cerrarPool(): Promise<void> {
  await pool.end();
}

export interface Fixtures {
  usuarioId: number;
  deposito: { id: number; depId3c: number };
  area: { id: number; depId3c: number };
}

// Un usuario extra. Sirve para distinguir a una PERSONA del usuario con el que corre el sync:
// el sync revive sus propias bajas, pero una anulación humana no se resucita nunca (regla #4).
export async function sembrarUsuario(email: string, nombre = 'Admin Humano'): Promise<number> {
  const [u] = await db
    .insert(usuarios)
    .values({ nombre, email, passHash: 'x', rol: 'ADMIN' })
    .returning({ id: usuarios.id });
  if (!u) throw new Error('No se pudo sembrar el usuario');
  return u.id;
}

// Escenario base: un usuario, un depósito (origen) y un área (destino), más los
// productos pedidos. Devuelve ids/códigos para armar los casos.
export async function sembrarEscenario(opts: {
  depositoDep3c?: number;
  areaDep3c?: number;
  productos3c?: string[];
}): Promise<Fixtures> {
  const depositoDep3c = opts.depositoDep3c ?? 1;
  const areaDep3c = opts.areaDep3c ?? 47;

  const [usuario] = await db
    .insert(usuarios)
    .values({ nombre: 'Tester', email: 'tester@laceleste.local', passHash: 'x', rol: 'ADMIN' })
    .returning({ id: usuarios.id });

  // El depósito lleva stock; el área no (modelo: stock solo en depósitos reales).
  const [deposito] = await db
    .insert(ubicaciones)
    .values({ nombre: 'Depósito Central', tipo: 'DEPOSITO', depId3c: depositoDep3c, llevaStock: true })
    .returning({ id: ubicaciones.id });

  const [area] = await db
    .insert(ubicaciones)
    .values({ nombre: 'Panadería', tipo: 'AREA', depId3c: areaDep3c, llevaStock: false })
    .returning({ id: ubicaciones.id });

  if (!usuario || !deposito || !area) throw new Error('No se pudo sembrar el escenario de test');

  const codigos = opts.productos3c ?? [];
  if (codigos.length > 0) {
    await db
      .insert(productos)
      .values(codigos.map((c) => ({ codigo3c: c, nombre: `Producto ${c}`, unidadBase: 'KG' })));
  }

  return {
    usuarioId: usuario.id,
    deposito: { id: deposito.id, depId3c: depositoDep3c },
    area: { id: area.id, depId3c: areaDep3c },
  };
}
