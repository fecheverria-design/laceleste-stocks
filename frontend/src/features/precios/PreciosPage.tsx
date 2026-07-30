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
import { apiDelete, apiGet, apiPost, apiPut, descargarArchivo } from '../../shared/api/client';
import { BarraFiltros, type ChipFiltro } from '../../shared/components/filtros';
import { IconoDescarga, IconoLupa } from '../../shared/components/iconos';
import { CLS_BOTON, CLS_INPUT, ThOrden } from '../../shared/components/tabla';
import { EncabezadoPagina, EtiquetaFamilia, Panel, Tarjeta, Vacio } from '../../shared/components/ui';
import type { PrecioHistorial, PrecioVigente, TipoPrecio } from '../../shared/api/types';

// Columnas ordenables. Client-side: la hoja trae el precio vigente de todos los productos
// de una sola vez (~1.200 filas), así que ordenar acá es instantáneo.
type OrdenPrecio = 'codigo' | 'producto' | 'proveedor' | 'precio' | 'vigencia';

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

// Badge de tipo de precio: COMPRA (lo que se paga, manda) vs ACTUALIZACION (lista, referencia).
const TIPO_BADGE: Record<string, string> = {
  COMPRA: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ACTUALIZACION: 'bg-slate-100 text-slate-500 ring-slate-200',
};
function TipoBadge({ tipo }: { tipo: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TIPO_BADGE[tipo] ?? TIPO_BADGE.ACTUALIZACION}`}>
      {tipo === 'COMPRA' ? 'Compra' : 'Actualización'}
    </span>
  );
}

// Tooltip del gráfico de compras: fecha, precio y proveedor del punto.
interface PuntoCompra {
  fecha: string;
  precio: number;
  proveedor: string;
}
function TooltipCompra({ active, payload }: { active?: boolean; payload?: { payload: PuntoCompra }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-slate-700">{fechaCorta(p.fecha)}</div>
      <div className="tabular-nums text-slate-900">{money.format(p.precio)}</div>
      <div className="text-slate-500">{p.proveedor}</div>
    </div>
  );
}

// ── Gráfico + historial editable de un producto ─────────────────────────────
function HistorialPrecios({ producto3c, unidad }: { producto3c: string; unidad: string }) {
  const queryClient = useQueryClient();
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [nuevaFecha, setNuevaFecha] = useState(hoyYmd());
  const [nuevoTipo, setNuevoTipo] = useState<TipoPrecio>('COMPRA');
  const [editId, setEditId] = useState<number | null>(null);
  const [editPrecio, setEditPrecio] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editTipo, setEditTipo] = useState<TipoPrecio>('COMPRA');

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
      apiPost('/api/precios', {
        producto_3c: producto3c,
        precio: Number(nuevoPrecio),
        tipo: nuevoTipo,
        vigente_desde: nuevaFecha,
      }),
    onSuccess: async () => {
      setNuevoPrecio('');
      setNuevaFecha(hoyYmd());
      setNuevoTipo('COMPRA');
      await invalidar();
    },
  });

  const editar = useMutation({
    mutationFn: (id: number) =>
      apiPut(`/api/precios/${id}`, { precio: Number(editPrecio), tipo: editTipo, vigente_desde: editFecha }),
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
  // El gráfico usa SOLO las COMPRA (la curva real de costo), en orden ascendente.
  const serie = [...filas]
    .filter((f) => f.tipo === 'COMPRA')
    .sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))
    .map((f) => ({ fecha: f.vigente_desde, precio: Number(f.precio), proveedor: f.proveedor_nombre ?? '—' }));

  const empezarEdicion = (f: PrecioHistorial) => {
    setEditId(f.id);
    setEditPrecio(f.precio);
    setEditFecha(f.vigente_desde);
    setEditTipo(f.tipo);
  };

  return (
    <div className="space-y-4 p-4">
      {serie.length >= 2 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Evolución del precio de compra
          </p>
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
              <Tooltip content={<TooltipCompra />} />
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
          Tipo
          <select className={inputCls} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as TipoPrecio)}>
            <option value="COMPRA">Compra</option>
            <option value="ACTUALIZACION">Actualización</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Fecha
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
              <th className="py-2 font-medium">Fecha</th>
              <th className="py-2 font-medium">Tipo</th>
              <th className="py-2 font-medium">Proveedor</th>
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
                  <td className="py-2">
                    <select className={inputCls} value={editTipo} onChange={(e) => setEditTipo(e.target.value as TipoPrecio)}>
                      <option value="COMPRA">Compra</option>
                      <option value="ACTUALIZACION">Actualización</option>
                    </select>
                  </td>
                  <td className="py-2 text-slate-500">{f.proveedor_nombre ?? '—'}</td>
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
                  <td className="py-2"><TipoBadge tipo={f.tipo} /></td>
                  <td className="py-2 text-slate-500">
                    {f.proveedor_nombre ?? <span className="text-slate-400">—</span>}
                  </td>
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
  const [familia, setFamilia] = useState('');
  const [orden, setOrden] = useState<OrdenPrecio>('producto');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['precios'],
    queryFn: () => apiGet<PrecioVigente[]>('/api/precios'),
  });

  const q = texto.trim().toLowerCase();
  const filas = (data ?? []).filter((f) => {
    if (soloSinPrecio && f.precio !== null) return false;
    if (familia && f.producto_familia !== familia) return false;
    if (q && !f.producto_nombre.toLowerCase().includes(q) && !f.producto_3c.toLowerCase().includes(q)) return false;
    return true;
  });
  const conPrecio = (data ?? []).filter((f) => f.precio !== null).length;
  const sinPrecio = (data ?? []).length - conPrecio;
  const familias = [...new Set((data ?? []).map((f) => f.producto_familia).filter(Boolean))].sort() as string[];

  // Los productos SIN precio van siempre al final: son "falta el dato", no "vale 0", y
  // mezclarlos con los baratos al ordenar por precio haría leer mal la lista.
  const signo = dir === 'asc' ? 1 : -1;
  const ordenadas = [...filas].sort((a, b) => {
    if (orden === 'precio') {
      if (a.precio === null) return 1;
      if (b.precio === null) return -1;
      return (Number(a.precio) - Number(b.precio)) * signo;
    }
    if (orden === 'vigencia') {
      if (!a.vigente_desde) return 1;
      if (!b.vigente_desde) return -1;
      return a.vigente_desde.localeCompare(b.vigente_desde) * signo;
    }
    if (orden === 'codigo') return a.producto_3c.localeCompare(b.producto_3c, 'es') * signo;
    if (orden === 'proveedor')
      return (a.proveedor_nombre ?? '').localeCompare(b.proveedor_nombre ?? '', 'es') * signo;
    return a.producto_nombre.localeCompare(b.producto_nombre, 'es') * signo;
  });

  // Precio y fecha arrancan de mayor a menor (lo más caro / lo más reciente primero); el
  // texto, alfabético.
  const ordenarPor = (campo: OrdenPrecio) => {
    if (campo === orden) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setOrden(campo);
      setDir(campo === 'precio' || campo === 'vigencia' ? 'desc' : 'asc');
    }
  };

  const chips: ChipFiltro[] = [
    texto.trim() && { key: 'texto', label: `Busca: ${texto.trim()}`, onQuitar: () => setTexto('') },
    familia && { key: 'fam', label: `Familia: ${familia}`, onQuitar: () => setFamilia('') },
    soloSinPrecio && { key: 'sin', label: 'Solo sin precio', onQuitar: () => setSoloSinPrecio(false) },
  ].filter(Boolean) as ChipFiltro[];

  return (
    <section>
      <EncabezadoPagina
        titulo="Precios"
        bajada={data ? 'Precio vigente por producto · tocá una fila para ver el historial' : 'Cargando…'}
      />

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tarjeta etiqueta="Productos" valor={data.length.toLocaleString('es-AR')} tono="celeste" />
          <Tarjeta etiqueta="Con precio" valor={conPrecio.toLocaleString('es-AR')} tono="ok" />
          <Tarjeta
            etiqueta="Sin precio"
            valor={sinPrecio.toLocaleString('es-AR')}
            tono={sinPrecio > 0 ? 'alerta' : 'ok'}
            detalle={sinPrecio > 0 ? 'Se valorizan en $0 · tocá para verlos' : 'Todos valorizados'}
            onClick={sinPrecio > 0 ? () => setSoloSinPrecio(true) : undefined}
          />
        </div>
      )}

      <BarraFiltros
        abierto={false}
        onToggle={() => undefined}
        chips={chips}
        onLimpiar={() => {
          setTexto('');
          setFamilia('');
          setSoloSinPrecio(false);
        }}
        principal={
          <>
            <div className="relative min-w-[240px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <IconoLupa />
              </span>
              <input
                type="search"
                className={`${CLS_INPUT} w-full pl-9`}
                placeholder="Buscar código o producto…"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
            <select className={CLS_INPUT} value={familia} onChange={(e) => setFamilia(e.target.value)}>
              <option value="">Todas las familias</option>
              {familias.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-slate-600">
              <input
                type="checkbox"
                checked={soloSinPrecio}
                onChange={(e) => setSoloSinPrecio(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              Solo sin precio
            </label>
          </>
        }
        acciones={
          <button
            onClick={() =>
              void descargarArchivo(
                `/api/precios/export.csv${familia ? `?familia=${encodeURIComponent(familia)}` : ''}`,
                'precios.csv',
              )
            }
            className={CLS_BOTON}
            title="Descarga el precio vigente de todos los productos"
          >
            <IconoDescarga />
            Descargar CSV
          </button>
        }
      />

      <Panel>
        {isLoading && <p className="p-6 text-slate-500">Cargando precios…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && ordenadas.length === 0 && (
          <Vacio
            mensaje="Ningún producto coincide con el filtro"
            accion={
              <button
                onClick={() => {
                  setTexto('');
                  setSoloSinPrecio(false);
                }}
                className="text-sm font-medium text-sky-600 hover:underline"
              >
                Limpiar los filtros
              </button>
            }
          />
        )}
        {ordenadas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide">
                <ThOrden campo="codigo" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                  Código 3c
                </ThOrden>
                <ThOrden campo="producto" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                  Producto
                </ThOrden>
                <th className="px-4 py-3 font-medium text-slate-500">Familia</th>
                <ThOrden campo="proveedor" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                  Proveedor
                </ThOrden>
                <ThOrden campo="precio" orden={orden} dir={dir} onOrdenar={ordenarPor} alineado="der">
                  Precio vigente
                </ThOrden>
                <th className="px-4 py-3 font-medium text-slate-500">Tipo</th>
                <ThOrden campo="vigencia" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                  Vigente desde
                </ThOrden>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f) => {
                const open = abierto === f.producto_3c;
                return (
                  <Fragment key={f.producto_3c}>
                    <tr
                      onClick={() => setAbierto(open ? null : f.producto_3c)}
                      className={`cursor-pointer border-b border-slate-100 transition hover:bg-sky-50/50 ${
                        open ? 'bg-sky-50/60' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.producto_3c}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="mr-1.5 inline-block text-slate-400">{open ? '▾' : '▸'}</span>
                        {f.producto_nombre}
                      </td>
                      <td className="px-4 py-3">
                        <EtiquetaFamilia familia={f.producto_familia} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {f.proveedor_nombre ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {f.precio === null ? (
                          <span className="text-slate-400">— sin precio</span>
                        ) : (
                          <span className="text-slate-900">{money.format(Number(f.precio))}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{f.tipo ? <TipoBadge tipo={f.tipo} /> : null}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {f.vigente_desde ? fechaCorta(f.vigente_desde) : '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <td colSpan={7} className="px-2 py-2">
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
      </Panel>
    </section>
  );
}
