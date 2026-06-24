import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiDelete, apiGet, apiPost, apiPut } from '../../shared/api/client';
import type { PrecioHistorial, PrecioVigente } from '../../shared/api/types';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const moneyCorto = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

// "2026-06-10" → "10/06" (eje del gráfico) / "10/06/26" (tablas).
const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const fechaCorta = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(2, 4)}`;
const hoyYmd = () => new Date().toISOString().slice(0, 10);

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

// ── Gráfico + historial editable de un producto ─────────────────────────────
function HistorialPrecios({ producto3c, unidad }: { producto3c: string; unidad: string }) {
  const queryClient = useQueryClient();
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState(hoyYmd());
  const [editId, setEditId] = useState<number | null>(null);
  const [editPrecio, setEditPrecio] = useState('');
  const [editFecha, setEditFecha] = useState('');

  const historial = useQuery({
    queryKey: ['precios-historial', producto3c],
    queryFn: () => apiGet<PrecioHistorial[]>(`/api/productos/${encodeURIComponent(producto3c)}/precios`),
  });

  const invalidar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['precios-historial', producto3c] }),
      queryClient.invalidateQueries({ queryKey: ['precios'] }),
    ]);

  const crear = useMutation({
    mutationFn: () =>
      apiPost('/api/precios', { producto_3c: producto3c, precio: Number(nuevoPrecio), vigente_desde: nuevaFecha }),
    onSuccess: async () => {
      setNuevoPrecio('');
      setNuevaFecha(hoyYmd());
      await invalidar();
    },
  });

  const editar = useMutation({
    mutationFn: (id: number) =>
      apiPut(`/api/precios/${id}`, { precio: Number(editPrecio), vigente_desde: editFecha }),
    onSuccess: async () => {
      setEditId(null);
      await invalidar();
    },
  });

  const borrar = useMutation({
    mutationFn: (id: number) => apiDelete(`/api/precios/${id}`),
    onSuccess: invalidar,
  });

  if (historial.isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Cargando historial…</p>;
  if (historial.isError)
    return <p className="px-4 py-3 text-sm text-rose-700">Error: {(historial.error as Error).message}</p>;

  const filas = historial.data ?? [];
  // El gráfico necesita orden ascendente por fecha.
  const serie = [...filas]
    .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
    .map((f) => ({ fecha: f.vigente_desde, precio: Number(f.precio) }));

  const empezarEdicion = (f: PrecioHistorial) => {
    setEditId(f.id);
    setEditPrecio(f.precio);
    setEditFecha(f.vigente_desde);
  };

  return (
    <div className="space-y-4 p-4">
      {serie.length >= 2 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Evolución del precio</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={serie} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="fecha"
                tickFormatter={ddmm}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#e2e8f0' }}
              />
              <YAxis
                width={56}
                tickFormatter={(v: number) => `$${moneyCorto.format(v)}`}
                tick={{ fontSize: 11, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v) => [money.format(Number(v)), 'Precio']}
                labelFormatter={(l) => fechaCorta(String(l))}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              />
              <Line
                type="monotone"
                dataKey="precio"
                stroke="#0284c7"
                strokeWidth={2}
                dot={{ r: 3, fill: '#0284c7' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cargar un precio nuevo */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nuevoPrecio !== '') crear.mutate();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Precio ($)
          <input
            type="number"
            step="0.0001"
            min="0"
            className={inputCls}
            value={nuevoPrecio}
            onChange={(e) => setNuevoPrecio(e.target.value)}
            placeholder="0,00"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Vigente desde
          <input type="date" className={inputCls} value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)} />
        </label>
        <button
          type="submit"
          disabled={crear.isPending || nuevoPrecio === ''}
          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
        >
          {crear.isPending ? 'Cargando…' : 'Cargar precio'}
        </button>
        {crear.isError && <span className="text-sm text-rose-700">{(crear.error as Error).message}</span>}
      </form>

      {/* Historial */}
      {filas.length === 0 ? (
        <p className="text-sm text-slate-500">Sin precios cargados todavía.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-2 font-medium">Vigente desde</th>
              <th className="py-2 text-right font-medium">Precio</th>
              <th className="py-2 font-medium">Unidad</th>
              <th className="py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) =>
              editId === f.id ? (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <input
                      type="date"
                      className={inputCls}
                      value={editFecha}
                      onChange={(e) => setEditFecha(e.target.value)}
                    />
                  </td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      className={`${inputCls} w-32 text-right`}
                      value={editPrecio}
                      onChange={(e) => setEditPrecio(e.target.value)}
                    />
                  </td>
                  <td className="py-2 text-slate-500">{unidad}</td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => editar.mutate(f.id)}
                      disabled={editar.isPending}
                      className="text-sm font-medium text-sky-600 hover:underline disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button onClick={() => setEditId(null)} className="ml-3 text-sm text-slate-500 hover:underline">
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">{fechaCorta(f.vigente_desde)}</td>
                  <td className="py-2 text-right font-medium tabular-nums text-slate-800">
                    {money.format(Number(f.precio))}
                  </td>
                  <td className="py-2 text-slate-500">{unidad}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => empezarEdicion(f)} className="text-sm font-medium text-sky-600 hover:underline">
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('¿Borrar este precio?')) borrar.mutate(f.id);
                      }}
                      disabled={borrar.isPending}
                      className="ml-3 text-sm text-rose-600 hover:underline disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
      {editar.isError && <p className="text-sm text-rose-700">{(editar.error as Error).message}</p>}
      {borrar.isError && <p className="text-sm text-rose-700">{(borrar.error as Error).message}</p>}
    </div>
  );
}

export function PreciosPage() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['precios'],
    queryFn: () => apiGet<PrecioVigente[]>('/api/precios'),
  });

  const q = texto.trim().toLowerCase();
  const filas = (data ?? []).filter((f) => {
    if (soloSinPrecio && f.precio !== null) return false;
    if (q && !f.producto_nombre.toLowerCase().includes(q) && !f.producto_3c.toLowerCase().includes(q)) return false;
    return true;
  });
  const conPrecio = (data ?? []).filter((f) => f.precio !== null).length;

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Precios</h2>
          <p className="text-sm text-slate-500">
            {data
              ? `${conPrecio} de ${data.length} productos con precio · tocá una fila para ver el historial`
              : 'Cargando…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloSinPrecio}
              onChange={(e) => setSoloSinPrecio(e.target.checked)}
              className="rounded border-slate-300"
            />
            Solo sin precio
          </label>
          <input
            type="search"
            className={inputCls}
            placeholder="Buscar código o producto…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && <p className="p-6 text-slate-500">Cargando precios…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && filas.length === 0 && <p className="p-6 text-slate-500">Ningún producto coincide con el filtro.</p>}
        {filas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Código 3c</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Precio vigente</th>
                <th className="px-4 py-3 font-medium">Vigente desde</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const open = abierto === f.producto_3c;
                return (
                  <Fragment key={f.producto_3c}>
                    <tr
                      onClick={() => setAbierto(open ? null : f.producto_3c)}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.producto_3c}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="mr-1.5 inline-block text-slate-400">{open ? '▾' : '▸'}</span>
                        {f.producto_nombre}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {f.precio === null ? (
                          <span className="text-slate-400">— sin precio</span>
                        ) : (
                          <span className="text-slate-900">{money.format(Number(f.precio))}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {f.vigente_desde ? fechaCorta(f.vigente_desde) : '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <td colSpan={4} className="px-2 py-2">
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <HistorialPrecios producto3c={f.producto_3c} unidad={f.unidad_base} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
