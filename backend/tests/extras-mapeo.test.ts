import { describe, expect, it } from 'vitest';
import {
  AREAS_3C,
  agruparExtras,
  armarCatalogo,
  fechaHoraLocal,
  fechasDeFilas,
  normalizarArea,
  type FilaExtra,
} from '../src/db/extras-mapeo.js';

// Abastecimientos EXTRAS: los egresos que el encargado de depósito despacha por fuera del
// abastecimiento diario y carga de a uno en la app del compañero (ver sync-extras.ts).
// Acá se testea la lógica pura: mapeo de áreas, fecha_hora y agrupación por (fecha, área).

const VENTANA = new Set(['2026-07-29', '2026-07-30']);

// Catálogo como el que arma sync-extras con la tabla integral (articulo_id → codigo_3c).
// Los ids son reales: su app numera la fila del catálogo, no el producto.
const CATALOGO = armarCatalogo([
  { id: 470470, codigo_3c: '470' }, // MARGARINA MTK HOJALDRE (catálogo de PANADERIA)
  { id: 470428, codigo_3c: '428' },
  { id: 430517, codigo_3c: '517' },
  { id: 490430, codigo_3c: '430' }, // HARINA 0000 (catálogo de RECETAS)
]);

// Fila mínima del origen; cada test pisa lo que le importa.
function fila(over: Partial<FilaExtra> = {}): FilaExtra {
  return {
    id: 1,
    fecha_hora: '2026-07-30T15:42:00',
    articulo_id: 470470,
    articulo_nombre: 'MARGARINA MTK HOJALDRE',
    area: 'PANADERIA',
    codigo_area: 47,
    cantidad: 10,
    unidad: 'KILOGRAMOS',
    nota: null,
    usuario: null,
    ...over,
  };
}

describe('normalizarArea + AREAS_3C: los ids son de 3c (regla #1)', () => {
  it('mapea las áreas de su front a los dep_id_3c verificados contra el export de 3c', () => {
    expect(AREAS_3C[normalizarArea('PANADERIA')]).toBe(47);
    expect(AREAS_3C[normalizarArea('PASTELERÍA')]).toBe(48); // con tilde, como lo escribe su app
    expect(AREAS_3C[normalizarArea('recetas')]).toBe(49);
    expect(AREAS_3C[normalizarArea('LOCALES')]).toBe(43);
    expect(AREAS_3C[normalizarArea('ADM/CADETERIA/DUEÑOS')]).toBe(40); // con eñe
  });

  it('un área que no conocemos NO se adivina: queda undefined', () => {
    expect(AREAS_3C[normalizarArea('AREA NUEVA QUE INVENTARON')]).toBeUndefined();
  });
});

describe('fechaHoraLocal', () => {
  it('toma la fecha y hora tal cual cuando vienen sin zona (datetime-local de su front)', () => {
    expect(fechaHoraLocal('2026-07-30T15:42:00')).toEqual({ fecha: '2026-07-30', hora: '15:42' });
    expect(fechaHoraLocal('2026-07-30 08:05:00')).toEqual({ fecha: '2026-07-30', hora: '08:05' });
  });

  it('un timestamp UTC de la noche NO se corre al día siguiente (se convierte a Buenos Aires)', () => {
    // 2026-07-31T01:00:00Z = 30/07 22:00 en Argentina. Sin la conversión, el RINT quedaría
    // con fecha 31 y el extra aparecería en el día equivocado.
    expect(fechaHoraLocal('2026-07-31T01:00:00Z')).toEqual({ fecha: '2026-07-30', hora: '22:00' });
  });

  it('devuelve null si no hay ni siquiera una fecha reconocible', () => {
    expect(fechaHoraLocal('cualquier cosa')).toBeNull();
  });
});

