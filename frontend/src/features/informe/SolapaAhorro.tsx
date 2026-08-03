import { useState } from 'react';
import type { Ahorro, Comprador } from '../../shared/api/types';
import { fMjs, fmt, mesLargo, pctTxt } from './formato';
import { FamTag } from './piezas';

// ─────────────────────────────────────────────────────────────────────────────
// Solapa "Ahorro potencial": por cada A comprado, el precio que se paga contra la mejor
// cotización fresca de OTRO proveedor. A favor = compramos mejor que la alternativa;
// en contra = había algo más barato disponible.
// ─────────────────────────────────────────────────────────────────────────────

type Lado = 'FAVOR' | 'CONTRA';

export function SolapaAhorro({ mes, ahorro }: { mes: string; ahorro: Ahorro }) {
  const [lado, setLado] = useState<Lado>('FAVOR');
  const [quien, setQuien] = useState<Comprador | 'ALL'>('ALL');

  const esFavor = lado === 'FAVOR';
  const fuente = esFavor ? ahorro.favor : ahorro.contra;
  const filas = fuente.filter((f) => quien === 'ALL' || f.comprador === quien);
  const color = esFavor ? 'var(--green)' : 'var(--red)';

  return (
    <div className="section">
      <div className="section-title">Ahorro potencial — dinero en la mesa — {mesLargo(mes)}</div>
      <div className="note">
        Por cada A comprado: <strong>precio de compra</strong> vs la{' '}
        <strong>mejor cotización fresca (&lt;90 días) de OTRO proveedor</strong>.{' '}
        <span style={{ color: 'var(--green)' }}>
          <strong>A favor</strong>
        </span>{' '}
        = comprás más barato que la mejor alternativa (mérito del área).{' '}
        <span style={{ color: 'var(--red)' }}>
          <strong>En contra</strong>
        </span>{' '}
        = había algo más barato disponible. El gap % se aplica sobre el gasto real. Ojo: un gap muy grande puede ser{' '}
        <strong>diferencia de unidad o presentación</strong> — validá los de arriba antes de accionar.
      </div>

      <div className="ah-kpis">
        <div className="ah-k">
          <div className="kv" style={{ color: 'var(--green)' }}>
            {fMjs(ahorro.total_favor)}
          </div>
          <div className="kl">A favor</div>
          <div className="ks">
            {ahorro.favor.length} prod{ahorro.pct_favor !== null && ` · ${pctTxt(ahorro.pct_favor)} s/gasto A`}
          </div>
        </div>
        <div className="ah-k">
          <div className="kv" style={{ color: 'var(--red)' }}>
            {fMjs(ahorro.total_contra)}
          </div>
          <div className="kl">En contra (malas compras)</div>
          <div className="ks">
            {ahorro.contra.length} prod{ahorro.pct_contra !== null && ` · ${pctTxt(ahorro.pct_contra)} s/gasto A`}
          </div>
        </div>
        <div className="ah-k">
          <div className="kv" style={{ color: ahorro.neto >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {ahorro.neto >= 0 ? '+' : ''}
            {fMjs(ahorro.neto)}
          </div>
          <div className="kl">Neto del área</div>
          <div className="ks">a favor − en contra</div>
        </div>
        <div className="ah-k">
          <div className="kv">{fMjs(ahorro.gasto_a)}</div>
          <div className="kl">Gasto A del mes</div>
          <div className="ks">base del cálculo</div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="subh" style={{ marginBottom: 8 }}>
          Ahorro potencial por comprador (% sobre su gasto A)
        </div>
        {(['Lautaro', 'Fausto'] as const).map((nombre) => {
          const b = ahorro.por_comprador[nombre];
          if (!b) return null;
          return (
            <div key={nombre} className="gbox-sub" style={{ margin: '0 0 8px' }}>
              <span className="gl2">{nombre}</span>
              <span className="gv2">
                <span style={{ color: 'var(--green)' }}>
                  A favor {fMjs(b.favor.monto)}
                  {b.favor.pct !== null && ` · ${pctTxt(b.favor.pct)}`}
                </span>
                {'  ·  '}
                <span style={{ color: 'var(--red)' }}>
                  En contra {fMjs(b.contra.monto)}
                  {b.contra.pct !== null && ` · ${pctTxt(b.contra.pct)}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="controls" style={{ marginTop: 14 }}>
        <button type="button" className={`fbtn${esFavor ? ' active' : ''}`} onClick={() => setLado('FAVOR')}>
          ✓ A favor
        </button>
        <button type="button" className={`fbtn warn${!esFavor ? ' active' : ''}`} onClick={() => setLado('CONTRA')}>
          ✗ En contra
        </button>
        <span style={{ width: 12 }} />
        {(
          [
            ['ALL', 'Todos'],
            ['Lautaro', 'Lautaro'],
            ['Fausto', 'Fausto'],
          ] as const
        ).map(([valor, texto]) => (
          <button
            key={valor}
            type="button"
            className={`fbtn${quien === valor ? ' active' : ''}`}
            onClick={() => setQuien(valor as Comprador | 'ALL')}
          >
            {texto}
          </button>
        ))}
      </div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Familia</th>
              <th>Comprador</th>
              <th className="num">Precio compra</th>
              <th className="num">{esFavor ? 'Alternativa (otro prov)' : 'Mejor válido'}</th>
              <th>Proveedor</th>
              <th className="num">Gap</th>
              <th className="num">Gasto mes</th>
              <th className="num">{esFavor ? 'Ahorrado $' : 'Perdido $'}</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
                  Sin datos en este lado 🎉
                </td>
              </tr>
            )}
            {filas.map((f) => (
              <tr key={f.producto}>
                <td style={{ fontWeight: 600 }}>{f.producto}</td>
                <td>
                  <FamTag familia={f.familia} />
                </td>
                <td style={{ fontSize: 12 }}>{f.comprador ?? '—'}</td>
                <td className="num">{fmt(f.compra)}</td>
                <td className="num" style={{ color: 'var(--ink2)' }}>
                  {fmt(f.mejor)}
                </td>
                <td style={{ color: 'var(--ink2)', fontSize: 12 }}>{f.mejor_proveedor}</td>
                <td className="num" style={{ color }}>
                  {esFavor ? '+' : '-'}
                  {(f.gap * 100).toFixed(1)}%
                </td>
                <td className="num">{fMjs(f.gasto)}</td>
                <td className="num" style={{ fontWeight: 700, color }}>
                  {fMjs(f.monto)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
