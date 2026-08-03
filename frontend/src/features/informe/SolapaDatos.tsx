import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../../shared/api/client';
import type { IndicadorMensual } from '../../shared/api/types';
import { cap, fMjs, mesLargo } from './formato';

// ─────────────────────────────────────────────────────────────────────────────
// Carga manual de ventas e inflación. Son los dos datos que no salen de 3c ni de ningún
// sync: los carga el área de compras a principio de mes.
//
// Vive dentro del informe, que es donde se usan. Cada campo guarda al salir del foco: son
// dos números por mes, un botón "Guardar" sería un paso de más.
//
// La inflación se muestra en % y se guarda como FRACCIÓN. La conversión pasa acá para que
// nadie tenga que acordarse de dividir por cien.
// ─────────────────────────────────────────────────────────────────────────────

const MESES_EDITABLES = 24;

// Los últimos N meses terminando en el actual, del más nuevo al más viejo.
function ultimosMeses(cantidad: number): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = 0; i < cantidad; i++) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function SolapaDatos({ indicadores }: { indicadores: IndicadorMensual[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState('');

  const guardar = useMutation({
    mutationFn: (datos: { periodo: string; ventas?: number | null; inflacion?: number | null }) =>
      apiPut('/api/indicadores', datos),
    onSuccess: async (_d, v) => {
      setError('');
      setGuardado(v.periodo);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['indicadores'] }),
        queryClient.invalidateQueries({ queryKey: ['informe-precios'] }),
      ]);
      setTimeout(() => setGuardado(''), 1500);
    },
    onError: (e: Error) => setError(e.message),
  });

  const porMes = useMemo(() => new Map(indicadores.map((i) => [i.periodo, i])), [indicadores]);
  const meses = useMemo(() => ultimosMeses(MESES_EDITABLES), []);
  const faltan = meses.filter((m) => {
    const d = porMes.get(m);
    return !d || d.ventas === null || d.inflacion === null;
  }).length;

  return (
    <div className="section">
      <div className="section-title">Ventas e inflación</div>
      <div className="note">
        Los dos únicos datos que no salen de 3c: se cargan a mano una vez por mes. Las{' '}
        <strong>ventas</strong> alimentan la solapa de Indicadores; la <strong>inflación</strong> es contra lo que se
        compara la canasta y lo que decide qué productos subieron por encima del mercado. La inflación se escribe en{' '}
        <strong>porcentaje</strong> (2,1 = 2,1%). Cada campo se guarda solo al salir.
        {faltan > 0 && (
          <>
            {' '}
            Faltan datos en <strong>{faltan}</strong> de los últimos {MESES_EDITABLES} meses.
          </>
        )}
      </div>

      {error && (
        <div className="info-box" style={{ background: '#fdf3f3', borderColor: '#f0d2d2', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Mes</th>
              <th className="num">Ventas del mes</th>
              <th className="num">Inflación (%)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {meses.map((mes) => (
              <FilaMes
                key={mes}
                mes={mes}
                dato={porMes.get(mes)}
                guardado={guardado === mes}
                onGuardar={(campos) => guardar.mutate({ periodo: mes, ...campos })}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaMes({
  mes,
  dato,
  guardado,
  onGuardar,
}: {
  mes: string;
  dato: IndicadorMensual | undefined;
  guardado: boolean;
  onGuardar: (campos: { ventas?: number | null; inflacion?: number | null }) => void;
}) {
  // Lo cargado es la fuente de verdad; el estado local solo existe mientras se tipea.
  const ventasGuardadas = dato?.ventas ?? null;
  const inflGuardada = dato?.inflacion ?? null;
  const [ventas, setVentas] = useState<string | null>(null);
  const [infl, setInfl] = useState<string | null>(null);

  const valorVentas = ventas ?? (ventasGuardadas === null ? '' : String(ventasGuardadas));
  const valorInfl = infl ?? (inflGuardada === null ? '' : String(Math.round(inflGuardada * 10000) / 100));

  // Guarda solo si el valor cambió: salir del campo sin tocar nada no dispara nada.
  const confirmarVentas = () => {
    if (ventas === null) return;
    const limpio = ventas.trim();
    const n = limpio === '' ? null : Number(limpio.replace(',', '.'));
    setVentas(null);
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== ventasGuardadas) onGuardar({ ventas: n });
  };

  const confirmarInfl = () => {
    if (infl === null) return;
    const limpio = infl.trim();
    const pct = limpio === '' ? null : Number(limpio.replace(',', '.'));
    setInfl(null);
    if (pct !== null && !Number.isFinite(pct)) return;
    const fraccion = pct === null ? null : Math.round((pct / 100) * 1e6) / 1e6;
    if (fraccion !== inflGuardada) onGuardar({ inflacion: fraccion });
  };

  const falta = ventasGuardadas === null || inflGuardada === null;

  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{cap(mesLargo(mes))}</td>
      <td className="num">
        <input
          className="search"
          style={{ width: 150, textAlign: 'right', padding: '6px 10px', minWidth: 0 }}
          inputMode="decimal"
          placeholder="—"
          value={valorVentas}
          onChange={(e) => setVentas(e.target.value)}
          onBlur={confirmarVentas}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {ventasGuardadas !== null && (
          <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 11 }}>{fMjs(ventasGuardadas)}</span>
        )}
      </td>
      <td className="num">
        <input
          className="search"
          style={{ width: 90, textAlign: 'right', padding: '6px 10px', minWidth: 0 }}
          inputMode="decimal"
          placeholder="—"
          value={valorInfl}
          onChange={(e) => setInfl(e.target.value)}
          onBlur={confirmarInfl}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </td>
      <td style={{ width: 90 }}>
        {guardado ? (
          <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 12 }}>✓ guardado</span>
        ) : falta ? (
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>falta cargar</span>
        ) : null}
      </td>
    </tr>
  );
}
