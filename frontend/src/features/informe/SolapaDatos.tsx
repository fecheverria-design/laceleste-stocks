import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '../../shared/api/client';
import type { IndicadorMensual, InflacionModo } from '../../shared/api/types';
import { cap, fMjs, mesLargo } from './formato';

// ─────────────────────────────────────────────────────────────────────────────
// Carga manual de ventas e inflación. Son los dos datos que no salen de 3c ni de ningún
// sync: los carga el área de compras a principio de mes.
//
// Vive dentro del informe, que es donde se usan. Cada campo guarda al salir del foco: son
// dos números por mes, un botón "Guardar" sería un paso de más.
//
// La inflación se carga en la columna que uno tenga a mano —mensual o acumulada del año— y
// la otra aparece calculada, en gris. Antes había una sola columna y qué significaba vivía
// en un comentario del código: el 05/08/2026 se cargó la serie acumulada ahí y el informe
// pasó a comparar la canasta contra una inflación mensual del 17% sin decir una palabra.
//
// Se muestran en % y se guardan como FRACCIÓN. La conversión pasa acá para que nadie tenga
// que acordarse de dividir por cien.
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

/** Fracción → texto en % para el input, sin arrastrar decimales de punto flotante. */
const aPct = (v: number | null): string => (v === null ? '' : String(Math.round(v * 10000) / 100));

export function SolapaDatos({ indicadores }: { indicadores: IndicadorMensual[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState('');

  const guardar = useMutation({
    mutationFn: (datos: {
      periodo: string;
      ventas?: number | null;
      inflacion?: number | null;
      inflacion_modo?: InflacionModo;
    }) => apiPut('/api/indicadores', datos),
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
    return !d || d.ventas === null || d.inflacion_mensual === null;
  }).length;

  return (
    <div className="section">
      <div className="section-title">Ventas e inflación</div>
      <div className="note">
        Los dos únicos datos que no salen de 3c: se cargan a mano una vez por mes. Las{' '}
        <strong>ventas</strong> alimentan la solapa de Indicadores; la <strong>inflación</strong> es contra lo que se
        compara la canasta y lo que decide qué productos subieron por encima del mercado. Cada campo se guarda solo al
        salir.
        {faltan > 0 && (
          <>
            {' '}
            Faltan datos en <strong>{faltan}</strong> de los últimos {MESES_EDITABLES} meses.
          </>
        )}
      </div>

      <div className="info-box" style={{ marginBottom: 12 }}>
        <strong>La inflación se carga en la columna que tengas a mano</strong> y la otra se calcula sola (aparece en{' '}
        <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>gris</span>). <strong>Mensual</strong> es la
        variación del mes; <strong>acumulada del año</strong> arranca de cero cada enero. Se escriben en{' '}
        <strong>porcentaje</strong> (2,1 = 2,1%). El informe usa siempre la mensual, así que si cargás la acumulada
        necesita el mes anterior para poder despejarla.
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
              <th className="num">Inflación mensual (%)</th>
              <th className="num">Acumulada del año (%)</th>
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
  onGuardar: (campos: { ventas?: number | null; inflacion?: number | null; inflacion_modo?: InflacionModo }) => void;
}) {
  // Lo cargado es la fuente de verdad; el estado local solo existe mientras se tipea.
  const ventasGuardadas = dato?.ventas ?? null;
  const modo = dato?.inflacion_modo ?? 'MENSUAL';
  const cargada = dato?.inflacion ?? null;

  // Cada columna muestra el número tipeado si es la que se cargó, y el derivado si no.
  const mensualGuardada = modo === 'MENSUAL' && cargada !== null ? cargada : (dato?.inflacion_mensual ?? null);
  const acumGuardada = modo === 'ACUMULADA' && cargada !== null ? cargada : (dato?.inflacion_acumulada ?? null);
  const fuenteEsMensual = cargada !== null && modo === 'MENSUAL';
  const fuenteEsAcum = cargada !== null && modo === 'ACUMULADA';

  const [ventas, setVentas] = useState<string | null>(null);
  const [mensual, setMensual] = useState<string | null>(null);
  const [acum, setAcum] = useState<string | null>(null);

  const valorVentas = ventas ?? (ventasGuardadas === null ? '' : String(ventasGuardadas));

  // Guarda solo si el valor cambió: salir del campo sin tocar nada no dispara nada.
  const confirmarVentas = () => {
    if (ventas === null) return;
    const limpio = ventas.trim();
    const n = limpio === '' ? null : Number(limpio.replace(',', '.'));
    setVentas(null);
    if (n !== null && !Number.isFinite(n)) return;
    if (n !== ventasGuardadas) onGuardar({ ventas: n });
  };

  // Tipear en una columna define con qué modo se guarda el mes: el número y su significado
  // viajan siempre juntos.
  const confirmarInfl = (
    texto: string | null,
    limpiar: (v: null) => void,
    guardadoActual: number | null,
    inflacion_modo: InflacionModo,
  ) => {
    if (texto === null) return;
    const limpio = texto.trim();
    const pct = limpio === '' ? null : Number(limpio.replace(',', '.'));
    limpiar(null);
    if (pct !== null && !Number.isFinite(pct)) return;
    const fraccion = pct === null ? null : Math.round((pct / 100) * 1e6) / 1e6;
    if (fraccion === null && cargada === null) return; // borrar lo que ya está vacío
    if (fraccion !== null && guardadoActual !== null && Math.abs(fraccion - guardadoActual) < 1e-9) return;
    onGuardar(fraccion === null ? { inflacion: null } : { inflacion: fraccion, inflacion_modo });
  };

  const falta = ventasGuardadas === null || mensualGuardada === null;

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
      <CeldaInflacion
        valor={mensual ?? aPct(mensualGuardada)}
        derivado={!fuenteEsMensual && mensualGuardada !== null}
        titulo={fuenteEsAcum ? 'Calculada a partir de la acumulada del año' : undefined}
        onChange={setMensual}
        onBlur={() => confirmarInfl(mensual, setMensual, mensualGuardada, 'MENSUAL')}
      />
      <CeldaInflacion
        valor={acum ?? aPct(acumGuardada)}
        derivado={!fuenteEsAcum && acumGuardada !== null}
        titulo={fuenteEsMensual ? 'Calculada componiendo las mensuales del año' : undefined}
        onChange={setAcum}
        onBlur={() => confirmarInfl(acum, setAcum, acumGuardada, 'ACUMULADA')}
      />
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

// El número derivado se muestra en gris e itálica: se distingue de un ojo de lo que cargaste
// vos, pero sigue siendo editable (tipear ahí cambia cuál de las dos columnas manda).
function CeldaInflacion({
  valor,
  derivado,
  titulo,
  onChange,
  onBlur,
}: {
  valor: string;
  derivado: boolean;
  titulo: string | undefined;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <td className="num">
      <input
        className="search"
        style={{
          width: 90,
          textAlign: 'right',
          padding: '6px 10px',
          minWidth: 0,
          color: derivado ? 'var(--muted)' : undefined,
          fontStyle: derivado ? 'italic' : undefined,
        }}
        inputMode="decimal"
        placeholder="—"
        title={derivado ? titulo : undefined}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </td>
  );
}
