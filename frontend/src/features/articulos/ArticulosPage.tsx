import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../../shared/api/client';
import type { Articulo, ListaArticulos } from '../../shared/api/types';

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';
const LIMIT = 50;

// Datos editables de un artículo (alta y edición comparten forma; el código no se edita).
interface FormArticulo {
  nombre: string;
  unidad_base: string;
  familia: string;
  subfamilia: string;
  presentacion_compra: string;
  unidades_por_bulto: string;
  clasificacion_abc: string;
  informacion: string;
  activo: boolean;
}

const vacio: FormArticulo = {
  nombre: '',
  unidad_base: 'UNIDAD',
  familia: '',
  subfamilia: '',
  presentacion_compra: '',
  unidades_por_bulto: '',
  clasificacion_abc: '',
  informacion: '',
  activo: true,
};

function aPayload(f: FormArticulo) {
  const bulto = f.unidades_por_bulto.trim().replace(',', '.');
  return {
    nombre: f.nombre.trim(),
    unidad_base: f.unidad_base.trim(),
    familia: f.familia.trim() || null,
    subfamilia: f.subfamilia.trim() || null,
    presentacion_compra: f.presentacion_compra.trim() || null,
    unidades_por_bulto: bulto === '' ? null : Number(bulto),
    clasificacion_abc: f.clasificacion_abc.trim() || null,
    informacion: f.informacion.trim() || null,
    activo: f.activo,
  };
}

