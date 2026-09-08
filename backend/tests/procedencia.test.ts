import { describe, expect, it } from 'vitest';
import { fichaGasto, fichaPrecio } from '../src/domain/procedencia.js';
import { FAMILIAS_EXCLUIDAS_GASTO, FAMILIAS_POR_COMPRADOR } from '../src/domain/familias.js';

// La ficha de procedencia explica de dónde sale cada número del informe. Su valor entero
// depende de una cosa: que se arme con LAS MISMAS constantes que usa la query. Una ficha
// escrita a mano envejece sin avisar y termina mintiendo con autoridad, que es peor que no
// tener ficha. Estos tests fijan justamente eso: si alguien agrega una familia excluida y la
// ficha no la nombra, acá se rompe.

const cobertura = { renglones: 12_696, desde: '26/02/2024', hasta: '04/09/2026', sin_iva: 0 };

describe('fichaGasto', () => {
  it('nombra exactamente las familias del comprador, sin hardcodear la lista', () => {
    const f = fichaGasto({ mes: '2026-08', comprador: 'Fausto', renglonesDelMes: 100, proveedores: 10, productos: 40, cobertura });
    const incluye = f.pasos.find((p) => p.titulo === 'Qué se incluye');

    expect(incluye?.items).toEqual([...FAMILIAS_POR_COMPRADOR.Fausto]);
    expect(incluye?.items).not.toContain('MATERIAS PRIMAS'); // esa es de Lautaro
  });

  it('nombra todas las familias excluidas del gasto', () => {
    const f = fichaGasto({ mes: '2026-08', comprador: 'Lautaro', renglonesDelMes: 100, proveedores: 10, productos: 40, cobertura });
    const afuera = f.pasos.find((p) => p.titulo === 'Qué se deja afuera');

    expect(afuera?.items).toEqual([...FAMILIAS_EXCLUIDAS_GASTO]);
  });

  it('sin comprador explica el total y lista las familias de todos los compradores', () => {
    const f = fichaGasto({ mes: '2026-08', renglonesDelMes: 100, proveedores: 10, productos: 40, cobertura });

    expect(f.titulo).toContain('Gasto total');
    expect(f.pasos.find((p) => p.titulo === 'Qué se incluye')?.items).toEqual([
      ...FAMILIAS_POR_COMPRADOR.Lautaro,
      ...FAMILIAS_POR_COMPRADOR.Fausto,
    ]);
  });

  it('dice hasta qué fecha llega el dato leído de 3c', () => {
    const f = fichaGasto({ mes: '2026-08', renglonesDelMes: 100, proveedores: 10, productos: 40, cobertura });

    expect(f.pasos[0]?.detalle).toContain('04/09/2026');
    expect(f.pasos[0]?.detalle).toContain('12.696');
  });

  it('avisa cuando hay renglones sin IVA reconstruido (el total queda corto)', () => {
    const f = fichaGasto({
      mes: '2026-08',
      renglonesDelMes: 100,
      proveedores: 10,
      productos: 40,
      cobertura: { ...cobertura, sin_iva: 33 },
    });
    const iva = f.pasos.find((p) => p.titulo === '¿Tiene IVA?');

    expect(iva?.detalle).toContain('33');
    expect(iva?.detalle).toContain('queda apenas corto');
  });

  it('no dice nada del IVA faltante cuando no falta ninguno', () => {
    const f = fichaGasto({ mes: '2026-08', renglonesDelMes: 100, proveedores: 10, productos: 40, cobertura });

    expect(f.pasos.find((p) => p.titulo === '¿Tiene IVA?')?.detalle).not.toContain('⚠');
  });

  it('traduce el mes a algo legible', () => {
    expect(fichaGasto({ mes: '2026-08', renglonesDelMes: 1, proveedores: 1, productos: 1, cobertura }).titulo).toContain('agosto 2026');
  });
});

describe('fichaPrecio', () => {
  it('el controlado se anuncia como tal, aunque el tipo sea ACTUALIZACION', () => {
    const f = fichaPrecio({ controlado: true, tipo: 'ACTUALIZACION', fecha: '01/09/2026', proveedor: 'FUENTES' });

    expect(f.pasos[0]?.detalle).toContain('CONTROLADO');
    expect(f.pasos[0]?.detalle).toContain('FUENTES');
  });

  it('sin marca manual, una COMPRA se explica como lo que se pagó', () => {
    const f = fichaPrecio({ controlado: false, tipo: 'COMPRA', fecha: '01/09/2026', proveedor: null });

    expect(f.pasos[0]?.detalle).toContain('última COMPRA');
  });

  it('una ACTUALIZACION aclara que nunca hubo compra', () => {
    const f = fichaPrecio({ controlado: false, tipo: 'ACTUALIZACION', fecha: null, proveedor: null });

    expect(f.pasos[0]?.detalle).toContain('nunca hubo una compra');
  });

  it('un producto sin precio lo dice, no inventa', () => {
    const f = fichaPrecio({ controlado: false, tipo: null, fecha: null, proveedor: null });

    expect(f.pasos[0]?.detalle).toContain('no tiene precio cargado');
  });
});
