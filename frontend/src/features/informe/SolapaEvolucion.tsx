import { useEffect, useMemo, useState } from 'react';
import type { Evolucion } from '../../shared/api/types';
import { fmt } from './formato';
import { FamTag, Var } from './piezas';
import { LineasPrecios } from './graficos';

// ─────────────────────────────────────────────────────────────────────────────
// Solapa "Evolución Precios": cómo se movieron los precios en 12 meses, mirado de dos
// maneras. Por proveedor se ven los productos A que cotiza; por producto, cómo lo cotizó
// cada proveedor mes a mes. La leyenda del gráfico es clickeable.
// ─────────────────────────────────────────────────────────────────────────────

type Modo = 'prov' | 'prod';

export function SolapaEvolucion({ evolucion }: { evolucion: Evolucion }) {
  const [modo, setModo] = useState<Modo>('prov');
  const [elegido, setElegido] = useState('');

  const fuente = modo === 'prov' ? evolucion.por_proveedor : evolucion.por_producto;
  const claves = useMemo(() => Object.keys(fuente).sort((a, b) => a.localeCompare(b)), [fuente]);

  // Al cambiar de modo (o al cargar) se posiciona en el primero de la lista.
  useEffect(() => {
    if (claves.length > 0 && !claves.includes(elegido)) setElegido(claves[0]!);
  }, [claves, elegido]);

  const series = fuente[elegido] ?? [];

  return (
    <div className="section">
      <div className="section-title">Evolución de precios — por proveedor o por producto (12 meses)</div>
      <div className="note">
        Evolución de precios de los últimos 12 meses. Elegí <strong>Por proveedor</strong> (ves los productos A de
        ese proveedor) o <strong>Por producto</strong> (ves cómo lo cotizó cada proveedor mes a mes). La leyenda es
        clickeable. La tabla muestra el precio vigente y la variación del mes y de los 12 meses.
      </div>

      <div className="prov-select">
        <button type="button" className={`fbtn${modo === 'prov' ? ' active' : ''}`} onClick={() => setModo('prov')}>
          Por proveedor
        </button>
        <button type="button" className={`fbtn${modo === 'prod' ? ' active' : ''}`} onClick={() => setModo('prod')}>
          Por producto
        </button>
        <select value={elegido} onChange={(e) => setElegido(e.target.value)}>
          {claves.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <span className="meta">
          {series.length} {modo === 'prov' ? 'producto(s) A' : 'proveedor(es)'}
        </span>
      </div>

      {series.length === 0 ? (
        <div className="info-box">No hay cotizaciones cargadas para mostrar.</div>
      ) : (
        <div className="chart-wrap">
          <LineasPrecios meses={evolucion.meses} series={series} />
        </div>
      )}

      <div className="tbl-scroll" style={{ marginTop: 14 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>{modo === 'prov' ? 'Producto A' : 'Proveedor'}</th>
              <th>Familia</th>
              <th className="num">Precio vigente</th>
              <th className="num">Var. mes</th>
              <th className="num">Var. 12m</th>
            </tr>
          </thead>
          <tbody>
            {series.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>
                  Sin datos
                </td>
              </tr>
            )}
            {series.map((s) => (
              <tr key={s.nombre} style={s.usado ? { background: '#eafaf0' } : undefined}>
                <td style={{ fontWeight: 600 }}>
                  {s.usado && (
                    <span title="Precio que se usa" style={{ color: 'var(--green)', fontWeight: 800 }}>
                      ✓{' '}
                    </span>
                  )}
                  {s.nombre}
                </td>
                <td>
                  <FamTag familia={s.familia} />
                </td>
                <td className="num">{fmt(s.precio_vigente)}</td>
                <td className="num">
                  <Var v={s.var_mes} />
                </td>
                <td className="num">
                  <Var v={s.var_acum} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
