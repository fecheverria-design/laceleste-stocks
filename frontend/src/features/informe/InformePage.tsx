import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiGet, descargarArchivo } from '../../shared/api/client';
import { IconoDescarga } from '../../shared/components/iconos';
import { CLS_BOTON, ThOrden } from '../../shared/components/tabla';
import { EncabezadoPagina, EtiquetaFamilia, Panel, Tarjeta, Vacio } from '../../shared/components/ui';
import type {
  Comprador,
  EvolucionGasto,
  FilaProductoInforme,
  FilaProveedorInforme,
  InformeCompradores,
} from '../../shared/api/types';

// ─────────────────────────────────────────────────────────────────────────────
// Informe de Compras — "Por Comprador". Reproduce el informe que J hacía con Apps Script:
// el gasto real del mes por proveedor y por producto, con la variación contra el mes
// anterior. El gasto va CON IVA para poder compararlo contra la planilla.
// ─────────────────────────────────────────────────────────────────────────────

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function mesLargo(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MESES[Number(m) - 1] ?? m} ${a}`;
}

// Variación con color y signo. El gris del "—" es a propósito: sin mes anterior con qué
// comparar no hay variación, y un 0% ahí sería mentira.
function Variacion({ v, invertirColor = false }: { v: number | null; invertirColor?: boolean }) {
  if (v === null) return <span className="text-slate-300">—</span>;
  const pct = v * 100;
  const nulo = Math.abs(pct) < 0.05;
  // En precios, subir es malo. En gasto es solo información, así que va neutro.
  const color = nulo || invertirColor ? 'text-slate-600' : pct > 0 ? 'text-rose-600' : 'text-emerald-600';
  return (
    <span className={`tabular-nums ${color}`}>
      {pct > 0 && !nulo ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

type OrdenProv = 'nombre' | 'gasto' | 'var_gasto' | 'var_precio';
type OrdenProd = 'nombre' | 'gasto' | 'cantidad' | 'precio' | 'var_precio';

// Paleta de las líneas, en el mismo orden que el ranking (el proveedor más grande se lleva
// el celeste de la marca).
const PALETA = ['#0284c7', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#65a30d'];
const AUMENTO = '#e11d48';
const BAJA = '#0d9488';

function arsCorto(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)} MM`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(0)} M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)} mil`;
  return `$${n.toFixed(0)}`;
}

// Título de sección, para separar los bloques del informe sin que compitan con el h2.
function Seccion({ titulo, nota, acciones }: { titulo: string; nota?: string; acciones?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
        {nota && <p className="text-xs text-slate-400">{nota}</p>}
      </div>
      {acciones}
    </div>
  );
}

// Grupo de botones tipo pestaña, el mismo que usa el filtro de comprador.
function Pestanas<T extends string>({
  valor,
  opciones,
  onCambio,
}: {
  valor: T;
  opciones: ReadonlyArray<readonly [T, string]>;
  onCambio: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
      {opciones.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onCambio(v)}
          className={`px-3 py-1.5 text-sm transition ${
            valor === v ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function InformePage() {
  const [mes, setMes] = useState('');
  const [comprador, setComprador] = useState<Comprador | ''>('');
  const [soloA, setSoloA] = useState(true);
  const [ordenProv, setOrdenProv] = useState<OrdenProv>('gasto');
  const [dirProv, setDirProv] = useState<'asc' | 'desc'>('desc');
  const [ordenProd, setOrdenProd] = useState<OrdenProd>('gasto');
  const [dirProd, setDirProd] = useState<'asc' | 'desc'>('desc');

  const [vistaEvolucion, setVistaEvolucion] = useState<'total' | 'proveedor'>('total');

  const meses = useQuery({ queryKey: ['informe-meses'], queryFn: () => apiGet<string[]>('/api/informe/meses') });
  // Sin mes elegido se muestra el último con compras cargadas.
  const mesActivo = mes || meses.data?.[0] || '';

  const qs = `?mes=${mesActivo}${comprador ? `&comprador=${comprador}` : ''}`;
  const informe = useQuery({
    queryKey: ['informe', mesActivo, comprador],
    queryFn: () => apiGet<InformeCompradores>(`/api/informe/compradores${qs}`),
    enabled: mesActivo !== '',
  });

  const evolucion = useQuery({
    queryKey: ['informe-evolucion', mesActivo, comprador],
    queryFn: () => apiGet<EvolucionGasto>(`/api/informe/evolucion${qs}&meses=12`),
    enabled: mesActivo !== '',
  });

  // Serie para el gráfico: una fila por mes, con el total y una clave por proveedor.
  const datosEvolucion = useMemo(() => {
    const e = evolucion.data;
    if (!e) return [];
    return e.meses.map((m, i) => {
      const fila: Record<string, string | number | null> = { mes: mesLargo(m), total: e.total[i] ?? 0 };
      for (const p of e.proveedores) fila[p.nombre] = p.serie[i] ?? null;
      return fila;
    });
  }, [evolucion.data]);

  const ordenar = <T,>(filas: T[], campo: keyof T, dir: 'asc' | 'desc'): T[] =>
    [...filas].sort((a, b) => {
      const x = a[campo];
      const y = b[campo];
      // Los null van siempre al fondo: son "sin dato", no un valor bajo.
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
      return dir === 'asc' ? cmp : -cmp;
    });

  const proveedores = useMemo(
    () => ordenar(informe.data?.proveedores ?? [], ordenProv as keyof FilaProveedorInforme, dirProv),
    [informe.data, ordenProv, dirProv],
  );

  const productos = useMemo(() => {
    const base = (informe.data?.productos ?? []).filter((p) => !soloA || p.clasificacion_abc === 'A');
    return ordenar(base, ordenProd as keyof FilaProductoInforme, dirProd);
  }, [informe.data, soloA, ordenProd, dirProd]);

  // Barras de variación (el "chVar" del informe): los productos que más se movieron en el
  // mes, ordenados de mayor suba a mayor baja. Se recortan a 12 para que se lean.
  const movimientosPrecio = useMemo(() => {
    const conVar = productos.filter((p) => p.var_precio !== null);
    const orden = [...conVar].sort((a, b) => (b.var_precio ?? 0) - (a.var_precio ?? 0));
    const top = [...orden.slice(0, 6), ...orden.slice(-6)];
    // Sin duplicados cuando hay menos de 12 productos con variación.
    const vistos = new Set<string>();
    return top
      .filter((p) => (vistos.has(p.producto_3c) ? false : vistos.add(p.producto_3c) !== undefined))
      .map((p) => ({
        nombre: p.nombre.length > 26 ? `${p.nombre.slice(0, 25)}…` : p.nombre,
        pct: (p.var_precio ?? 0) * 100,
        gasto: p.gasto,
      }));
  }, [productos]);

  const alternar = <T extends string>(campo: T, actual: T, dir: 'asc' | 'desc', setC: (c: T) => void, setD: (d: 'asc' | 'desc') => void) => {
    if (campo === actual) setD(dir === 'asc' ? 'desc' : 'asc');
    else {
      setC(campo);
      setD(campo === 'nombre' ? 'asc' : 'desc');
    }
  };

  const r = informe.data?.resumen;

  return (
    <div>
      <EncabezadoPagina
        titulo="Informe de Compras"
        bajada={
          informe.data
            ? `${mesLargo(informe.data.mes)} · gasto con IVA, comparado contra ${mesLargo(informe.data.mes_anterior)}`
            : 'Gasto del mes por comprador, proveedor y producto'
        }
        acciones={
          <button
            type="button"
            className={CLS_BOTON}
            disabled={!informe.data}
            onClick={() => void descargarArchivo(`/api/informe/export.csv${qs}`, `informe-compras-${mesActivo}.csv`)}
          >
            <IconoDescarga className="h-4 w-4" />
            Exportar CSV
          </button>
        }
      />

      {/* Filtros: mes y comprador, que son los dos ejes del informe. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <select
          value={mesActivo}
          onChange={(e) => setMes(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        >
          {(meses.data ?? []).map((m) => (
            <option key={m} value={m}>
              {mesLargo(m)}
            </option>
          ))}
        </select>

        <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {([['', 'Todos'], ['Lautaro', 'Lautaro'], ['Fausto', 'Fausto']] as const).map(([valor, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setComprador(valor as Comprador | '')}
              className={`px-3 py-2 text-sm transition ${
                comprador === valor ? 'bg-sky-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {informe.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {informe.isError && <p className="text-sm text-rose-600">No se pudo cargar el informe.</p>}

      {informe.data && r && (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta etiqueta="Gasto del mes" valor={ars.format(r.gasto)} detalle="con IVA" tono="celeste" />
            <Tarjeta
              etiqueta={`vs ${mesLargo(informe.data.mes_anterior)}`}
              valor={<Variacion v={r.var_gasto} invertirColor />}
              detalle={ars.format(r.gasto_anterior)}
            />
            <Tarjeta etiqueta="Proveedores" valor={r.proveedores} detalle={`${r.renglones} renglones de compra`} />
            <Tarjeta etiqueta="Productos" valor={r.productos} />
          </div>

          {/* Por comprador: solo cuando se ven todos, si no repite la tarjeta de arriba. */}
          {comprador === '' && informe.data.por_comprador.length > 1 && (
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {informe.data.por_comprador.map((c) => (
                <Tarjeta
                  key={c.comprador}
                  etiqueta={c.comprador}
                  valor={ars.format(c.gasto)}
                  detalle={
                    <>
                      vs mes anterior <Variacion v={c.var_gasto} invertirColor />
                    </>
                  }
                  onClick={() => setComprador(c.comprador)}
                />
              ))}
            </div>
          )}

          {/* Evolución del gasto — el gráfico de 12 meses del informe. */}
          <Seccion
            titulo="Evolución del gasto"
            nota="Últimos 12 meses, con IVA"
            acciones={
              <Pestanas
                valor={vistaEvolucion}
                opciones={[
                  ['total', 'Total'],
                  ['proveedor', 'Por proveedor'],
                ] as const}
                onCambio={setVistaEvolucion}
              />
            }
          />
          <Panel>
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={datosEvolucion} margin={{ top: 5, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={arsCorto}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip
                    formatter={(v) => (v === null || v === undefined ? '—' : ars.format(Number(v)))}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  {vistaEvolucion === 'total' ? (
                    <Line type="monotone" dataKey="total" name="Gasto" stroke="#0284c7" strokeWidth={2.5} dot={{ r: 3 }} />
                  ) : (
                    <>
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                      {(evolucion.data?.proveedores ?? []).map((p, i) => (
                        <Line
                          key={p.nombre}
                          type="monotone"
                          dataKey={p.nombre}
                          stroke={PALETA[i % PALETA.length]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls={false}
                        />
                      ))}
                    </>
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Variación de precio del mes — el "chVar": sube en rojo, baja en verde. */}
          {movimientosPrecio.length > 0 && (
            <>
              <Seccion
                titulo="Qué se movió de precio"
                nota={`Variación contra ${mesLargo(informe.data.mes_anterior)}${soloA ? ', solo prioridad A' : ''}`}
              />
              <Panel>
                <div className="p-4" style={{ height: Math.max(220, movimientosPrecio.length * 28 + 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={movimientosPrecio} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
                      <CartesianGrid stroke="#eef2f7" horizontal={false} />
                      <XAxis
                        type="number"
                        tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="nombre"
                        width={190}
                        tick={{ fill: '#475569', fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        formatter={(v) => {
                          const n = Number(v);
                          return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
                        }}
                        contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                      />
                      <ReferenceLine x={0} stroke="#cbd5e1" />
                      <Bar dataKey="pct" radius={3}>
                        {movimientosPrecio.map((m) => (
                          <Cell key={m.nombre} fill={m.pct > 0 ? AUMENTO : BAJA} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </>
          )}

          <Seccion titulo="Por proveedor" />
          <Panel>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <ThOrden campo="nombre" orden={ordenProv} dir={dirProv} onOrdenar={(c) => alternar(c, ordenProv, dirProv, setOrdenProv, setDirProv)}>
                    Proveedor
                  </ThOrden>
                  <ThOrden campo="gasto" orden={ordenProv} dir={dirProv} onOrdenar={(c) => alternar(c, ordenProv, dirProv, setOrdenProv, setDirProv)} alineado="der">
                    Gasto
                  </ThOrden>
                  <ThOrden campo="var_gasto" orden={ordenProv} dir={dirProv} onOrdenar={(c) => alternar(c, ordenProv, dirProv, setOrdenProv, setDirProv)} alineado="der">
                    Var. gasto
                  </ThOrden>
                  <ThOrden campo="var_precio" orden={ordenProv} dir={dirProv} onOrdenar={(c) => alternar(c, ordenProv, dirProv, setOrdenProv, setDirProv)} alineado="der">
                    Var. precio
                  </ThOrden>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {proveedores.map((p) => (
                  <tr key={`${p.proveedor_id ?? 's'}-${p.nombre}`} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="text-slate-900">{p.nombre}</span>
                      <span className="ml-2 text-xs text-slate-400">{p.productos} prod.</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{ars.format(p.gasto)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Variacion v={p.var_gasto} invertirColor />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Variacion v={p.var_precio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {proveedores.length === 0 && <Vacio mensaje="No hay compras en el mes con los filtros elegidos." />}
          </Panel>

          <Seccion
            titulo="Por producto"
            acciones={
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={soloA} onChange={(e) => setSoloA(e.target.checked)} className="rounded border-slate-300" />
                Solo prioridad A
              </label>
            }
          />
          <Panel>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <ThOrden campo="nombre" orden={ordenProd} dir={dirProd} onOrdenar={(c) => alternar(c, ordenProd, dirProd, setOrdenProd, setDirProd)}>
                    Producto
                  </ThOrden>
                  <th className="px-4 py-3 text-left font-medium">Familia</th>
                  <ThOrden campo="gasto" orden={ordenProd} dir={dirProd} onOrdenar={(c) => alternar(c, ordenProd, dirProd, setOrdenProd, setDirProd)} alineado="der">
                    Gasto
                  </ThOrden>
                  <ThOrden campo="cantidad" orden={ordenProd} dir={dirProd} onOrdenar={(c) => alternar(c, ordenProd, dirProd, setOrdenProd, setDirProd)} alineado="der">
                    Cantidad
                  </ThOrden>
                  <ThOrden campo="precio" orden={ordenProd} dir={dirProd} onOrdenar={(c) => alternar(c, ordenProd, dirProd, setOrdenProd, setDirProd)} alineado="der">
                    Precio prom.
                  </ThOrden>
                  <ThOrden campo="var_precio" orden={ordenProd} dir={dirProd} onOrdenar={(c) => alternar(c, ordenProd, dirProd, setOrdenProd, setDirProd)} alineado="der">
                    Var. precio
                  </ThOrden>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {productos.map((p) => (
                  <tr key={p.producto_3c} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <span className="text-slate-400">{p.producto_3c}</span> <span className="text-slate-900">{p.nombre}</span>
                      {p.clasificacion_abc === 'A' && (
                        <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200">A</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <EtiquetaFamilia familia={p.familia} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">{ars.format(p.gasto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{num2.format(p.cantidad)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {p.precio === null ? '—' : ars.format(p.precio)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Variacion v={p.var_precio} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {productos.length === 0 && (
              <Vacio
                mensaje={soloA ? 'No hay productos A comprados en el mes.' : 'No hay compras en el mes con los filtros elegidos.'}
                accion={
                  soloA ? (
                    <button type="button" className={CLS_BOTON} onClick={() => setSoloA(false)}>
                      Ver todos
                    </button>
                  ) : undefined
                }
              />
            )}
          </Panel>

          <p className="mt-4 text-xs text-slate-400">
            El gasto se mide con IVA (la columna «Valor total» de 3c). La variación de precio se calcula sobre el neto —
            un cambio de alícuota no es un aumento — y compara el precio promedio ponderado del mes contra el del mes
            anterior. Se excluyen servicios, esporádicos y productos de prueba.
          </p>
        </>
      )}
    </div>
  );
}
