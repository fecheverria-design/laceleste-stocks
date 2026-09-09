import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, descargarArchivo } from '../../shared/api/client';
import type { Clasificacion, Desempeno, ItemDesempeno } from '../../shared/api/types';
import { BarraFiltros, Campo, type ChipFiltro } from '../../shared/components/filtros';
import { IconoDescarga, IconoLupa } from '../../shared/components/iconos';
import { CLS_BOTON, CLS_INPUT, Paginacion, ThOrden } from '../../shared/components/tabla';
import { EncabezadoPagina, Panel, Tarjeta, Vacio } from '../../shared/components/ui';

// Desempeño del depósito: lo que la app del compañero registró contra lo que el encargado
// cargó en 3c, por (área, producto) en el período. Son DOS números y no uno a propósito —
// cobertura (¿pasó por la app?) y fidelidad (¿coincide la cantidad?) miden cosas distintas.

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const LIMITE = 50;

const ETIQUETAS: Record<Clasificacion, string> = {
  EXACTO: 'Coincide',
  DENTRO_BULTO: 'Dentro de un bulto',
  DIFIERE: 'Difiere',
  SOLO_3C: 'No pasó por la app',
  SOLO_APP: '3c no lo tiene',
};

const COLORES: Record<Clasificacion, string> = {
  EXACTO: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DENTRO_BULTO: 'bg-teal-50 text-teal-700 ring-teal-200',
  DIFIERE: 'bg-amber-50 text-amber-700 ring-amber-200',
  SOLO_3C: 'bg-rose-50 text-rose-700 ring-rose-200',
  SOLO_APP: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function Marca({ clasificacion }: { clasificacion: Clasificacion }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${COLORES[clasificacion]}`}
    >
      {ETIQUETAS[clasificacion]}
    </span>
  );
}

const pct = (n: number | null) => (n === null ? '—' : `${nf.format(n)}%`);

type Columna = 'producto' | 'area' | 'app' | 'tresc' | 'diferencia';

export function DesempenoPage() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');
  const [area, setArea] = useState('');
  const [resultado, setResultado] = useState<'' | Clasificacion>('');
  const [abierto, setAbierto] = useState(false);
  const [orden, setOrden] = useState<Columna>('tresc');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (desde) p.set('desde', desde);
    if (hasta) p.set('hasta', hasta);
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [desde, hasta]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['desempeno', desde, hasta],
    queryFn: () => apiGet<Desempeno>(`/api/desempeno${qs}`),
  });

  const q = texto.trim().toLowerCase();
  const filtrados = useMemo(() => {
    const items = (data?.items ?? []).filter((i) => {
      if (area && String(i.area_dep_3c) !== area) return false;
      if (resultado && i.clasificacion !== resultado) return false;
      if (q && !i.producto_nombre.toLowerCase().includes(q) && !i.producto_3c.toLowerCase().includes(q)) return false;
      return true;
    });
    const signo = dir === 'asc' ? 1 : -1;
    const valor = (i: ItemDesempeno): number | string => {
      if (orden === 'producto') return i.producto_nombre;
      if (orden === 'area') return i.area_nombre;
      if (orden === 'app') return i.cantidad_app;
      if (orden === 'tresc') return i.cantidad_3c;
      return Math.abs(i.diferencia);
    };
    return [...items].sort((a, b) => {
      const va = valor(a);
      const vb = valor(b);
      if (typeof va === 'string' || typeof vb === 'string') return signo * String(va).localeCompare(String(vb));
      return signo * (va - vb);
    });
  }, [data, q, area, resultado, orden, dir]);

  const pagina = filtrados.slice((page - 1) * LIMITE, page * LIMITE);

  const ordenar = (c: Columna) => {
    if (c === orden) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setOrden(c);
      setDir(c === 'producto' || c === 'area' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const chips: ChipFiltro[] = [];
  if (desde) chips.push({ key: 'desde', label: `Desde: ${desde}`, onQuitar: () => setDesde('') });
  if (hasta) chips.push({ key: 'hasta', label: `Hasta: ${hasta}`, onQuitar: () => setHasta('') });
  if (area) {
    const nombre = data?.areas.find((a) => String(a.area_dep_3c) === area)?.area_nombre ?? area;
    chips.push({ key: 'area', label: `Área: ${nombre}`, onQuitar: () => setArea('') });
  }
  if (resultado) {
    chips.push({
      key: 'resultado',
      label: `Resultado: ${ETIQUETAS[resultado]}`,
      onQuitar: () => setResultado(''),
    });
  }
  const limpiar = () => {
    setDesde('');
    setHasta('');
    setArea('');
    setResultado('');
    setTexto('');
    setPage(1);
  };

  const total = data?.total;

  return (
    <section>
      <EncabezadoPagina
        titulo="Desempeño del depósito"
        bajada={
          data
            ? `${data.desde} → ${data.hasta} · lo que la app del compañero registró contra lo que se cargó en 3c`
            : 'Cargando…'
        }
        acciones={
          <button
            onClick={() => void descargarArchivo(`/api/desempeno/export.csv${qs}`, 'desempeno.csv')}
            className={CLS_BOTON}
            title="Descarga el detalle del período"
          >
            <IconoDescarga />
            Descargar CSV
          </button>
        }
      />

      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {isError && <p className="text-rose-600">{(error as Error).message}</p>}

      {data && (
        <>
          {data.aviso && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⚠ {data.aviso}
            </p>
          )}

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta
              etiqueta="Cobertura"
              valor={pct(total?.cobertura_pct ?? null)}
              detalle={`${nf.format(total?.registradas ?? 0)} de ${nf.format(total?.en_3c ?? 0)} pasaron también por la app`}
              tono="celeste"
            />
            <Tarjeta
              etiqueta="Fidelidad"
              valor={pct(total?.fidelidad_pct ?? null)}
              detalle={`${nf.format((total?.exactos ?? 0) + (total?.dentro_bulto ?? 0))} coinciden (${nf.format(total?.dentro_bulto ?? 0)} por tolerancia de bulto)`}
              tono="ok"
            />
            <Tarjeta
              etiqueta="No pasó por la app"
              valor={nf.format(total?.solo_3c ?? 0)}
              detalle="3c lo tiene y la app no"
              tono="alerta"
              onClick={() => {
                setResultado('SOLO_3C');
                setPage(1);
              }}
            />
            <Tarjeta
              etiqueta="Difieren"
              valor={nf.format(total?.difieren ?? 0)}
              detalle={`${nf.format(total?.solo_app ?? 0)} además están solo en la app`}
              onClick={() => {
                setResultado('DIFIERE');
                setPage(1);
              }}
            />
          </div>

          <p className="mb-5 text-xs text-slate-500">
            Se compara por (área, producto) en todo el período, nunca por día: el egreso de la tarde que se carga al
            día siguiente no es un error. La diferencia que entra en un bulto entero cuenta como bien abastecido.{' '}
            <strong className="font-medium text-slate-600">
              La cobertura mide qué parte de la operación pasa por la app del compañero, no el acierto del encargado.
            </strong>
          </p>

          {/* Resumen por área: dónde está concentrado lo que falta registrar. */}
          <Panel>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Área</th>
                  <th className="px-4 py-3 text-right font-medium">En 3c</th>
                  <th className="px-4 py-3 text-right font-medium">Registradas</th>
                  <th className="px-4 py-3 text-right font-medium">Cobertura</th>
                  <th className="px-4 py-3 text-right font-medium">Coinciden</th>
                  <th className="px-4 py-3 text-right font-medium">Difieren</th>
                  <th className="px-4 py-3 text-right font-medium">Fidelidad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.areas.map((a) => (
                  <tr
                    key={a.area_dep_3c}
                    className="cursor-pointer transition hover:bg-sky-50/50"
                    onClick={() => {
                      setArea(String(a.area_dep_3c));
                      setPage(1);
                    }}
                    title="Ver el detalle de esta área"
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800">{a.area_nombre}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{nf.format(a.en_3c)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{nf.format(a.registradas)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{pct(a.cobertura_pct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {nf.format(a.exactos + a.dentro_bulto)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{nf.format(a.difieren)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{pct(a.fidelidad_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Detalle por producto
          </h3>

          <BarraFiltros
            abierto={abierto}
            onToggle={() => setAbierto((v) => !v)}
            chips={chips}
            onLimpiar={limpiar}
            principal={
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <IconoLupa />
                </span>
                <input
                  value={texto}
                  onChange={(e) => {
                    setTexto(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Buscar producto o código…"
                  className={`${CLS_INPUT} w-72 pl-9`}
                />
              </div>
            }
            avanzados={
              <>
                <Campo label="Desde">
                  <input
                    type="date"
                    value={desde}
                    onChange={(e) => {
                      setDesde(e.target.value);
                      setPage(1);
                    }}
                    className={CLS_INPUT}
                  />
                </Campo>
                <Campo label="Hasta">
                  <input
                    type="date"
                    value={hasta}
                    onChange={(e) => {
                      setHasta(e.target.value);
                      setPage(1);
                    }}
                    className={CLS_INPUT}
                  />
                </Campo>
                <Campo label="Área">
                  <select
                    value={area}
                    onChange={(e) => {
                      setArea(e.target.value);
                      setPage(1);
                    }}
                    className={CLS_INPUT}
                  >
                    <option value="">Todas</option>
                    {data.areas.map((a) => (
                      <option key={a.area_dep_3c} value={a.area_dep_3c}>
                        {a.area_nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Resultado">
                  <select
                    value={resultado}
                    onChange={(e) => {
                      setResultado(e.target.value as '' | Clasificacion);
                      setPage(1);
                    }}
                    className={CLS_INPUT}
                  >
                    <option value="">Todos</option>
                    {(Object.keys(ETIQUETAS) as Clasificacion[]).map((c) => (
                      <option key={c} value={c}>
                        {ETIQUETAS[c]}
                      </option>
                    ))}
                  </select>
                </Campo>
              </>
            }
          />

          <Panel>
            {filtrados.length === 0 ? (
              <Vacio
                mensaje="No hay nada con esos filtros."
                accion={
                  <button onClick={limpiar} className="text-sm font-medium text-sky-600 hover:underline">
                    Limpiar filtros
                  </button>
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <ThOrden campo="producto" orden={orden} dir={dir} onOrdenar={ordenar}>
                          Producto
                        </ThOrden>
                        <ThOrden campo="area" orden={orden} dir={dir} onOrdenar={ordenar}>
                          Área
                        </ThOrden>
                        <ThOrden campo="app" orden={orden} dir={dir} onOrdenar={ordenar} alineado="der">
                          App
                        </ThOrden>
                        <ThOrden campo="tresc" orden={orden} dir={dir} onOrdenar={ordenar} alineado="der">
                          3c
                        </ThOrden>
                        <ThOrden campo="diferencia" orden={orden} dir={dir} onOrdenar={ordenar} alineado="der">
                          Diferencia
                        </ThOrden>
                        <th className="px-4 py-3 text-left font-medium">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagina.map((i) => (
                        <tr key={`${i.area_dep_3c}-${i.producto_3c}`} className="transition hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-800">{i.producto_nombre}</p>
                            <p className="text-xs text-slate-400">
                              {i.producto_3c}
                              {i.unidad_base ? ` · ${i.unidad_base}` : ''}
                              {i.unidades_por_bulto && i.unidades_por_bulto > 1
                                ? ` · bulto ${nf.format(i.unidades_por_bulto)}`
                                : ''}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{i.area_nombre}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                            {nf.format(i.cantidad_app)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                            {nf.format(i.cantidad_3c)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                              i.diferencia === 0 ? 'text-slate-400' : i.diferencia > 0 ? 'text-sky-700' : 'text-rose-600'
                            }`}
                          >
                            {i.diferencia > 0 ? '+' : ''}
                            {nf.format(i.diferencia)}
                            {i.diferencia_bultos !== null && i.diferencia !== 0 && (
                              <span className="ml-1 text-xs font-normal text-slate-400">
                                ({i.diferencia_bultos > 0 ? '+' : ''}
                                {nf.format(i.diferencia_bultos)} bulto{Math.abs(i.diferencia_bultos) === 1 ? '' : 's'})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <Marca clasificacion={i.clasificacion} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Paginacion page={page} limit={LIMITE} total={filtrados.length} onPage={setPage} />
              </>
            )}
          </Panel>

          {data.espejo && (
            <p className="mt-4 text-xs text-slate-400">
              El lado de 3c sale del export de movimientos que se importa una vez por semana: hoy cubre del{' '}
              {data.espejo.desde} al {data.espejo.hasta} ({nf.format(data.espejo.renglones)} renglones).
            </p>
          )}
        </>
      )}
    </section>
  );
}

export default DesempenoPage;
