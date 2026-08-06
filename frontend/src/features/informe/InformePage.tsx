import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, descargarArchivo } from '../../shared/api/client';
import type { Comprador, IndicadorMensual, InformeCompradores, InformePrecios } from '../../shared/api/types';
import { cap, fMjs, inflacionAcumulada, mesLargo } from './formato';
import { SolapaAhorro } from './SolapaAhorro';
import { SolapaCanasta } from './SolapaCanasta';
import { SolapaComprador } from './SolapaComprador';
import { SolapaDatos } from './SolapaDatos';
import { SolapaMatriz } from './SolapaMatriz';
import './informe.css';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Compras — Prioridad A.
//
// Reproduce dentro de la app el informe que J generaba con un Apps Script sobre planillas:
// mismas solapas, mismos gráficos y mismos colores (ver informe.css). Las fórmulas están
// documentadas en docs/INFORME-COMPRAS.md.
//
// Dos solapas del original todavía no se pueden calcular porque dependen de datos que se
// cargan a mano y aún no existen en la app (ventas e inflación). Se muestran igual, pero
// deshabilitadas y diciendo qué falta: es información, no un hueco.
// ─────────────────────────────────────────────────────────────────────────────

// La "Evolución de precios" del informe original no está: la hoja de Precios ya muestra la
// serie de cada producto y no tenía sentido duplicarla (decisión de J, 2026-08-03).
type Solapa = 'comprador' | 'ahorro' | 'matriz' | 'canasta' | 'datos';

const SOLAPAS: Array<{ id: Solapa; texto: string }> = [
  { id: 'comprador', texto: 'Por Comprador' },
  { id: 'ahorro', texto: 'Ahorro potencial' },
  { id: 'matriz', texto: 'Matriz & Variación' },
  { id: 'canasta', texto: 'Canasta A' },
  { id: 'datos', texto: 'Ventas e inflación' },
];

// Lo que falta para completar el informe original. Se listan como solapas apagadas.
const PENDIENTES = [{ texto: 'Indicadores', falta: 'los ratios contra ventas' }];

