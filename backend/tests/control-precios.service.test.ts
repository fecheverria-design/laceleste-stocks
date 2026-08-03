import { describe, expect, it } from 'vitest';
import { calcularAlertas } from '../src/services/control-precios.service.js';
import type { FilaMatriz } from '../src/services/informe-precios.service.js';

// Control de precios — por qué un producto entra a la lista de revisión. Las reglas son
// las mismas del informe (mismos umbrales importados); acá se fija cuándo se dispara cada
// alerta, que es lo que define el trabajo diario del área de compras.

function fila(over: Partial<FilaMatriz> = {}): FilaMatriz {
  return {
    producto_3c: '460',
    producto: 'QUESO SARDO',
    familia: 'MATERIAS PRIMAS',
    comprador: 'Lautaro',
    n_prov: 3,
    n_prov_hist: 3,
    precio: 1000,
    proveedor: 'FUENTES',
    fecha: '2026-07-20',
    dias: 10,
    sin_compra: false,
    cotizaciones: [],
    ...over,
  };
}

const sano = { tieneSalto: false, proveedorUsado: 1 };

describe('alertas del control de precios', () => {
  it('un producto al día no tiene nada que revisar', () => {
    expect(calcularAlertas(fila(), sano)).toEqual([]);
  });

  it('avisa cuando el precio usado tiene más de 90 días', () => {
    expect(calcularAlertas(fila({ dias: 91 }), sano)).toContain('VENCIDO');
    expect(calcularAlertas(fila({ dias: 90 }), sano)).not.toContain('VENCIDO');
  });

  it('avisa cuando no llega al objetivo de 3 cotizaciones vigentes', () => {
    expect(calcularAlertas(fila({ n_prov: 2 }), sano)).toContain('POCAS_COTIZACIONES');
    expect(calcularAlertas(fila({ n_prov: 3 }), sano)).not.toContain('POCAS_COTIZACIONES');
  });

  it('avisa cuando no hay ningún precio de tipo compra', () => {
    expect(calcularAlertas(fila({ sin_compra: true }), sano)).toContain('SIN_COMPRA');
  });

  it('avisa cuando el precio usado no tiene proveedor: no se puede comparar con nadie', () => {
    expect(calcularAlertas(fila(), { ...sano, proveedorUsado: null })).toContain('SIN_PROVEEDOR');
  });

  it('no avisa por proveedor cuando el producto no tiene precio usado', () => {
    // undefined = no hay fila de precio; el faltante ya lo cubre SIN_COMPRA.
    expect(calcularAlertas(fila(), { ...sano, proveedorUsado: undefined })).not.toContain('SIN_PROVEEDOR');
  });

  it('acumula todos los motivos, que es lo que ordena la lista de trabajo', () => {
    const alertas = calcularAlertas(fila({ dias: 200, n_prov: 1, sin_compra: true }), {
      tieneSalto: true,
      proveedorUsado: null,
    });
    expect(alertas).toEqual(['SIN_COMPRA', 'VENCIDO', 'POCAS_COTIZACIONES', 'SALTO', 'SIN_PROVEEDOR']);
  });
});
