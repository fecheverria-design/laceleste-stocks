import { useMemo, useState } from 'react';
import type { Cobertura, ControlDatos, FilaMatriz, FilaVariacionVentana } from '../../shared/api/types';
import { fecha, fmt, mesLargo, pctTxt } from './formato';
import { FamTag, ProvBadge } from './piezas';
import { BarrasVariacion } from './graficos';

// ─────────────────────────────────────────────────────────────────────────────
// Solapa "Matriz & Variación": el gráfico de variación del precio de compra a 1/3/6
// meses, el semáforo de cobertura de cotizaciones, el control de datos y la matriz
// expandible con el precio de cada proveedor.
// ─────────────────────────────────────────────────────────────────────────────

type Ventana = '1' | '3' | '6';
type FiltroFamilia = 'ALL' | 'MATERIAS PRIMAS' | 'PACKAGING' | 'DESCARTABLES' | 'UNICO';

const OBJETIVO = 3;

export function SolapaMatriz({
  mes,
  matriz,
  cobertura,
  control,
  variaciones,
  inflacionVentana,
}: {
  mes: string;
  matriz: FilaMatriz[];
  cobertura: Cobertura;
  control: ControlDatos;
  variaciones: FilaVariacionVentana[];
  // Inflación acumulada por ventana (fracción). Se carga a mano; hasta entonces es null y
  // las barras no se pintan de rojo (no hay contra qué comparar).
  inflacionVentana: Record<Ventana, number | null>;
}) {
  const [ventana, setVentana] = useState<Ventana>('6');
  const [familia, setFamilia] = useState<FiltroFamilia>('ALL');
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<Set<string>>(new Set());

  const infl = inflacionVentana[ventana];

  const barras = useMemo(() => {
    const clave = `var_${ventana}` as const;
    return variaciones
      .filter((v) => v[clave] !== null)
      .sort((a, b) => (b[clave] ?? 0) - (a[clave] ?? 0))
      .map((v) => ({ producto: v.producto, valor: v[clave]! }));
  }, [variaciones, ventana]);

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return matriz.filter((m) => {
      if (familia === 'UNICO') {
        if (m.n_prov >= OBJETIVO) return false;
      } else if (familia !== 'ALL' && (m.familia ?? '').toUpperCase() !== familia) {
        return false;
      }
      if (q) {
        const enProv = m.cotizaciones.some((c) => c.proveedor.toLowerCase().includes(q));
        if (!m.producto.toLowerCase().includes(q) && !enProv) return false;
      }
      return true;
    });
  }, [matriz, familia, busqueda]);

  const alternar = (codigo: string) => {
    setAbierto((prev) => {
      const next = new Set(prev);
      if (!next.delete(codigo)) next.add(codigo);
      return next;
    });
  };

  return (
    <>
      <div className="section">
        <div className="section-title">Variación de precio de compra — productos A comprados</div>
        <div className="note">
          Barras = variación del precio <strong>de compra</strong> (el tildado) de cada A que tuvo compra en el
          período.{' '}
          {infl === null ? (
            <>
              Cuando esté cargada la <strong>inflación del mes</strong> se pintan en rojo los que subieron por
              encima de ella.
            </>
          ) : (
            <>
              <span style={{ color: 'var(--red)' }}>Rojo</span> = subió más que la inflación de la ventana ·{' '}
              <span style={{ color: 'var(--teal)' }}>celeste</span> = por debajo.
            </>
          )}{' '}
          Cambiá la ventana para ver qué subió en <strong>1, 3 o 6 meses</strong>.
        </div>
        <div className="controls">
          {(['1', '3', '6'] as const).map((v) => (
            <button key={v} type="button" className={`fbtn${ventana === v ? ' active' : ''}`} onClick={() => setVentana(v)}>
              {v === '1' ? '1 mes' : `${v} meses`}
            </button>
          ))}
          <span className="meta" style={{ fontSize: 12, color: 'var(--ink2)' }}>
            Inflación acumulada {ventana}m: {infl === null ? '—' : pctTxt(infl)}
          </span>
        </div>
        {barras.length === 0 ? (
          <div className="info-box">
            Ningún producto A comprado en {mesLargo(mes)} tiene precio cargado {ventana} mes(es) atrás para comparar.
          </div>
        ) : (
          <div className="chart-wrap tall">
            <BarrasVariacion items={barras} inflacion={infl} ventana={ventana} />
          </div>
        )}
      </div>

      <div className="section">
        <div className="section-title">Matriz de precios — Prioridad A — {mesLargo(mes)}</div>

        {/* Semáforo de cobertura: el objetivo del área es 3 cotizaciones por producto A. */}
        <div className="cov-wrap">
          <div className="cov-pill cov-3">
            <div className="cv">{cobertura.c3}</div>
            <div className="cl">3+ cotiz.</div>
          </div>
          <div className="cov-pill cov-2">
            <div className="cv">{cobertura.c2}</div>
            <div className="cl">2 cotiz.</div>
          </div>
          <div className="cov-pill cov-1">
            <div className="cv">{cobertura.c1}</div>
            <div className="cl">1 cotiz.</div>
          </div>
          <div className="cov-risk">
            <strong style={{ color: 'var(--red)' }}>A por debajo del objetivo de 3 cotizaciones:</strong>
            <br />
            {cobertura.riesgo.length === 0 ? (
              'Ninguno 🎉'
            ) : (
              <>
                {cobertura.riesgo.slice(0, 18).map((r) => (
                  <span key={r.producto} className="riskchip">
                    {r.producto} <span className="n">{r.n_prov}</span>
                  </span>
                ))}
                {cobertura.riesgo.length > 18 && (
                  <span style={{ color: 'var(--muted)' }}> +{cobertura.riesgo.length - 18} más</span>
                )}
              </>
            )}
          </div>
        </div>

        <ControlDeDatos control={control} />

        <div className="note">
          <strong>Precio de compra</strong> = el último precio tildado como compra → el que realmente pagás y el que
          alimenta la variación. Clic en el producto para ver el último precio de cada proveedor con su fecha.{' '}
          <strong>N° Prov = proveedores con cotización vigente</strong> (últimos 6 meses). Al expandir ves también
          las <span style={{ color: '#b06' }}>vencidas</span> (más de 6 meses, no cuentan). Verde = el precio que se
          está usando.
        </div>

        <div className="controls">
          <input
            className="search"
            placeholder="Buscar producto o proveedor..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          {(
            [
              ['ALL', 'Todas'],
              ['MATERIAS PRIMAS', 'Materias Primas'],
              ['PACKAGING', 'Packaging'],
              ['DESCARTABLES', 'Descartables'],
            ] as const
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              className={`fbtn${familia === valor ? ' active' : ''}`}
              onClick={() => setFamilia(valor)}
            >
              {texto}
            </button>
          ))}
          <button
            type="button"
            className={`fbtn warn${familia === 'UNICO' ? ' active' : ''}`}
            onClick={() => setFamilia('UNICO')}
          >
            ⚠ menos de 3 prov.
          </button>
        </div>

        <div className="tbl-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Familia</th>
                <th className="num">N° Prov</th>
                <th className="num">Precio compra</th>
                <th>Proveedor usado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                    Sin resultados
                  </td>
                </tr>
              )}
              {filas.map((m) => {
                const expandido = abierto.has(m.producto_3c);
                return (
                  <FilaProducto key={m.producto_3c} m={m} expandido={expandido} onToggle={() => alternar(m.producto_3c)} />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FilaProducto({ m, expandido, onToggle }: { m: FilaMatriz; expandido: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className={`prod-row${expandido ? ' expanded' : ''}`} onClick={onToggle}>
        <td>
          <span className="caret">▶</span>
          {m.producto}
          {m.sin_compra && (
            <span className="tag tag-old" title="Sin ningún precio de tipo COMPRA — se está usando un fallback">
              sin compra
            </span>
          )}
        </td>
        <td>
          <FamTag familia={m.familia} />
        </td>
        <td className="num">
          <ProvBadge n={m.n_prov} />
        </td>
        <td className="num">{fmt(m.precio)}</td>
        <td style={{ color: 'var(--cyan-d)', fontSize: 12 }}>
          <span title="Precio que se usa" style={{ color: 'var(--green)', fontWeight: 700 }}>
            ✓
          </span>{' '}
          {m.proveedor ?? '—'} <span className="fecha">{fecha(m.fecha)}</span>
        </td>
      </tr>
      {expandido &&
        m.cotizaciones.map((c) => (
          <tr
            key={`${m.producto_3c}-${c.proveedor}`}
            className={`prov-row${c.es_usado ? ' best' : ''}`}
            style={{ opacity: c.vigente ? 1 : 0.55, background: c.es_usado ? '#eafaf0' : undefined }}
          >
            <td>
              {c.es_usado && (
                <span title="Precio que se usa" style={{ color: 'var(--green)', fontWeight: 800 }}>
                  ✓{' '}
                </span>
              )}
              {c.proveedor}
              {!c.vigente ? (
                <span className="tag tag-old" title="Cotización de más de 6 meses — no cuenta como vigente">
                  vencida
                </span>
              ) : (
                !c.reciente && (
                  <span className="tag tag-warn" title={`${c.dias} días`}>
                    +60d
                  </span>
                )
              )}
            </td>
            <td />
            <td className="pp">{fmt(c.precio)}</td>
            <td colSpan={2} className="fecha">
              {fecha(c.fecha)}
            </td>
          </tr>
        ))}
    </>
  );
}

// Caza precios sospechosos antes de que ensucien el informe. Es el bloque "🔎 Control de
// datos" del original: saltos bruscos, precios vencidos y productos sin precio tildado.
function ControlDeDatos({ control }: { control: ControlDatos }) {
  const hayAlgo = control.saltos.length > 0 || control.vencidos.length > 0 || control.sin_compra.length > 0;
  if (!hayAlgo) return null;

  return (
    <div
      className="cov-wrap"
      style={{ gridTemplateColumns: '1fr', marginBottom: 14, background: '#fffaf3', borderColor: '#f3e2cf' }}
    >
      <div className="cov-risk">
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          🔎 Control de datos — precios a revisar
        </div>

        {control.saltos.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--orange-d)' }}>
              ⚠ Saltos del precio usado &gt;{Math.round(control.umbral * 100)}% en un mes
            </strong>{' '}
            — verificá que no sea un dedazo o un cambio de unidad:
            <br />
            {control.saltos.slice(0, 20).map((s) => (
              <span key={`${s.producto}-${s.mes}`} className="riskchip" style={{ borderColor: '#f0d2d2' }}>
                {s.producto} <span className="n">{pctTxt(s.var)}</span>{' '}
                <span style={{ color: 'var(--muted)' }}>
                  {mesLargo(s.mes)} · {fmt(s.de)}→{fmt(s.a)}
                </span>
              </span>
            ))}
            {control.saltos.length > 20 && (
              <span style={{ color: 'var(--muted)' }}> +{control.saltos.length - 20} más</span>
            )}
          </div>
        )}

        {control.sin_compra.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--red)' }}>✗ Sin precio de compra tildado</strong> (usan fallback):{' '}
            {control.sin_compra.slice(0, 15).map((s) => (
              <span key={s.producto} className="riskchip">
                {s.producto}
              </span>
            ))}
            {control.sin_compra.length > 15 && (
              <span style={{ color: 'var(--muted)' }}> +{control.sin_compra.length - 15} más</span>
            )}
          </div>
        )}

        {control.vencidos.length > 0 && (
          <div>
            <strong style={{ color: '#bb8b1a' }}>
              ⏳ Precio usado desactualizado &gt;{control.dias_vencido} días
            </strong>{' '}
            — el precio vigente ya tiene fecha vieja:{' '}
            {control.vencidos.slice(0, 15).map((v) => (
              <span key={v.producto} className="riskchip">
                {v.producto} <span className="n">{v.dias}d</span>
              </span>
            ))}
            {control.vencidos.length > 15 && (
              <span style={{ color: 'var(--muted)' }}> +{control.vencidos.length - 15} más</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
