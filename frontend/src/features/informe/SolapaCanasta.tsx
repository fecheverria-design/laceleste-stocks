import { useMemo, useState } from 'react';
import type { Canasta } from '../../shared/api/types';
import { aMensual, anclarSerie, baseComparable, cap, fMjs, fmt, mesLargo, pctTxt, reAnclar } from './formato';
import { GraficoCanasta } from './graficos';
import { FamTag } from './piezas';

// ─────────────────────────────────────────────────────────────────────────────
// Índice de precios de la canasta A contra la inflación oficial. La canasta se calcula
// sola desde los precios de compra; la inflación se carga a mano.
//
// ⚠ La inflación entra acá como serie MENSUAL, no acumulada. Antes entraba acumulada y el
// modo "Mensual" la derivaba de ahí — pero el acumulado se corta en el primer mes sin
// cargar, así que con datos parciales la línea desaparecía por completo aunque el dato
// estuviera cargado. La mensual es el dato crudo: siempre se puede mostrar.
//
// Para el modo "Acumulado" las dos series se llevan al MISMO mes base. El ideal es el ancla
// del índice (enero), pero solo sirve si la inflación cubre desde ahí; si no, se compara
// desde donde efectivamente hay datos y el texto lo aclara.
// ─────────────────────────────────────────────────────────────────────────────

type Modo = 'MOM' | 'CUM';

const ALCANCES = [
  ['TOTAL', 'Total A'],
  ['MATERIAS PRIMAS', 'Materias Primas'],
  ['PACKAGING', 'Packaging'],
  ['DESCARTABLES', 'Descartables'],
] as const;

