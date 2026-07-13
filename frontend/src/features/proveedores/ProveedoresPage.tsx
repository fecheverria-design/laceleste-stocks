import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiGet, apiPost } from '../../shared/api/client';
import type { GastoMes, GastoProveedor, ProductoDeProveedor, Proveedor } from '../../shared/api/types';

const ars0 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
function arsCorto(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)} mil`;
  return `$${n.toFixed(0)}`;
}
const COLORS = ['#0284c7', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16'];
const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

// Querystring de filtros (familia + período), compartido por la lista, los gráficos y el detalle.
function buildQs(familia: string, desde: string, hasta: string): string {
  const p = new URLSearchParams();
  if (familia) p.set('familia', familia);
  if (desde) p.set('desde', desde);
  if (hasta) p.set('hasta', hasta);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function ProveedoresPage() {
  const queryClient = useQueryClient();
  const [familia, setFamilia] = useState(''); // '' = todas
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');

  // Querystring de filtros del gasto (familia + período).
  const gastoQs = () => buildQs(familia, desde, hasta);
  // Alta
  const [nuevoNum, setNuevoNum] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoCuit, setNuevoCuit] = useState('');
  const [mostrarAlta, setMostrarAlta] = useState(false);

  const proveedores = useQuery({
    queryKey: ['proveedores', familia, desde, hasta],
    queryFn: () => apiGet<Proveedor[]>(`/api/proveedores${gastoQs()}`),
  });
  const familias = useQuery({ queryKey: ['familias'], queryFn: () => apiGet<string[]>('/api/familias') });
  const gasto = useQuery({
    queryKey: ['gasto-proveedores', familia, desde, hasta],
    queryFn: () => apiGet<GastoProveedor[]>(`/api/proveedores/gasto${gastoQs()}`),
  });
  const mensual = useQuery({
    queryKey: ['gasto-mensual', familia, desde, hasta],
    queryFn: () => apiGet<GastoMes[]>(`/api/proveedores/gasto-mensual${gastoQs()}`),
  });

  const crear = useMutation({
    mutationFn: () =>
      apiPost('/api/proveedores', { numero_3c: Number(nuevoNum), nombre: nuevoNombre, cuit: nuevoCuit || undefined }),
    onSuccess: async () => {
      setNuevoNum('');
      setNuevoNombre('');
      setNuevoCuit('');
      setMostrarAlta(false);
      await queryClient.invalidateQueries({ queryKey: ['proveedores'] });
    },
  });

  // Gráfico: top 12 proveedores por gasto (sumando familias si no se filtró una).
  const chart = useMemo(() => {
    const porProv = new Map<string, number>();
    for (const g of gasto.data ?? []) porProv.set(g.nombre, (porProv.get(g.nombre) ?? 0) + Number(g.gasto_neto));
    return [...porProv.entries()]
      .map(([nombre, valor]) => ({ nombre, valor }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 12)
      .reverse();
  }, [gasto.data]);

  // Serie mensual + total del período (resuelve "no se sabe de cuánto es").
  const mesesChart = useMemo(
    () => (mensual.data ?? []).map((m) => ({ mes: m.mes, valor: Number(m.gasto_neto) })),
    [mensual.data],
  );
  const totalPeriodo = useMemo(
    () => (mensual.data ?? []).reduce((a, m) => a + Number(m.gasto_neto), 0),
    [mensual.data],
  );

  const q = texto.trim().toLowerCase();
  const filas = (proveedores.data ?? []).filter(
    (p) => !q || p.nombre.toLowerCase().includes(q) || String(p.numero_3c ?? '').includes(q),
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Proveedores</h2>
          <p className="text-sm text-slate-500">Gasto por proveedor (compras reales, neto sin IVA)</p>
        </div>
        <button
          onClick={() => setMostrarAlta((v) => !v)}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          {mostrarAlta ? 'Cerrar' : '+ Nuevo proveedor'}
        </button>
      </div>

      {mostrarAlta && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nuevoNum && nuevoNombre) crear.mutate();
          }}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            N° 3c (obligatorio)
            <input type="number" className={inputCls} value={nuevoNum} onChange={(e) => setNuevoNum(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Nombre (obligatorio)
            <input className={`${inputCls} w-64`} value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            CUIT
            <input className={inputCls} value={nuevoCuit} onChange={(e) => setNuevoCuit(e.target.value)} />
          </label>
          <button
            type="submit"
            disabled={crear.isPending || !nuevoNum || !nuevoNombre}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {crear.isPending ? 'Creando…' : 'Crear'}
          </button>
          {crear.isError && <span className="text-sm text-rose-700">{(crear.error as Error).message}</span>}
        </form>
      )}

      {/* Barra de filtros: familia + período + total */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Familia
            <select className={inputCls} value={familia} onChange={(e) => setFamilia(e.target.value)}>
              <option value="">Todas</option>
              {(familias.data ?? []).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Desde
            <input type="date" className={inputCls} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Hasta
            <input type="date" className={inputCls} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
          {(desde || hasta || familia) && (
            <button
              onClick={() => {
                setFamilia('');
                setDesde('');
                setHasta('');
              }}
              className="pb-2 text-sm font-medium text-sky-600 hover:underline"
            >
              Limpiar
            </button>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Gasto del período {familia && `· ${familia}`}</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900">{ars0.format(totalPeriodo)}</p>
        </div>
      </div>

      {/* Gasto mensual */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Gasto por mes (neto)</h3>
        {mesesChart.length === 0 ? (
          <p className="text-sm text-slate-500">Sin compras para este filtro.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={mesesChart} margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis
                tickFormatter={arsCorto}
                width={64}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [ars0.format(Number(v)), 'Gasto neto']}
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="valor" fill="#0284c7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Gráfico de gasto por proveedor (top 12) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Gasto por proveedor (top 12)</h3>
        {chart.length === 0 ? (
          <p className="text-sm text-slate-500">Sin compras para este filtro.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 32)}>
            <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <XAxis
                type="number"
                tickFormatter={arsCorto}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
              />
              <YAxis
                type="category"
                dataKey="nombre"
                width={180}
                tick={{ fontSize: 11, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [ars0.format(Number(v)), 'Gasto neto']}
                cursor={{ fill: '#f1f5f9' }}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                {chart.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Lista de proveedores */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
          <span className="text-xs text-slate-500">{filas.length} proveedores</span>
          <input
            type="search"
            className={inputCls}
            placeholder="Buscar nombre o N° 3c…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">N° 3c</th>
              <th className="px-4 py-3 font-medium">Proveedor</th>
              <th className="px-4 py-3 font-medium">CUIT</th>
              <th className="px-4 py-3 text-right font-medium">Compras</th>
              <th className="px-4 py-3 text-right font-medium">Gasto neto</th>
              <th className="px-4 py-3 font-medium">Familias</th>
            </tr>
          </thead>
          <tbody>
            {proveedores.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-slate-500">
                  Cargando…
                </td>
              </tr>
            )}
            {filas.map((p) => (
              <FilaProveedor key={p.id} p={p} familia={familia} desde={desde} hasta={hasta} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Fila de proveedor expandible: al clickearla despliega los productos que le compramos
// (de qué es su gasto). La query del detalle se dispara solo al abrir (enabled) y respeta
// los filtros de familia/período de la barra (queryKey incluye los filtros → refetch al cambiarlos).
function FilaProveedor({ p, familia, desde, hasta }: { p: Proveedor; familia: string; desde: string; hasta: string }) {
  const [abierto, setAbierto] = useState(false);
  const productos = useQuery({
    queryKey: ['proveedor-productos', p.id, familia, desde, hasta],
    queryFn: () => apiGet<ProductoDeProveedor[]>(`/api/proveedores/${p.id}/productos${buildQs(familia, desde, hasta)}`),
    enabled: abierto,
  });
  const items = productos.data ?? [];

  return (
    <>
      <tr
        onClick={() => setAbierto((v) => !v)}
        className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
      >
        <td className="px-4 py-2 font-mono text-xs text-slate-500">
          <span className="mr-1 inline-block w-3 text-slate-400">{abierto ? '▾' : '▸'}</span>
          {p.numero_3c ?? '—'}
        </td>
        <td className="px-4 py-2 text-slate-700">{p.nombre}</td>
        <td className="px-4 py-2 text-slate-500">{p.cuit ?? '—'}</td>
        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{p.compras}</td>
        <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
          {Number(p.gasto_neto) > 0 ? ars0.format(Number(p.gasto_neto)) : '—'}
        </td>
        <td className="px-4 py-2 text-xs text-slate-500">{(p.familias ?? []).join(', ') || '—'}</td>
      </tr>
      {abierto && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={6} className="px-4 py-3">
            {productos.isLoading ? (
              <p className="text-xs text-slate-500">Cargando productos…</p>
            ) : productos.isError ? (
              <p className="text-xs text-rose-600">No se pudo cargar el detalle.</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-slate-500">
                Sin compras de insumos reales para este proveedor{familia || desde || hasta ? ' en el filtro elegido' : ''}.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-slate-400">
                    <th className="py-1 pr-4 font-medium">Producto</th>
                    <th className="py-1 pr-4 font-medium">Familia</th>
                    <th className="py-1 pr-4 text-right font-medium">Compras</th>
                    <th className="py-1 text-right font-medium">Gasto neto</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.producto_3c} className="border-t border-slate-200/70">
                      <td className="py-1 pr-4 text-slate-700">
                        {it.producto_nombre}
                        <span className="ml-1 font-mono text-slate-400">#{it.producto_3c}</span>
                      </td>
                      <td className="py-1 pr-4 text-slate-500">{it.familia ?? '—'}</td>
                      <td className="py-1 pr-4 text-right tabular-nums text-slate-600">{it.compras}</td>
                      <td className="py-1 text-right font-medium tabular-nums text-slate-900">
                        {ars0.format(Number(it.gasto_neto))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
