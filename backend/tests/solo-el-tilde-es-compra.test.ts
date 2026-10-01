import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { proveedores } from '../src/db/schema.js';
import { sembrarTemporales, soloElTildeEsCompra, type FilaPrecio } from '../src/db/import-precios.js';
import { insertarPrecio } from '../src/repositories/precios.repository.js';
import { cerrarPool, limpiar, sembrarEscenario } from './helpers/db.js';

// La regla de J (2026-09-10): la ÚNICA compra es la que él tildó en la planilla. Todo lo que
// venía del histórico de 3c como "compra" es, a lo sumo, referencia.
//
// Por qué se testea: es una operación masiva y destructiva (degrada miles de filas) y lo que
// la disparó fue una compra que nunca existió —BOLSA SULFITO Nº6 a $41.507,80 contra $49,98
// el resto del año, un bulto cargado como unidad— que se colaba en el gráfico, en la alerta
// de saltos y en la prelación. Si esto degrada de más, se pierde el precio real; si degrada
// de menos, vuelve la mentira.

const fila = (over: Partial<FilaPrecio> = {}): FilaPrecio => ({
  producto3c: '401',
  nombre: 'QUESO',
  proveedorNum: 100,
  proveedorNombre: 'FUENTES',
  precio: 1000,
  tipo: 'COMPRA',
  vigenteDesde: '2026-01-05',
  ...over,
});

const tipos = async (producto3c: string): Promise<Array<{ precio: string; tipo: string; fecha: string }>> => {
  const res = await db.execute<{ precio: string; tipo: string; fecha: string }>(
    sql`SELECT precio, tipo, vigente_desde::text AS fecha FROM precios WHERE producto_3c = ${producto3c} ORDER BY vigente_desde, id`,
  );
  return res.rows;
};

describe('solo el tilde es COMPRA', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('degrada las compras que el archivo no tildó y deja intactas las tildadas', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const [prov] = await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' }).returning({ id: proveedores.id });
    // La tildada, y una "compra" del histórico de 3c que nunca existió (bulto como unidad).
    await insertarPrecio({ producto3c: '401', proveedorId: prov!.id, precio: 1000, tipo: 'COMPRA', vigenteDesde: '2026-01-05', usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', proveedorId: prov!.id, precio: 41507.8, tipo: 'COMPRA', vigenteDesde: '2025-11-12', usuarioId: fx.usuarioId });

    await sembrarTemporales([fila()], new Map([[100, prov!.id]]));
    const { degradadas } = await soloElTildeEsCompra();

    expect(degradadas).toBe(1);
    expect(await tipos('401')).toEqual([
      { precio: '41507.8000', tipo: 'ACTUALIZACION', fecha: '2025-11-12' },
      { precio: '1000.0000', tipo: 'COMPRA', fecha: '2026-01-05' },
    ]);
  });

  it('no borra nada: la compra degradada sigue estando como referencia', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    await insertarPrecio({ producto3c: '401', precio: 500, tipo: 'COMPRA', vigenteDesde: '2025-06-01', usuarioId: fx.usuarioId });

    await sembrarTemporales([], new Map());
    await soloElTildeEsCompra();

    expect(await tipos('401')).toEqual([{ precio: '500.0000', tipo: 'ACTUALIZACION', fecha: '2025-06-01' }]);
  });

  it('alcanza a los productos que NO están en el archivo (la regla es global)', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401', '402'] });
    await insertarPrecio({ producto3c: '401', precio: 1000, tipo: 'COMPRA', vigenteDesde: '2026-01-05', usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '402', precio: 700, tipo: 'COMPRA', vigenteDesde: '2026-01-05', usuarioId: fx.usuarioId });

    // El archivo solo habla del 401.
    await sembrarTemporales([fila({ proveedorNum: 0 })], new Map());
    await soloElTildeEsCompra();

    expect((await tipos('401'))[0]?.tipo).toBe('COMPRA'); // tildada (sin proveedor, como en la DB)
    expect((await tipos('402'))[0]?.tipo).toBe('ACTUALIZACION');
  });

  it('cuando la degradación chocaría con una actualización de la misma clave, gana el importe pagado', async () => {
    const fx = await sembrarEscenario({ productos3c: ['401'] });
    const [prov] = await db.insert(proveedores).values({ numero3c: 100, nombre: 'FUENTES' }).returning({ id: proveedores.id });
    // Mismo producto, proveedor y fecha: una compra (lo que se pagó) y una lista.
    await insertarPrecio({ producto3c: '401', proveedorId: prov!.id, precio: 980, tipo: 'COMPRA', vigenteDesde: '2025-06-01', usuarioId: fx.usuarioId });
    await insertarPrecio({ producto3c: '401', proveedorId: prov!.id, precio: 1200, tipo: 'ACTUALIZACION', vigenteDesde: '2025-06-01', usuarioId: fx.usuarioId });

    await sembrarTemporales([], new Map());
    const { degradadas, duplicadasBorradas } = await soloElTildeEsCompra();

    expect({ degradadas, duplicadasBorradas }).toEqual({ degradadas: 1, duplicadasBorradas: 1 });
    // Queda una sola fila y es la del importe pagado, no la del precio de lista.
    expect(await tipos('401')).toEqual([{ precio: '980.0000', tipo: 'ACTUALIZACION', fecha: '2025-06-01' }]);
  });
});