describe('catálogo articulo_id → codigo_3c (su API no manda el código)', () => {
  it('resuelve el producto por el catálogo de la tabla integral', () => {
    const { grupos, descartes } = agruparExtras([fila({ articulo_id: 490430, area: 'RECETAS', codigo_area: 49 })], VENTANA, CATALOGO);
    expect(grupos[0]!.detalle[0]!.producto_3c).toBe('430');
    expect(descartes.sinProducto).toBe(0);
  });

  it('NO deriva el código de la numeración: un articulo_id que no está en el catálogo se descarta y se reporta', () => {
    const { grupos, descartes } = agruparExtras(
      [fila({ articulo_id: 999123, articulo_nombre: 'PRODUCTO NUEVO' })],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(0);
    expect(descartes.sinProducto).toBe(1);
    expect([...descartes.articulosSinCatalogo]).toEqual(['999123 PRODUCTO NUEVO']);
  });

  it('si algún día su API manda codigo_3c, ese gana sobre el catálogo', () => {
    const { grupos } = agruparExtras([fila({ articulo_id: 470470, codigo_3c: '999' })], VENTANA, CATALOGO);
    expect(grupos[0]!.detalle[0]!.producto_3c).toBe('999');
  });

  it('el catálogo se acumula entre días y descarta filas sin id o sin código', () => {
    const cat = armarCatalogo([{ id: 1, codigo_3c: '10' }]);
    armarCatalogo([{ id: 2, codigo_3c: '20' }, { id: null, codigo_3c: '30' }, { id: 3, codigo_3c: null }], cat);
    expect([...cat.entries()]).toEqual([
      [1, '10'],
      [2, '20'],
    ]);
  });
});

describe('fechasDeFilas', () => {
  it('devuelve los días (en Buenos Aires) que tienen extras dentro de la ventana', () => {
    expect(
      fechasDeFilas(
        [
          fila({ fecha_hora: '2026-07-30T15:42:00' }),
          fila({ fecha_hora: '2026-07-30T18:00:00' }),
          fila({ fecha_hora: '2026-07-29T10:00:00' }),
          fila({ fecha_hora: '2026-06-01T10:00:00' }), // fuera de la ventana
          fila({ fecha_hora: null }),
        ],
        VENTANA,
      ),
    ).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('sin extras no hay días que consultar (no se sale a pedir el catálogo)', () => {
    expect(fechasDeFilas([], VENTANA)).toEqual([]);
  });
});

describe('agruparExtras', () => {
  it('junta los extras del día por área en un solo movimiento (decisión de J 2026-07-30)', () => {
    const { grupos } = agruparExtras(
      [
        fila({ articulo_id: 470470, cantidad: 10 }),
        fila({ articulo_id: 470428, cantidad: 25 }),
        fila({ area: 'LOCALES', codigo_area: 43, articulo_id: 430517, cantidad: 1000 }),
      ],
      VENTANA,
      CATALOGO,
    );

    expect(grupos).toHaveLength(2);
    const pan = grupos.find((g) => g.destino_dep_id_3c === 47)!;
    expect(pan.fecha).toBe('2026-07-30');
    expect(pan.detalle).toHaveLength(2);
    // Orden estable por producto: si no, el diff del modo reconciliar vería una edición
    // falsa en cada corrida.
    expect(pan.detalle.map((r) => r.producto_3c)).toEqual(['428', '470']);
    expect(grupos.find((g) => g.destino_dep_id_3c === 43)!.detalle).toHaveLength(1);
  });

  it('separa por fecha: el mismo área en dos días son dos movimientos', () => {
    const { grupos } = agruparExtras(
      [fila({ fecha_hora: '2026-07-29T10:00:00' }), fila({ fecha_hora: '2026-07-30T10:00:00' })],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.fecha).sort()).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('consolida el mismo producto cargado dos veces sumando las cantidades', () => {
    const { grupos } = agruparExtras(
      [
        fila({ articulo_id: 470470, cantidad: 10, nota: 'turno mañana' }),
        fila({ articulo_id: 470470, cantidad: 5.5, nota: 'turno tarde' }),
      ],
      VENTANA,
      CATALOGO,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.detalle).toHaveLength(1);
    expect(grupos[0]!.detalle[0]!.cantidad_real).toBe(15.5);
    // Las dos cargas dejan rastro: al agrupar por día es lo único que queda de cada extra.
    expect(grupos[0]!.detalle[0]!.observaciones).toContain('turno mañana');
    expect(grupos[0]!.detalle[0]!.observaciones).toContain('turno tarde');
  });

  it('la cantidad es la despachada y va a cantidad_real, sin sugerido (regla #2)', () => {
    const { grupos } = agruparExtras([fila({ cantidad: '7,5'.replace(',', '.') })], VENTANA, CATALOGO);
    const renglon = grupos[0]!.detalle[0]!;
    expect(renglon.cantidad_real).toBe(7.5);
    expect(renglon).not.toHaveProperty('cantidad_sugerida');
    expect(renglon.unidad).toBe('KILOGRAMOS');
  });

  it('el destino sale del codigo_area que manda el origen (así entran solas las áreas nuevas)', () => {
    const { grupos, descartes } = agruparExtras(
      [fila({ area: 'AREA NUEVA QUE INVENTARON', codigo_area: 61 })],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.destino_dep_id_3c).toBe(61);
    expect([...descartes.areasDesconocidas]).toEqual([]);
  });

  it('si su codigo_area no coincide con nuestra tabla, gana el del origen pero queda avisado', () => {
    const { grupos, descartes } = agruparExtras([fila({ area: 'PANADERIA', codigo_area: 99 })], VENTANA, CATALOGO);
    expect(grupos[0]!.destino_dep_id_3c).toBe(99);
    expect([...descartes.areasEnConflicto]).toEqual(['PANADERIA: origen 99 ≠ nuestro 47']);
  });

  it('sin codigo_area cae a nuestra tabla, y el área que no conocemos se saltea sin inventar id', () => {
    const { grupos, descartes } = agruparExtras(
      [fila({ area: 'AREA RARA', codigo_area: null }), fila({ area: 'PANADERIA', codigo_area: null })],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.destino_dep_id_3c).toBe(47);
    expect([...descartes.areasDesconocidas]).toEqual(['AREA RARA']);
  });

  it('saltea "RECETAS EN AREAS" porque no tiene depósito en 3c donde imputar el egreso', () => {
    const { grupos, descartes } = agruparExtras(
      [fila({ area: 'RECETAS EN AREAS', codigo_area: null })],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(0);
    expect([...descartes.areasSinDeposito]).toEqual(['RECETAS EN AREAS']);
  });

  it('descarta cantidades no positivas, productos sin resolver y fechas ilegibles', () => {
    const { grupos, descartes } = agruparExtras(
      [
        fila({ cantidad: 0 }),
        fila({ cantidad: -3 }),
        fila({ articulo_id: null }),
        fila({ fecha_hora: null }),
        fila({ fecha_hora: 'ayer a la tarde' }),
      ],
      VENTANA,
      CATALOGO,
    );
    expect(grupos).toHaveLength(0);
    expect(descartes.sinCantidad).toBe(2);
    expect(descartes.sinProducto).toBe(1);
    expect(descartes.sinFecha).toBe(2);
  });

  it('ignora lo que caiga fuera de la ventana pedida', () => {
    const { grupos, descartes } = agruparExtras([fila({ fecha_hora: '2026-06-01T10:00:00' })], VENTANA, CATALOGO);
    expect(grupos).toHaveLength(0);
    expect(descartes.fueraDeVentana).toBe(1);
  });

  it('sin extras no arma ningún grupo (el día sin extras es lo normal)', () => {
    const { grupos } = agruparExtras([], VENTANA, CATALOGO);
    expect(grupos).toEqual([]);
  });
});
