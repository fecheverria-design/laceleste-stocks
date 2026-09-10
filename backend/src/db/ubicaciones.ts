import { asc, eq, sql } from 'drizzle-orm';
import { db, pool } from './client.js';
import { ubicaciones } from './schema.js';

// ABM de ubicaciones (depósitos/áreas) por consola.
//
// POR QUÉ EXISTE: `import:ubicaciones` trae el listado de 3c desde un export, pero en 3c
// **no hay vista de depósitos** (las únicas son de artículos, precios, stock, proveedores y
// movimientos). Cuando La Celeste abre un acopio nuevo en un proveedor, el depósito aparece
// recién como origen/destino de un movimiento, y hasta que no esté dado de alta acá ese
// movimiento no se puede materializar. Esto pasó con el 225 (GRUPO PACK) y va a volver a
// pasar, así que el alta es un comando y no un INSERT a mano en producción.
//
//   npm run ubicaciones -- listar
//   npm run ubicaciones -- listar --desde 200          (solo la serie de acopios)
//   npm run ubicaciones -- alta --dep 225 --nombre "GRUPO PACK S.R.L" --tipo DEPOSITO --stock
//   npm run ubicaciones -- alta --dep 51 --nombre "LOCALES" --tipo AREA
//
// Es idempotente por `dep_id_3c` (regla #1: el id de 3c manda): repetir el alta actualiza
// nombre/tipo/stock en vez de duplicar. `--stock` marca que el depósito lleva stock propio;
// las áreas nunca lo llevan (consumen, no almacenan).

const TIPOS = ['DEPOSITO', 'AREA', 'SUCURSAL'];

function flag(args: string[], nombre: string): string | undefined {
  const pref = `--${nombre}=`;
  const conIgual = args.find((a) => a.startsWith(pref));
  if (conIgual) return conIgual.slice(pref.length);
  const i = args.indexOf(`--${nombre}`);
  const valor = i !== -1 ? args[i + 1] : undefined;
  return valor && !valor.startsWith('--') ? valor : undefined;
}

function requerir(args: string[], nombre: string): string {
  const v = flag(args, nombre);
  if (v === undefined || v.trim() === '') throw new Error(`Falta --${nombre}`);
  return v;
}

function imprimir(u: { id: number; nombre: string; tipo: string; dep_id_3c: number; lleva_stock: boolean; activo: boolean }): void {
  console.log(
    `  ${String(u.dep_id_3c).padStart(4)}  ${u.nombre.padEnd(30)} ${u.tipo.padEnd(9)}` +
      `${u.lleva_stock ? 'lleva stock' : '           '}  ${u.activo ? '' : 'INACTIVA'}`,
  );
}

const seleccion = {
  id: ubicaciones.id,
  nombre: ubicaciones.nombre,
  tipo: ubicaciones.tipo,
  dep_id_3c: ubicaciones.depId3c,
  lleva_stock: ubicaciones.llevaStock,
  activo: ubicaciones.activo,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const comando = args[0];

  switch (comando) {
    case 'listar': {
      const desde = Number(flag(args, 'desde') ?? 0);
      const filas = await db
        .select(seleccion)
        .from(ubicaciones)
        .where(sql`${ubicaciones.depId3c} >= ${desde}`)
        .orderBy(asc(ubicaciones.depId3c));
      console.log(`Ubicaciones (${filas.length})${desde > 0 ? ` con dep_id_3c >= ${desde}` : ''}:`);
      filas.forEach(imprimir);
      break;
    }
    case 'alta': {
      const depId3c = Number(requerir(args, 'dep'));
      if (!Number.isInteger(depId3c) || depId3c <= 0) throw new Error('--dep tiene que ser el dep_id_3c (entero > 0)');
      const tipo = (flag(args, 'tipo') ?? 'DEPOSITO').toUpperCase();
      if (!TIPOS.includes(tipo)) throw new Error(`--tipo tiene que ser uno de: ${TIPOS.join(', ')}`);
      // Un área no almacena, consume: aunque se pase --stock, no lleva stock propio.
      const llevaStock = args.includes('--stock') && tipo !== 'AREA';

      const [previa] = await db.select(seleccion).from(ubicaciones).where(eq(ubicaciones.depId3c, depId3c));
      const [fila] = await db
        .insert(ubicaciones)
        .values({ nombre: requerir(args, 'nombre').slice(0, 100), tipo, depId3c, llevaStock })
        .onConflictDoUpdate({
          target: ubicaciones.depId3c,
          set: { nombre: sql`excluded.nombre`, tipo: sql`excluded.tipo`, llevaStock: sql`excluded.lleva_stock` },
        })
        .returning(seleccion);

      console.log(previa ? '✔ Ubicación actualizada (ya existía ese dep_id_3c):' : '✔ Ubicación creada:');
      imprimir(fila!);
      break;
    }
    default:
      console.log('Comandos: listar [--desde N] | alta --dep N --nombre "..." [--tipo DEPOSITO|AREA|SUCURSAL] [--stock]');
      process.exitCode = 1;
  }

  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