export function SolapaCanasta({
  canasta,
  inflacionMensual,
  onCargarDatos,
}: {
  canasta: Canasta;
  inflacionMensual: Array<number | null>;
  onCargarDatos: () => void;
}) {
  const [modo, setModo] = useState<Modo>('MOM');
  const [alcance, setAlcance] = useState<string>('TOTAL');

  const mensual = modo === 'MOM';
  const acumCanasta = useMemo(() => canasta.scopes[alcance] ?? [], [canasta.scopes, alcance]);

  // Mes base común para comparar acumulados, y las dos series llevadas a ese punto.
  const { baseIdx, serieCanasta, serieInfl } = useMemo(() => {
    const anclaIdx = canasta.meses.indexOf(canasta.ancla);
    const base = baseComparable(inflacionMensual, anclaIdx);
    if (mensual) {
      return { baseIdx: base, serieCanasta: aMensual(acumCanasta), serieInfl: inflacionMensual };
    }
    return {
      baseIdx: base,
      serieCanasta: base >= 0 ? reAnclar(acumCanasta, base) : acumCanasta,
      serieInfl: base >= 0 ? anclarSerie(inflacionMensual, base) : inflacionMensual.map(() => null),
    };
  }, [acumCanasta, inflacionMensual, mensual, canasta.meses, canasta.ancla]);

  const cargados = inflacionMensual.filter((v) => v !== null).length;
  const faltan = inflacionMensual.length - cargados;

  const ultimo = (arr: Array<number | null>): { valor: number | null; mes: string } => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== null && arr[i] !== undefined) return { valor: arr[i]!, mes: canasta.meses[i] ?? '' };
    }
    return { valor: null, mes: '' };
  };

  const cCan = ultimo(serieCanasta);
  const cInf = ultimo(serieInfl);
  const diff = cCan.valor !== null && cInf.valor !== null ? cCan.valor - cInf.valor : null;
  const contrib = canasta.contrib[alcance];
  const etiqueta = alcance === 'TOTAL' ? 'total' : alcance.toLowerCase();

  return (
    <div className="section">
      <div className="section-title">Índice de precios — Canasta A vs Inflación oficial</div>
      <div className="note">
        Variación de precios de nuestra canasta A (solo <strong>compras efectivamente realizadas</strong>, precio
        tildado, ponderado por gasto) contra la inflación oficial. <strong>Mensual</strong> compara mes contra mes;{' '}
        <strong>Acumulado</strong> muestra el arrastre desde un mes base. Si la canasta queda por debajo de la
        inflación, comprás mejor que el mercado.
      </div>

      <div className="controls">
        <button type="button" className={`fbtn${mensual ? ' active' : ''}`} onClick={() => setModo('MOM')}>
          Mensual
        </button>
        <button type="button" className={`fbtn${!mensual ? ' active' : ''}`} onClick={() => setModo('CUM')}>
          Acumulado
        </button>
        <span style={{ width: 14 }} />
        {ALCANCES.map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            className={`fbtn${alcance === valor ? ' active' : ''}`}
            onClick={() => setAlcance(valor)}
          >
            {texto}
          </button>
        ))}
      </div>

      <div className="gbox-sub" style={{ margin: '0 0 12px' }}>
        <span className="gl2">{mensual ? `Último mes con dato · ${cap(mesLargo(cCan.mes))}` : 'Acumulado'}</span>
        <span className="gv2">
          {mensual ? (
            <>
              canasta <span className={cCan.valor !== null && cCan.valor > 0 ? 'up' : 'down'}>{pctTxt(cCan.valor)}</span>
              {' vs '}inflación {pctTxt(cInf.valor)}
            </>
          ) : baseIdx < 0 ? (
            <span style={{ color: 'var(--muted)' }}>sin inflación cargada</span>
          ) : (
            <>
              desde {cap(mesLargo(canasta.meses[baseIdx] ?? ''))}: canasta {pctTxt(cCan.valor)} vs inflación{' '}
              {pctTxt(cInf.valor)}
              {diff !== null && (
                <>
                  {'  →  '}
                  <span className={diff < 0 ? 'down' : 'up'}>
                    {diff < 0
                      ? `comprando ${Math.abs(diff * 100).toFixed(1)} pts MEJOR que el mercado`
                      : `${(diff * 100).toFixed(1)} pts PEOR que el mercado`}
                  </span>
                </>
              )}
            </>
          )}
        </span>
      </div>

      <div className="chart-wrap">
        <GraficoCanasta
          meses={canasta.meses}
          canasta={serieCanasta}
          inflacion={serieInfl}
          mensual={mensual}
          etiqueta={etiqueta}
        />
      </div>

      {faltan > 0 && (
        <div className="info-box" style={{ background: '#fffaf3', borderColor: '#f3e2cf' }}>
          {cargados === 0 ? (
            <>
              Falta cargar la <strong>inflación oficial</strong> para poder comparar.
            </>
          ) : (
            <>
              Hay inflación cargada en <strong>{cargados}</strong> de los {inflacionMensual.length} meses del período.
              {!mensual && baseIdx >= 0 && (
                <>
                  {' '}
                  Por eso el acumulado se compara desde <strong>{cap(mesLargo(canasta.meses[baseIdx] ?? ''))}</strong> y
                  no desde {cap(mesLargo(canasta.ancla))}: para arrancar en el mes base hay que tener todos los meses
                  intermedios.
                </>
              )}
            </>
          )}{' '}
          <button
            type="button"
            onClick={onCargarDatos}
            style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan-d)', cursor: 'pointer' }}
          >
            Cargar los meses que faltan →
          </button>
        </div>
      )}

      {contrib && contrib.items.length > 0 && (
        <>
          <div className="note" style={{ margin: '14px 0 6px' }}>
            Cómo se pondera la variación de <strong>{cap(mesLargo(contrib.mes))}</strong>:{' '}
            <code>aporte = variación × peso</code>, donde <code>peso = gasto del producto ÷ gasto de la canasta</code>.
            La suma de los aportes es la variación del índice ({pctTxt(contrib.var_indice)}). Así un producto que
            sube mucho pero se compra poco casi no mueve el índice.
          </div>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Familia</th>
                  <th className="num">Var. mes</th>
                  <th className="num">Gasto/mes</th>
                  <th className="num">Peso</th>
                  <th className="num">Aporte al índice</th>
                </tr>
              </thead>
              <tbody>
                {contrib.items.map((x) => (
                  <tr key={x.producto}>
                    <td style={{ fontWeight: 600 }}>{x.producto}</td>
                    <td>
                      <FamTag familia={x.familia} />
                    </td>
                    <td className={`num ${x.var > 0.005 ? 'up' : x.var < -0.005 ? 'down' : 'flat'}`}>{pctTxt(x.var)}</td>
                    <td className="num">{fMjs(x.gasto)}</td>
                    <td className="num">{(x.peso * 100).toFixed(1)}%</td>
                    <td
                      className={`num ${x.aporte > 0.0005 ? 'up' : x.aporte < -0.0005 ? 'down' : 'flat'}`}
                      style={{ fontWeight: 700 }}
                    >
                      {x.aporte > 0 ? '+' : ''}
                      {(x.aporte * 100).toFixed(2)} pts
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canasta.anomalias.length > 0 && (
        <div
          className="cov-wrap"
          style={{ gridTemplateColumns: '1fr', marginTop: 14, background: '#fdf3f3', borderColor: '#f0d2d2' }}
        >
          <div className="cov-risk">
            <strong style={{ color: 'var(--red)' }}>⚠ Variaciones anómalas excluidas del índice</strong> (|var| &gt;{' '}
            {Math.round(canasta.outlier_max * 100)}% en un mes — casi siempre un dedazo o un cambio de
            unidad/presentación). Revisá estas cargas en la hoja de Precios:
            <br />
            {canasta.anomalias.map((a) => (
              <span
                key={`${a.producto}-${a.mes}`}
                className="riskchip"
                style={{ borderColor: '#f0d2d2' }}
                title={`${mesLargo(a.mes)} · ${fmt(a.de)} → ${fmt(a.a)} · gasto ${fMjs(a.gasto)}`}
              >
                {a.producto} <span className="n">{pctTxt(a.var)}</span>{' '}
                <span style={{ color: 'var(--muted)' }}>{mesLargo(a.mes)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
