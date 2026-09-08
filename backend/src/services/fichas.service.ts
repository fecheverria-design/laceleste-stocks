import { catalogoFichas, type GrupoFichas } from '../domain/fichas-catalogo.js';
import { coberturaCompras } from '../repositories/informe.repository.js';
import { datosFichas } from '../repositories/fichas.repository.js';
import {
  ANCLA_CANASTA,
  DIAS_FRESCA,
  DIAS_VIGENTE,
  OBJETIVO_COTIZACIONES,
  OUTLIER_MAX,
  UMBRAL_SALTO,
} from './informe-precios.service.js';

// Arma el catálogo de fichas ("de dónde sale cada número"), hoja por hoja.
//
// Este service existe para una sola cosa: juntar los datos reales y los umbrales del informe
// y pasárselos al dominio. Los umbrales viven acá arriba, así que se INYECTAN — el dominio no
// puede importar de services (regla #3). Y al inyectarlos desde su definición real, si mañana
// alguien cambia UMBRAL_SALTO, la ficha lo dice sola.
export async function fichasPorHoja(): Promise<GrupoFichas[]> {
  const [compras, datos] = await Promise.all([coberturaCompras(), datosFichas()]);
  return catalogoFichas({
    compras,
    renglonesUltimoMes: datos.renglonesUltimoMes,
    productos: datos.productos,
    proveedores: datos.proveedores,
    stock: datos.stock,
    precios: datos.precios,
    movimientos: datos.movimientos,
    umbrales: {
      diasVigente: DIAS_VIGENTE,
      diasFresca: DIAS_FRESCA,
      objetivoCotizaciones: OBJETIVO_COTIZACIONES,
      umbralSalto: UMBRAL_SALTO,
      outlierMax: OUTLIER_MAX,
      anclaCanasta: ANCLA_CANASTA,
    },
  });
}