export function InformePage() {
  const [solapa, setSolapa] = useState<Solapa>('comprador');
  const [mes, setMes] = useState('');

  const meses = useQuery({ queryKey: ['informe-meses'], queryFn: () => apiGet<string[]>('/api/informe/meses') });
  const mesActivo = mes || meses.data?.[0] || '';
  const habilitado = mesActivo !== '';

  // Un informe por comprador: así cada tarjeta trae su propio detalle de proveedores y
  // productos ya atribuido, y el total del mes es la suma de los dos.
  const lautaro = useQuery({
    queryKey: ['informe', mesActivo, 'Lautaro'],
    queryFn: () => apiGet<InformeCompradores>(`/api/informe/compradores?mes=${mesActivo}&comprador=Lautaro`),
    enabled: habilitado,
  });
  const fausto = useQuery({
    queryKey: ['informe', mesActivo, 'Fausto'],
    queryFn: () => apiGet<InformeCompradores>(`/api/informe/compradores?mes=${mesActivo}&comprador=Fausto`),
    enabled: habilitado,
  });
  const precios = useQuery({
    queryKey: ['informe-precios', mesActivo],
    queryFn: () => apiGet<InformePrecios>(`/api/informe/precios?mes=${mesActivo}&meses=12`),
    enabled: habilitado,
  });

  const indicadores = useQuery({
    queryKey: ['indicadores'],
    queryFn: () => apiGet<IndicadorMensual[]>('/api/indicadores'),
  });

  // Ventas e inflación alineadas contra la ventana del informe. Un mes sin cargar queda
  // null y se propaga como "—": nunca se rellena con cero.
  const serie = useMemo(() => {
    const meses = precios.data?.canasta.meses ?? [];
    const porMes = new Map((indicadores.data ?? []).map((i) => [i.periodo, i]));
    // Siempre la MENSUAL: si se cargó acumulada, el backend ya la descompuso. El informe no
    // se entera de cómo se tipeó el dato.
    const inflacion = meses.map((m) => porMes.get(m)?.inflacion_mensual ?? null);
    return {
      meses,
      inflacion,
      ventanas: {
        '1': inflacionAcumulada(inflacion, 1),
        '3': inflacionAcumulada(inflacion, 3),
        '6': inflacionAcumulada(inflacion, 6),
      },
      ventasDelMes: porMes.get(mesActivo)?.ventas ?? null,
      ventasMesAnterior: meses.length > 1 ? (porMes.get(meses[meses.length - 2]!)?.ventas ?? null) : null,
    };
  }, [precios.data, indicadores.data, mesActivo]);

  // Cuántos productos A subieron por encima de la inflación del mes.
  const sobreInflacion = useMemo(() => {
    const infl = serie.ventanas['1'];
    if (infl === null || !precios.data) return null;
    const conDato = precios.data.variacion_ventanas.filter((v) => v.var_1 !== null);
    return { cuantos: conDato.filter((v) => v.var_1! > infl).length, de: conDato.length, infl };
  }, [precios.data, serie]);

  const informes = useMemo(
    (): Partial<Record<Comprador, InformeCompradores>> => ({ Lautaro: lautaro.data, Fausto: fausto.data }),
    [lautaro.data, fausto.data],
  );

  const gastoLautaro = lautaro.data?.resumen.gasto ?? 0;
  const gastoFausto = fausto.data?.resumen.gasto ?? 0;
  const cargando = lautaro.isLoading || fausto.isLoading || precios.isLoading;
  const error = lautaro.isError || fausto.isError || precios.isError;

  const p = precios.data;
  const productosA = p?.matriz.length ?? 0;
  const conCobertura = p?.cobertura.c3 ?? 0;

  return (
    <div className="inf">
      <div className="header">
        <div className="left">
          <div className="logo">LC</div>
          <div className="htxt">
            <h1>Informe de Compras — Prioridad A</h1>
            <p>
              Panadería La Celeste · Productos categoría A · MP · Packaging · Descartables ·{' '}
              {mesActivo ? cap(mesLargo(mesActivo)) : '—'}
            </p>
          </div>
        </div>
        <select className="period" value={mesActivo} onChange={(e) => setMes(e.target.value)}>
          {(meses.data ?? []).map((m) => (
            <option key={m} value={m}>
              {mesLargo(m).toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      <div className="bignums">
        <div className="bignum">
          <div className="label">Gasto del mes</div>
          <div className="value">{fMjs(gastoLautaro + gastoFausto)}</div>
          <div className="sub">
            Lautaro {fMjs(gastoLautaro)} · Fausto {fMjs(gastoFausto)}
          </div>
        </div>
        <div className="bignum">
          <div className="label">Ventas del mes</div>
          <div className="value" style={serie.ventasDelMes === null ? { color: 'var(--muted)' } : undefined}>
            {fMjs(serie.ventasDelMes)}
          </div>
          <div className="sub">
            {serie.ventasDelMes === null ? (
              <button
                type="button"
                onClick={() => setSolapa('datos')}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan-d)', cursor: 'pointer' }}
              >
                cargar las ventas →
              </button>
            ) : serie.ventasMesAnterior ? (
              `vs ${fMjs(serie.ventasMesAnterior)} mes ant. (${
                serie.ventasDelMes / serie.ventasMesAnterior - 1 >= 0 ? '+' : ''
              }${Math.round((serie.ventasDelMes / serie.ventasMesAnterior - 1) * 100)}%)`
            ) : (
              'sin mes anterior para comparar'
            )}
          </div>
        </div>
        <div className="bignum">
          <div className="label">Productos A</div>
          <div className="value">{productosA}</div>
          <div className="sub">prioritarios · monitoreados</div>
        </div>
        <div className="bignum">
          <div className="label">Cobertura ≥3 cot.</div>
          <div className="value" style={{ color: 'var(--green)' }}>
            {conCobertura}
            <span style={{ fontSize: 14, color: 'var(--ink2)' }}> / {productosA}</span>
          </div>
          <div className="sub">
            <span style={{ color: 'var(--red)' }}>{productosA - conCobertura} con menos de 3</span>
          </div>
        </div>
        <div className="bignum">
          <div className="label">Sobre inflación</div>
          <div className="value" style={{ color: sobreInflacion ? 'var(--orange-d)' : 'var(--muted)' }}>
            {sobreInflacion ? sobreInflacion.cuantos : '—'}
          </div>
          <div className="sub">
            {sobreInflacion ? (
              `de ${sobreInflacion.de} A · infl ${(sobreInflacion.infl * 100).toFixed(1)}%`
            ) : (
              <button
                type="button"
                onClick={() => setSolapa('datos')}
                style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan-d)', cursor: 'pointer' }}
              >
                cargar la inflación →
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tabs">
        {SOLAPAS.map((s) => (
          <div
            key={s.id}
            className={`tab${solapa === s.id ? ' active' : ''}`}
            onClick={() => setSolapa(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setSolapa(s.id)}
          >
            {s.texto}
          </div>
        ))}
        {PENDIENTES.map((s) => (
          <div
            key={s.texto}
            className="tab"
            style={{ opacity: 0.5, cursor: 'not-allowed' }}
            title={`Falta cargar ${s.falta}`}
          >
            {s.texto} ⏳
          </div>
        ))}
      </div>

      {cargando && <div className="section">Cargando…</div>}
      {error && (
        <div className="section" style={{ color: 'var(--red)' }}>
          No se pudo cargar el informe.
        </div>
      )}

      {!cargando && !error && habilitado && (
        <>
          {solapa === 'comprador' && <SolapaComprador mes={mesActivo} informes={informes} />}
          {solapa === 'ahorro' && p && <SolapaAhorro mes={mesActivo} ahorro={p.ahorro} />}
          {solapa === 'matriz' && p && (
            <SolapaMatriz
              mes={mesActivo}
              matriz={p.matriz}
              cobertura={p.cobertura}
              control={p.control}
              variaciones={p.variacion_ventanas}
              inflacionVentana={serie.ventanas}
              onCargarDatos={() => setSolapa('datos')}
            />
          )}
          {solapa === 'canasta' && p && (
            <SolapaCanasta
              canasta={p.canasta}
              inflacionMensual={serie.inflacion}
              onCargarDatos={() => setSolapa('datos')}
            />
          )}
          {solapa === 'datos' && <SolapaDatos indicadores={indicadores.data ?? []} />}

          <div className="controls" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="fbtn"
              onClick={() => void descargarArchivo(`/api/informe/export.csv?mes=${mesActivo}`, `informe-compras-${mesActivo}.csv`)}
            >
              ⬇ Gasto por producto (CSV)
            </button>
            <button
              type="button"
              className="fbtn"
              onClick={() => void descargarArchivo(`/api/informe/matriz.csv?mes=${mesActivo}`, `informe-matriz-${mesActivo}.csv`)}
            >
              ⬇ Matriz de precios (CSV)
            </button>
            <button
              type="button"
              className="fbtn"
              onClick={() => void descargarArchivo(`/api/informe/ahorro.csv?mes=${mesActivo}`, `informe-ahorro-${mesActivo}.csv`)}
            >
              ⬇ Ahorro potencial (CSV)
            </button>
          </div>
        </>
      )}

      <div className="footer">
        Panadería La Celeste · Área de Compras · Solo prioridad A (MP / Packaging / Descartables) · El gasto va con
        IVA; el precio sale de la hoja de Precios (última compra tildada).
      </div>
    </div>
  );
}
