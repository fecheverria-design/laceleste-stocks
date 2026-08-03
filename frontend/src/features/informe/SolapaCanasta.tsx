import { useState } from 'react';
import type { Canasta } from '../../shared/api/types';
import { aMensual, cap, fMjs, fmt, mesLargo, pctTxt } from './formato';
import { GraficoCanasta } from './graficos';
import { FamTag } from './piezas';

// ─────────────────────────────────────────────────────────────────────────────
// Índice de precios de la canasta A contra la inflación oficial. La canasta se calcula
// sola desde los precios de compra; la inflación se carga a mano (mientras no esté, el
// gráfico muestra la canasta y la línea de inflación queda vacía).
// ─────────────────────────────────────────────────────────────────────────────

type Modo = 'MOM' | 'CUM';

const ALCANCES = [
  ['TOTAL', 'Total A'],
  ['MATERIAS PRIMAS', 'Materias Primas'],
  ['PACKAGING', 'Packaging'],
  ['DESCARTABLES', 'Descartables'],
] as const;

export function SolapaCanasta({ canasta, inflacion }: { canasta: Canasta; inflacion: Array<number | null> }) {
  const [modo, setModo] = useState<Modo>('MOM');
  const [alcance, setAlcance] = useState<string>('TOTAL');

  const mensual = modo === 'MOM';
  const acumCanasta = canasta.scopes[alcance] ?? [];
  const serieCanasta = mensual ? aMensual(acumCanasta) : acumCanasta;
  const serieInfl = mensual ? aMensual(inflacion) : inflacion;

  const ultimo = <T,>(arr: Array<T | null>): T | null => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && arr[i] !== undefined) return arr[i] as T;
    return null;
  };
  const ultimoMes = (() => {
    for (let i = serieCanasta.length - 1; i >= 0; i--) if (serieCanasta[i] !== null) return canasta.meses[i] ?? '';
    return '';
  })();

  const cCan = ultimo(serieCanasta);
  const cInf = ultimo(serieInfl);
  const diff = cCan !== null && cInf !== null ? cCan - cInf : null;

  const contrib = canasta.contrib[alcance];
  const etiqueta = alcance === 'TOTAL' ? 'total' : alcance.toLowerCase();

  return (
    <div className="section">
      <div className="section-title">Índice de precios — Canasta A vs Inflación oficial</div>
      <div className="note">
        Variación de precios de nuestra canasta A (solo <strong>compras efectivamente realizadas</strong>, precio
        tildado, ponderado por gasto) contra la inflación oficial. Por defecto <strong>mensual</strong> (lo que
        subió o bajó cada mes); con <strong>Acumulado</strong> ves el cambio desde el mes base. Si la canasta queda
        por debajo de la inflación, comprás mejor que el mercado.
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
        <span className="meta" style={{ fontSize: 12, color: 'var(--ink2)' }}>
          {mensual
            ? `Variación mensual · último mes (${cap(mesLargo(ultimoMes))}): canasta ${pctTxt(cCan)} vs inflación ${pctTxt(cInf)}`
            : `Acumulado desde ${cap(mesLargo(canasta.ancla))}: canasta ${pctTxt(cCan)} vs inflación ${pctTxt(cInf)}` +
              (diff !== null
                ? `  →  ${diff < 0 ? `comprando ${Math.abs(diff * 100).toFixed(1)} pts MEJOR que el mercado` : `${(diff * 100).toFixed(1)} pts PEOR que el mercado`}`
                : '')}
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

      {cInf === null && (
        <div className="info-box">
          Falta cargar la <strong>inflación oficial</strong> para poder comparar. Se carga a mano una vez por mes.
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
