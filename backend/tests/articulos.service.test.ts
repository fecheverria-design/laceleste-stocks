import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { productos } from '../src/db/schema.js';
import { AppError } from '../src/domain/errors.js';
import {
  crearArticulo,
  editarArticulo,
  obtenerArticulos,
} from '../src/services/articulos.service.js';
import { cerrarPool, limpiar } from './helpers/db.js';

// Alta/edición del maestro de artículos. El código de un artículo NUEVO se genera
// continuando la numeración (max(codigo_3c numérico)+1) y queda marcado creado_local.

async function sembrarProductos(items: { codigo3c: string; nombre: string; familia?: string }[]): Promise<void> {
  await db.insert(productos).values(
    items.map((p) => ({ codigo3c: p.codigo3c, nombre: p.nombre, unidadBase: 'KG', familia: p.familia ?? null })),
  );
}

describe('articulos: alta con código propio + edición', () => {
  beforeEach(limpiar);
  afterAll(cerrarPool);

  it('genera el código continuando el máximo existente y marca creado_local', async () => {
    await sembrarProductos([
      { codigo3c: '10', nombre: 'Harina' },
      { codigo3c: '1185', nombre: 'Sal' },
      { codigo3c: '7', nombre: 'Azúcar' },
    ]);

    const nuevo = await crearArticulo({ nombre: 'Producto local', unidad_base: 'UN', familia: 'PACKAGING', subfamilia: null });

    expect(nuevo.codigo_3c).toBe('1186'); // 1185 + 1
    expect(nuevo.creado_local).toBe(true);
    expect(nuevo.familia).toBe('PACKAGING');
    expect(nuevo.nombre).toBe('Producto local');
  });

  it('el primer artículo (tabla vacía) arranca en 1', async () => {
    const nuevo = await crearArticulo({ nombre: 'Primero', unidad_base: 'UN', familia: null, subfamilia: null });
    expect(nuevo.codigo_3c).toBe('1');
  });

  it('ignora códigos no numéricos al calcular el próximo', async () => {
    await sembrarProductos([
      { codigo3c: '50', nombre: 'Con num' },
      { codigo3c: 'L-ABC', nombre: 'Raro no numérico' },
    ]);
    const nuevo = await crearArticulo({ nombre: 'Sigue', unidad_base: 'UN', familia: null, subfamilia: null });
    expect(nuevo.codigo_3c).toBe('51');
  });

  it('concurrencia: dos altas simultáneas → códigos distintos (sin colisión)', async () => {
    await sembrarProductos([{ codigo3c: '100', nombre: 'Base' }]);

    const [a, b] = await Promise.all([
      crearArticulo({ nombre: 'A', unidad_base: 'UN', familia: null, subfamilia: null }),
      crearArticulo({ nombre: 'B', unidad_base: 'UN', familia: null, subfamilia: null }),
    ]);

    expect(a.codigo_3c).not.toBe(b.codigo_3c);
    expect(new Set([a.codigo_3c, b.codigo_3c])).toEqual(new Set(['101', '102']));
  });

  it('editar cambia nombre/familia/unidad y hace baja lógica', async () => {
    await sembrarProductos([{ codigo3c: '5', nombre: 'Viejo', familia: 'LIMPIEZA' }]);

    const editado = await editarArticulo('5', {
      nombre: 'Nuevo nombre',
      unidad_base: 'LT',
      familia: 'DESCARTABLES',
      subfamilia: 'VASOS',
      activo: false,
    });

    expect(editado.nombre).toBe('Nuevo nombre');
    expect(editado.unidad_base).toBe('LT');
    expect(editado.familia).toBe('DESCARTABLES');
    expect(editado.subfamilia).toBe('VASOS');
    expect(editado.activo).toBe(false);
  });

  it('editar un artículo inexistente tira 404', async () => {
    await expect(
      editarArticulo('999999', { nombre: 'X', unidad_base: 'UN', familia: null, subfamilia: null }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('el listado filtra por familia y por texto (código o nombre)', async () => {
    await sembrarProductos([
      { codigo3c: '201', nombre: 'Bolsa kraft', familia: 'PACKAGING' },
      { codigo3c: '202', nombre: 'Detergente', familia: 'LIMPIEZA' },
      { codigo3c: '203', nombre: 'Bolsa cristal', familia: 'PACKAGING' },
    ]);

    const packaging = await obtenerArticulos({ page: 1, limit: 100, familia: 'PACKAGING' });
    expect(packaging.total).toBe(2);
    expect(packaging.items.every((a) => a.familia === 'PACKAGING')).toBe(true);

    const bolsas = await obtenerArticulos({ page: 1, limit: 100, q: 'bolsa' });
    expect(bolsas.total).toBe(2);

    const porCodigo = await obtenerArticulos({ page: 1, limit: 100, q: '202' });
    expect(porCodigo.total).toBe(1);
    expect(porCodigo.items[0]!.nombre).toBe('Detergente');
  });
});
