import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { dec, descargarCsv } from '../../shared/lib/csv';
import type { EstadoMovimiento, FilaStock, MovimientoDeProducto } from '../../shared/api/types';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

const TIPO_LABEL: Record<string, string> = {
  RECEPCION: 'Recepción',
  RINT: 'Remito interno',
  AJUSTE: 'Ajuste',
};

const BADGE: Record<EstadoMovimiento, string> = {
  CONFIRMADO: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ANULADO: 'bg-rose-50 text-rose-700 ring-rose-200',
  BORRADOR: 'bg-amber-50 text-amber-700 ring-amber-200',
};

// Kardex: movimientos del producto en esa ubicación (entradas/salidas + saldo acumulado).
function MovimientosDeProducto({
  producto3c,
  ubicacionId,
  productoNombre,
  ubicacionNombre,
}: {
  producto3c: string;
  ubicacionId: number;
  productoNombre: string;
  ubicacionNombre: string;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock-movimientos', producto3c, ubicacionId],
    queryFn: () =>
      apiGet<MovimientoDeProducto[]>(
        `/api/stock/movimientos?producto_3c=${encodeURIComponent(producto3c)}&ubicacion_id=${ubicacionId}`,
      ),
  });

  if (isLoading) return <p className="px-4 py-3 text-sm text-slate-500">Cargando movimientos…</p>;
  if (isError) return <p className="px-4 py-3 text-sm text-rose-700">Error: {(error as Error).message}</p>;
  if (!data || data.length === 0)
    return <p className="px-4 py-3 text-sm text-slate-500">Sin movimientos para este producto en esta ubicación.</p>;

  const exportarKardex = () => {
    const filas = data.map((m) => {
      const entrada = m.destino_id === ubicacionId;
      const contraparte = entrada
        ? `${m.origen_dep_id_3c} - ${m.origen_nombre}`
        : `${m.destino_dep_id_3c} - ${m.destino_nombre}`;
      const cant = m.estado === 'ANULADO' ? '0' : `${entrada ? '' : '-'}${dec(m.cantidad_real)}`;
      return [m.fecha, m.nro, TIPO_LABEL[m.tipo] ?? m.tipo, m.estado, contraparte, cant, m.unidad, m.saldo === null ? '' : dec(m.saldo)];
    });
    descargarCsv(
      `kardex_${producto3c}_dep${ubicacionId}.csv`,
      ['Fecha', 'Nro', 'Tipo', 'Estado', 'Contraparte', 'Movimiento', 'Unidad', 'Saldo'],
      filas,
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
        <span className="text-xs text-slate-500">
          Kardex · {producto3c} {productoNombre} · {ubicacionNombre}
        </span>
        <button onClick={exportarKardex} className="text-xs font-medium text-sky-600 hover:underline">
          Exportar kardex
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-4 py-2 font-medium">Fecha</th>
            <th className="px-4 py-2 font-medium">Nro</th>
            <th className="px-4 py-2 font-medium">Tipo</th>
            <th className="px-4 py-2 font-medium">Contraparte</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 text-right font-medium">Movimiento</th>
            <th className="px-4 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {data.map((m) => {
            const entrada = m.destino_id === ubicacionId;
            const contraparte = entrada
              ? `${m.origen_dep_id_3c} — ${m.origen_nombre}`
              : `${m.destino_dep_id_3c} — ${m.destino_nombre}`;
            const anulado = m.estado === 'ANULADO';
            return (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-600">{m.fecha}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{m.nro}</td>
                <td className="px-4 py-2 text-slate-600">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                <td className="px-4 py-2 text-slate-600">
                  <span className="text-slate-400">{entrada ? 'desde' : 'hacia'}</span> {contraparte}
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[m.estado]}`}>
                    {m.estado.charAt(0) + m.estado.slice(1).toLowerCase()}
                  </span>
                </td>
                <td
                  className={`px-4 py-2 text-right font-medium tabular-nums ${
                    anulado ? 'text-slate-400 line-through' : entrada ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {entrada ? '+' : '−'}
                  {nf.format(Number(m.cantidad_real))} {m.unidad}
                </td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-700">
                  {m.saldo === null ? '—' : nf.format(m.saldo)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

export function StockPage() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ubic, setUbic] = useState<string>(''); // ubicacion_id como string; '' = todas
  const [texto, setTexto] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock'],
    queryFn: () => apiGet<FilaStock[]>('/api/stock'),
  });

  // En acopios (todo lo que no es FABRICA, dep 1) un saldo 0 = "no hay acopio": se
  // oculta. En FABRICA un 0 es un conteo real y se muestra.
  const base = (data ?? []).filter((f) => !(f.ubicacion_dep_id_3c !== 1 && f.cantidad === 0));

  // Opciones de ubicación (distintas) para el filtro.
  const ubicaciones = [...new Map(base.map((f) => [f.ubicacion_id, f])).values()].sort(
    (a, b) => a.ubicacion_dep_id_3c - b.ubicacion_dep_id_3c,
  );

  // Filtro client-side: por ubicación y por texto (código o nombre del producto).
  const q = texto.trim().toLowerCase();
  const filas = base.filter((f) => {
    if (ubic && String(f.ubicacion_id) !== ubic) return false;
    if (q && !f.producto_nombre.toLowerCase().includes(q) && !f.producto_3c.toLowerCase().includes(q)) return false;
    return true;
  });

  // Export client-side: lo que se ve filtrado (WYSIWYG).
  const exportar = () => {
    descargarCsv(
      'stock.csv',
      ['Deposito', 'Ubicacion', 'Codigo', 'Producto', 'Cantidad'],
      filas.map((f) => [String(f.ubicacion_dep_id_3c), f.ubicacion_nombre, f.producto_3c, f.producto_nombre, dec(f.cantidad)]),
    );
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Stock actual</h2>
          <p className="text-sm text-slate-500">
            {data
              ? `${filas.length} de ${base.length} ítems · tocá una fila para ver sus movimientos`
              : 'Cargando…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className={inputCls} value={ubic} onChange={(e) => setUbic(e.target.value)}>
            <option value="">Todas las ubicaciones</option>
            {ubicaciones.map((u) => (
              <option key={u.ubicacion_id} value={u.ubicacion_id}>
                {u.ubicacion_dep_id_3c} — {u.ubicacion_nombre}
              </option>
            ))}
          </select>
          <input
            type="search"
            className={inputCls}
            placeholder="Buscar código o producto…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          <button
            onClick={exportar}
            disabled={filas.length === 0}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Exportar Excel
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && <p className="p-6 text-slate-500">Cargando stock…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.length === 0 && <p className="p-6 text-slate-500">Sin stock cargado.</p>}
        {data && data.length > 0 && filas.length === 0 && (
          <p className="p-6 text-slate-500">Ningún ítem coincide con el filtro.</p>
        )}
        {filas.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Depósito</th>
                <th className="px-4 py-3 font-medium">Ubicación</th>
                <th className="px-4 py-3 font-medium">Código 3c</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 text-right font-medium">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const key = `${f.ubicacion_id}-${f.producto_3c}`;
                const open = abierto === key;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setAbierto(open ? null : key)}
                      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.ubicacion_dep_id_3c}</td>
                      <td className="px-4 py-3 text-slate-700">{f.ubicacion_nombre}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.producto_3c}</td>
                      <td className="px-4 py-3 text-slate-700">
                        <span className="mr-1.5 inline-block text-slate-400">{open ? '▾' : '▸'}</span>
                        {f.producto_nombre}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          f.cantidad < 0 ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {nf.format(f.cantidad)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <td colSpan={5} className="px-2 py-2">
                          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                            <MovimientosDeProducto
                              producto3c={f.producto_3c}
                              ubicacionId={f.ubicacion_id}
                              productoNombre={f.producto_nombre}
                              ubicacionNombre={f.ubicacion_nombre}
                            />
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