export function ArticulosPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [familia, setFamilia] = useState(''); // '' = todas
  const [page, setPage] = useState(1);
  const [alta, setAlta] = useState(false);
  const [form, setForm] = useState<FormArticulo>(vacio);
  const [editando, setEditando] = useState<string | null>(null); // codigo_3c en edición
  const [error, setError] = useState<string | null>(null);

  const qs = () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (familia) p.set('familia', familia);
    p.set('page', String(page));
    p.set('limit', String(LIMIT));
    return p.toString();
  };

  const articulos = useQuery({
    queryKey: ['articulos', q, familia, page],
    queryFn: () => apiGet<ListaArticulos>(`/api/articulos?${qs()}`),
  });
  const familias = useQuery({
    queryKey: ['articulos-familias'],
    queryFn: () => apiGet<string[]>('/api/articulos/familias'),
  });

  const invalidar = async () => {
    await queryClient.invalidateQueries({ queryKey: ['articulos'] });
    await queryClient.invalidateQueries({ queryKey: ['articulos-familias'] });
  };

  const crear = useMutation({
    mutationFn: () => apiPost<Articulo>('/api/articulos', aPayload(form)),
    onSuccess: async (nuevo) => {
      setAlta(false);
      setForm(vacio);
      setError(null);
      await invalidar();
      window.alert(`Artículo creado con código ${nuevo.codigo_3c}.`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo crear'),
  });

  const editar = useMutation({
    mutationFn: (codigo: string) => apiPut<Articulo>(`/api/articulos/${codigo}`, aPayload(form)),
    onSuccess: async () => {
      setEditando(null);
      setForm(vacio);
      setError(null);
      await invalidar();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se pudo guardar'),
  });

  const abrirEdicion = (a: Articulo) => {
    setError(null);
    setAlta(false);
    setEditando(a.codigo_3c);
    setForm({
      nombre: a.nombre,
      unidad_base: a.unidad_base,
      familia: a.familia ?? '',
      subfamilia: a.subfamilia ?? '',
      presentacion_compra: a.presentacion_compra ?? '',
      unidades_por_bulto: a.unidades_por_bulto ?? '',
      clasificacion_abc: a.clasificacion_abc ?? '',
      informacion: a.informacion ?? '',
      activo: a.activo,
    });
  };

  const abrirAlta = () => {
    setError(null);
    setEditando(null);
    setForm(vacio);
    setAlta(true);
  };

  const items = articulos.data?.items ?? [];
  const total = articulos.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMIT));
  const puedeGuardar = form.nombre.trim() !== '' && form.unidad_base.trim() !== '';

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold">Artículos</h2>
          <p className="text-sm text-slate-500">Maestro de productos con su rubro (familia / subfamilia).</p>
        </div>
        <button
          onClick={abrirAlta}
          className="ml-auto rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          + Nuevo artículo
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className={inputCls}
          placeholder="Buscar por código o nombre…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className={inputCls}
          value={familia}
          onChange={(e) => {
            setFamilia(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas las familias</option>
          {(familias.data ?? []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">{total} artículo(s)</span>
      </div>

      {/* Alta / edición */}
      {(alta || editando) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">
            {alta ? 'Nuevo artículo (el código se genera solo)' : `Editar artículo ${editando}`}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-2">
              Nombre
              <input
                className={inputCls}
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Unidad
              <input
                className={inputCls}
                value={form.unidad_base}
                onChange={(e) => setForm({ ...form, unidad_base: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Familia
              <input
                className={inputCls}
                value={form.familia}
                onChange={(e) => setForm({ ...form, familia: e.target.value })}
                list="familias-list"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Subfamilia
              <input
                className={inputCls}
                value={form.subfamilia}
                onChange={(e) => setForm({ ...form, subfamilia: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-2">
              Presentación / unidad mín. compra
              <input
                className={inputCls}
                placeholder="1 Caja = 36 ud."
                value={form.presentacion_compra}
                onChange={(e) => setForm({ ...form, presentacion_compra: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              Unid. por bulto
              <input
                className={inputCls}
                inputMode="decimal"
                placeholder="36"
                value={form.unidades_por_bulto}
                onChange={(e) => setForm({ ...form, unidades_por_bulto: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              ABC
              <input
                className={inputCls}
                maxLength={4}
                placeholder="B"
                value={form.clasificacion_abc}
                onChange={(e) => setForm({ ...form, clasificacion_abc: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500 lg:col-span-3">
              Información
              <input
                className={inputCls}
                value={form.informacion}
                onChange={(e) => setForm({ ...form, informacion: e.target.value })}
              />
            </label>
          </div>
          <datalist id="familias-list">
            {(familias.data ?? []).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          {editando && (
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              />
              Activo
            </label>
          )}
          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <div className="mt-4 flex gap-2">
            <button
              disabled={!puedeGuardar || crear.isPending || editar.isPending}
              onClick={() => (alta ? crear.mutate() : editando && editar.mutate(editando))}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {alta ? 'Crear' : 'Guardar'}
            </button>
            <button
              onClick={() => {
                setAlta(false);
                setEditando(null);
                setError(null);
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Familia</th>
              <th className="px-4 py-3">Subfamilia</th>
              <th className="px-4 py-3">Presentación</th>
              <th className="px-4 py-3 text-right">Ud/bulto</th>
              <th className="px-4 py-3">Unidad</th>
              <th className="px-4 py-3">ABC</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {articulos.isLoading && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {!articulos.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  Sin artículos.
                </td>
              </tr>
            )}
            {items.map((a) => (
              <tr key={a.codigo_3c} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs">
                  {a.codigo_3c}
                  {a.creado_local && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700" title="Creado en la app (código propio, no de 3c)">
                      local
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">{a.nombre}</td>
                <td className="px-4 py-2 text-slate-600">{a.familia ?? '—'}</td>
                <td className="px-4 py-2 text-slate-600">{a.subfamilia ?? '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{a.presentacion_compra ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                  {a.unidades_por_bulto ? Number(a.unidades_por_bulto) : '—'}
                </td>
                <td className="px-4 py-2 text-slate-600">{a.unidad_base}</td>
                <td className="px-4 py-2 text-slate-600">{a.clasificacion_abc ?? '—'}</td>
                <td className="px-4 py-2">
                  {a.activo ? (
                    <span className="text-emerald-600">activo</span>
                  ) : (
                    <span className="text-slate-400">inactivo</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => abrirEdicion(a)}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginado */}
      {totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            ← Anterior
          </button>
          <span className="text-slate-500">
            Página {page} de {totalPaginas}
          </span>
          <button
            disabled={page >= totalPaginas}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            Siguiente →
          </button>
        </div>
      )}
    </section>
  );
}
