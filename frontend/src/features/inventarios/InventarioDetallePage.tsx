import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPut } from '../../shared/api/client';
import type { InventarioDetalle, ResultadoConfirmacion } from '../../shared/api/types';

const inputCls =
  'w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

// Parsea lo escrito: '' → null (sin contar); coma o punto decimal. NaN si inválido.
function parseContada(v: string): number | null | typeof NaN {
  const t = v.trim();
  if (t === '') return null;
  return Number(t.replace(',', '.'));
}
function esInvalido(v: string): boolean {
  const n = parseContada(v);
  return n !== null && (Number.isNaN(n) || n < 0);
}

export function InventarioDetallePage() {
  const { id } = useParams();
  const invId = Number(id);
  const queryClient = useQueryClient();

  const detalle = useQuery({
    queryKey: ['inventario', invId],
    queryFn: () => apiGet<InventarioDetalle>(`/api/inventarios/${invId}`),
  });

  const [contadas, setContadas] = useState<Record<string, string>>({});
  const [initId, setInitId] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [nuevoProd, setNuevoProd] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  // Inicializa los inputs cuando llega el detalle (una vez por inventario).
  useEffect(() => {
    if (detalle.data && initId !== detalle.data.id) {
      const init: Record<string, string> = {};
      for (const l of detalle.data.lineas) init[l.producto_3c] = l.cantidad_contada === null ? '' : String(l.cantidad_contada);
      setContadas(init);
      setInitId(detalle.data.id);
    }
  }, [detalle.data, initId]);

  const inv = detalle.data;
  const editable = inv?.estado === 'BORRADOR';

  const payloadLineas = () =>
    (inv?.lineas ?? []).map((l) => ({ producto_3c: l.producto_3c, cantidad_contada: parseContada(contadas[l.producto_3c] ?? '') as number | null }));

  const guardar = useMutation({
    mutationFn: () => apiPut<InventarioDetalle>(`/api/inventarios/${invId}/lineas`, { lineas: payloadLineas() }),
    onSuccess: async () => {
      setMsg('Guardado.');
      await queryClient.invalidateQueries({ queryKey: ['inventario', invId] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'No se pudo guardar'),
  });

  const agregar = useMutation({
    mutationFn: () => apiPost<InventarioDetalle>(`/api/inventarios/${invId}/lineas`, { producto_3c: nuevoProd.trim() }),
    onSuccess: async () => {
      setNuevoProd('');
      await queryClient.invalidateQueries({ queryKey: ['inventario', invId] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'No se pudo agregar'),
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      await apiPut(`/api/inventarios/${invId}/lineas`, { lineas: payloadLineas() }); // guarda antes de confirmar
      return apiPost<ResultadoConfirmacion>(`/api/inventarios/${invId}/confirmar`, {});
    },
    onSuccess: async (res) => {
      const r = res.resumen;
      await queryClient.invalidateQueries({ queryKey: ['inventario', invId] });
      await queryClient.invalidateQueries({ queryKey: ['inventarios'] });
      await queryClient.invalidateQueries({ queryKey: ['stock'] });
      window.alert(
        `Inventario confirmado.\n` +
          `+${r.renglones_entrada} entradas / −${r.renglones_salida} salidas / ${r.sin_cambio} sin cambio / ${r.sin_contar} sin contar.\n` +
          (r.entrada_nro ? `Ajuste entrada: ${r.entrada_nro}\n` : '') +
          (r.salida_nro ? `Ajuste salida: ${r.salida_nro}` : ''),
      );
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : 'No se pudo confirmar'),
  });

  const hayInvalidos = useMemo(() => Object.values(contadas).some(esInvalido), [contadas]);

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (inv?.lineas ?? []).filter((l) => !q || l.nombre.toLowerCase().includes(q) || l.producto_3c.includes(q));
  }, [inv?.lineas, busqueda]);

  const contadasCount = (inv?.lineas ?? []).filter((l) => (contadas[l.producto_3c] ?? '').trim() !== '').length;

  if (detalle.isLoading) return <p className="text-slate-500">Cargando…</p>;
  if (!inv) return <p className="text-rose-600">No se encontró el inventario.</p>;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/inventarios" className="text-sm text-sky-600">
          ← Inventarios
        </Link>
        <div>
          <h2 className="text-xl font-semibold">
            Inventario #{inv.id} · {inv.ubicacion_nombre}
          </h2>
          <p className="text-sm text-slate-500">
            {inv.fecha} · {(inv.familias ?? []).join(', ')} ·{' '}
            <span className={inv.estado === 'CONFIRMADO' ? 'text-emerald-600' : 'text-amber-600'}>{inv.estado}</span>
          </p>
        </div>
        <div className="ml-auto text-sm text-slate-500">
          {contadasCount}/{inv.lineas.length} contados
        </div>
      </div>

      {inv.estado === 'CONFIRMADO' && (inv.movimiento_entrada_id || inv.movimiento_salida_id) && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Ajustes generados:{' '}
          {inv.movimiento_entrada_id && (
            <Link className="underline" to={`/movimientos/${inv.movimiento_entrada_id}`}>
              entrada
            </Link>
          )}
          {inv.movimiento_entrada_id && inv.movimiento_salida_id && ' · '}
          {inv.movimiento_salida_id && (
            <Link className="underline" to={`/movimientos/${inv.movimiento_salida_id}`}>
              salida
            </Link>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          placeholder="Buscar producto…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {editable && (
          <>
            <button
              disabled={guardar.isPending || hayInvalidos}
              onClick={() => guardar.mutate()}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              {guardar.isPending ? 'Guardando…' : 'Guardar avance'}
            </button>
            <button
              disabled={confirmar.isPending || hayInvalidos}
              onClick={() => {
                if (window.confirm('Confirmar el inventario generará los ajustes de stock. ¿Seguir?')) confirmar.mutate();
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              Confirmar y generar ajustes
            </button>
          </>
        )}
        {msg && <span className="text-sm text-slate-500">{msg}</span>}
        {hayInvalidos && <span className="text-sm text-rose-600">Hay cantidades inválidas (negativas o no numéricas).</span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-3">Código</th>
              <th className="px-3 py-3">Producto</th>
              <th className="px-3 py-3">Familia</th>
              <th className="px-3 py-3 text-right">Sistema</th>
              <th className="px-3 py-3 text-right">Contado</th>
              <th className="px-3 py-3 text-right">Diferencia</th>
              <th className="px-3 py-3 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => {
              const raw = contadas[l.producto_3c] ?? '';
              const n = parseContada(raw);
              const cont = n === null || Number.isNaN(n) ? null : n;
              const dif = cont === null ? null : Math.round((cont - l.stock_sistema) * 1000) / 1000;
              const pct = cont === null || l.stock_sistema === 0 ? null : Math.round(((cont - l.stock_sistema) / l.stock_sistema) * 1000) / 10;
              const difColor = dif === null ? '' : dif === 0 ? 'text-slate-400' : dif > 0 ? 'text-emerald-600' : 'text-rose-600';
              return (
                <tr key={l.producto_3c} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{l.producto_3c}</td>
                  <td className="px-3 py-1.5">{l.nombre}</td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{l.familia ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                    {l.stock_sistema} <span className="text-xs text-slate-400">{l.unidad}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <input
                        className={`${inputCls} text-right ${esInvalido(raw) ? 'border-rose-400' : ''}`}
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => setContadas((p) => ({ ...p, [l.producto_3c]: e.target.value }))}
                      />
                    ) : (
                      <span className="tabular-nums">{l.cantidad_contada ?? '—'}</span>
                    )}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${difColor}`}>{dif === null ? '—' : dif > 0 ? `+${dif}` : dif}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${difColor}`}>{pct === null ? '—' : `${pct > 0 ? '+' : ''}${pct}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Agregar producto que no está en la hoja:</span>
          <input
            className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-sky-500"
            placeholder="código 3c"
            value={nuevoProd}
            onChange={(e) => setNuevoProd(e.target.value)}
          />
          <button
            disabled={!nuevoProd.trim() || agregar.isPending}
            onClick={() => agregar.mutate()}
            className="rounded-lg border border-slate-300 px-3 py-1 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      )}
    </section>
  );
}
