import { describe, expect, it } from 'vitest';
import { notaFaltantes, separarPorMaestro } from '../src/db/sync-maestro.js';

// Regla del sync (los dos, abastecimientos y recepciones): un producto que todavía no está
// en nuestro maestro saltea SU renglón, nunca el movimiento entero. Nace del caso real del
// 26/07/2026: el RINT de Recetas no entró NINGÚN día porque un solo artículo nuevo de 3c
// (1189 GOMA XANTICA) hacía que el service rechazara el movimiento completo.

const REAL = { cantidad_real: 5 };

describe('separarPorMaestro', () => {
  it('deja pasar los renglones conocidos y aparta el que falta (no tumba el movimiento)', () => {
    const renglones = [
      { producto_3c: '100', ...REAL },
      { producto_3c: '1189', ...REAL },
      { producto_3c: '200', ...REAL },
    ];
    const { detalle, faltantes } = separarPorMaestro(renglones, new Set(['100', '200']));

    expect(detalle.map((r) => r.producto_3c)).toEqual(['100', '200']);
    expect(faltantes).toEqual(['1189']);
    // El renglón que sobrevive viaja entero (la cantidad es lo que descuenta stock, regla #2).
    expect(detalle[0]).toEqual({ producto_3c: '100', cantidad_real: 5 });
  });

  it('sin faltantes no toca nada y la nota queda vacía (el diff del reconciliar no se ensucia)', () => {
    const renglones = [{ producto_3c: '100', ...REAL }, { producto_3c: '200', ...REAL }];
    const { detalle, faltantes } = separarPorMaestro(renglones, new Set(['100', '200']));

    expect(detalle).toEqual(renglones);
    expect(faltantes).toEqual([]);
    expect(notaFaltantes(faltantes)).toBe('');
  });

  it('no repite un código faltante aunque venga en varios renglones', () => {
    const renglones = [
      { producto_3c: '1189', ...REAL },
      { producto_3c: '1189', ...REAL },
      { producto_3c: '1190', ...REAL },
    ];
    const { detalle, faltantes } = separarPorMaestro(renglones, new Set(['100']));

    expect(detalle).toEqual([]);
    expect(faltantes).toEqual(['1189', '1190']);
  });

  it('si NINGÚN producto está en el maestro devuelve detalle vacío (el sync saltea el área)', () => {
    const { detalle, faltantes } = separarPorMaestro([{ producto_3c: '999', ...REAL }], new Set());

    expect(detalle).toEqual([]);
    expect(faltantes).toEqual(['999']);
  });

  it('la nota nombra los códigos salteados para que el agujero se vea desde la app', () => {
    expect(notaFaltantes(['1189', '1190'])).toBe(
      ' — SIN ALTA EN EL MAESTRO (renglón salteado): 1189, 1190',
    );
  });
});
