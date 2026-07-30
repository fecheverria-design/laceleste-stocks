import { describe, expect, it } from 'vitest';
import { AREAS_3C, agruparExtras, fechaHoraLocal, normalizarArea, type FilaExtra } from '../src/db/extras-mapeo.js';

// Abastecimientos EXTRAS: los egresos que el encargado de depósito despacha por fuera del
// abastecimiento diario y carga de a uno en la app del compañero (ver sync-extras.ts).
// Acá se testea la lógica pura: mapeo de áreas, fecha_hora y agrupación por (fecha, área).

const VENTANA = new Set(['2026-07-29', '2026-07-30']);

// Fila mínima del origen; cada test pisa lo que le importa.
function fila(over: Partial<FilaExtra> = {}): FilaExtra {
  return {
    id: 1,
    fecha_hora: '2026-07-30T15:42:00',
    codigo_3c: '470',
    articulo_nombre: 'MARGARINA MTK HOJALDRE',
    area: 'PANADERIA',
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

describe('agruparExtras', () => {
  it('junta los extras del día por área en un solo movimiento (decisión de J 2026-07-30)', () => {
    const { grupos } = agruparExtras(
      [
        fila({ codigo_3c: '470', cantidad: 10 }),
        fila({ codigo_3c: '428', cantidad: 25 }),
        fila({ area: 'LOCALES', codigo_3c: '517', cantidad: 1000 }),
      ],
      VENTANA,
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
    );
    expect(grupos).toHaveLength(2);
    expect(grupos.map((g) => g.fecha).sort()).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('consolida el mismo producto cargado dos veces sumando las cantidades', () => {
    const { grupos } = agruparExtras(
      [
        fila({ codigo_3c: '470', cantidad: 10, nota: 'turno mañana' }),
        fila({ codigo_3c: '470', cantidad: 5.5, nota: 'turno tarde' }),
      ],
      VENTANA,
    );

    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.detalle).toHaveLength(1);
    expect(grupos[0]!.detalle[0]!.cantidad_real).toBe(15.5);
    // Las dos cargas dejan rastro: al agrupar por día es lo único que queda de cada extra.
    expect(grupos[0]!.detalle[0]!.observaciones).toContain('turno mañana');
    expect(grupos[0]!.detalle[0]!.observaciones).toContain('turno tarde');
  });

  it('la cantidad es la despachada y va a cantidad_real, sin sugerido (regla #2)', () => {
    const { grupos } = agruparExtras([fila({ cantidad: '7,5'.replace(',', '.') })], VENTANA);
    const renglon = grupos[0]!.detalle[0]!;
    expect(renglon.cantidad_real).toBe(7.5);
    expect(renglon).not.toHaveProperty('cantidad_sugerida');
    expect(renglon.unidad).toBe('KILOGRAMOS');
  });

  it('saltea el área que no sabemos mapear y la reporta, sin inventarle un depósito', () => {
    const { grupos, descartes } = agruparExtras([fila({ area: 'AREA RARA' }), fila()], VENTANA);
    expect(grupos).toHaveLength(1);
    expect([...descartes.areasDesconocidas]).toEqual(['AREA RARA']);
  });

  it('saltea "RECETAS EN AREAS" porque no tiene depósito en 3c donde imputar el egreso', () => {
    const { grupos, descartes } = agruparExtras([fila({ area: 'RECETAS EN AREAS' })], VENTANA);
    expect(grupos).toHaveLength(0);
    expect([...descartes.areasSinDeposito]).toEqual(['RECETAS EN AREAS']);
  });

  it('descarta cantidades no positivas, productos sin codigo_3c y fechas ilegibles', () => {
    const { grupos, descartes } = agruparExtras(
      [
        fila({ cantidad: 0 }),
        fila({ cantidad: -3 }),
        fila({ codigo_3c: null }),
        fila({ fecha_hora: null }),
        fila({ fecha_hora: 'ayer a la tarde' }),
      ],
      VENTANA,
    );
    expect(grupos).toHaveLength(0);
    expect(descartes.sinCantidad).toBe(2);
    expect(descartes.sinProducto).toBe(1);
    expect(descartes.sinFecha).toBe(2);
  });

  it('ignora lo que caiga fuera de la ventana pedida', () => {
    const { grupos, descartes } = agruparExtras([fila({ fecha_hora: '2026-06-01T10:00:00' })], VENTANA);
    expect(grupos).toHaveLength(0);
    expect(descartes.fueraDeVentana).toBe(1);
  });

  it('sin extras no arma ningún grupo (el día sin extras es lo normal)', () => {
    const { grupos } = agruparExtras([], VENTANA);
    expect(grupos).toEqual([]);
  });
});
