import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, descargarArchivo } from '../../shared/api/client';
import type {
  EstadoMovimiento,
  ListaMovimientos,
  TipoMovimiento,
  Ubicacion,
  UsuarioPublico,
} from '../../shared/api/types';

type FiltroEstado = EstadoMovimiento | 'TODOS';
const FILTROS: FiltroEstado[] = ['TODOS', 'CONFIRMADO', 'ANULADO', 'BORRADOR'];

const inputCls =
  'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500';

const BADGE: Record<EstadoMovimiento, string> = {
  CONFIRMADO: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ANULADO: 'bg-rose-50 text-rose-700 ring-rose-200',
  BORRADOR: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const TIPO_LABEL: Record<string, string> = {
  RECEPCION: 'Recepción',
  RINT: 'Remito interno',
  AJUSTE: 'Ajuste',
};

export function MovimientosPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<FiltroEstado>('TODOS');
  const [tipo, setTipo] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [producto, setProducto] = useState('');
  const [familia, setFamilia] = useState('');
  const [usuario, setUsuario] = useState('');
  const [nro, setNro] = useState('');

  const tipos = useQuery({ queryKey: ['tipos'], queryFn: () => apiGet<TipoMovimiento[]>('/api/tipos') });
  const ubicaciones = useQuery({ queryKey: ['ubicaciones'], queryFn: () => apiGet<Ubicacion[]>('/api/ubicaciones') });
  const familias = useQuery({ queryKey: ['familias'], queryFn: () => apiGet<string[]>('/api/articulos/familias') });
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => apiGet<UsuarioPublico[]>('/api/usuarios') });

  const hayFiltros =
    tipo !== '' ||
    ubicacion !== '' ||
    desde !== '' ||
    hasta !== '' ||
    estado !== 'TODOS' ||
    producto !== '' ||
    familia !== '' ||
    usuario !== '' ||
    nro !== '';
  const limpiar = () => {
    setEstado('TODOS');
    setTipo('');
    setUbicacion('');
    setDesde('');
    setHasta('');
    setProducto('');
    setFamilia('');
    setUsuario('');
    setNro('');
  };

  // Querystring de filtros, compartido por el listado y el export (sin limit).
  const filtrosQs = (): URLSearchParams => {
    const qs = new URLSearchParams();
    if (estado !== 'TODOS') qs.set('estado', estado);
    if (tipo) qs.set('tipo', tipo);
    if (ubicacion) qs.set('ubicacion', ubicacion);
    if (desde) qs.set('desde', desde);
    if (hasta) qs.set('hasta', hasta);
    if (producto.trim()) qs.set('producto', producto.trim());
    if (familia) qs.set('familia', familia);
    if (usuario) qs.set('usuario', usuario);
    if (nro.trim()) qs.set('nro', nro.trim());
    return qs;
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movimientos', estado, tipo, ubicacion, desde, hasta, producto, familia, usuario, nro],
    queryFn: () => {
      const qs = filtrosQs();
      qs.set('limit', '50');
      return apiGet<ListaMovimientos>(`/api/movimientos?${qs.toString()}`);
    },
  });

  const exportar = () => {
    const qs = filtrosQs().toString();
    void descargarArchivo(`/api/movimientos/export.csv${qs ? `?${qs}` : ''}`, 'movimientos.csv');
  };

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Movimientos</h2>
          <p className="text-sm text-slate-500">
            {data ? `${data.total} movimiento${data.total === 1 ? '' : 's'}` : 'Cargando…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {FILTROS.map((f) => (
              <button
                key={f}
                onClick={() => setEstado(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  estado === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {f === 'TODOS' ? 'Todos' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <button
            onClick={exportar}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Exportar Excel
          </button>
          <Link
            to="/movimientos/nuevo"
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
          >
            + Nuevo
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={inputCls} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {(tipos.data ?? []).map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {TIPO_LABEL[t.codigo] ?? t.nombre}
            </option>
          ))}
        </select>
        <select className={inputCls} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {(ubicaciones.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.dep_id_3c} — {u.nombre}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          Desde
          <input type="date" className={inputCls} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          Hasta
          <input type="date" className={inputCls} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <input
          type="text"
          className={inputCls}
          placeholder="Producto (cód. o nombre)"
          value={producto}
          onChange={(e) => setProducto(e.target.value)}
        />
        <select className={inputCls} value={familia} onChange={(e) => setFamilia(e.target.value)}>
          <option value="">Todas las familias</option>
          {(familias.data ?? []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select className={inputCls} value={usuario} onChange={(e) => setUsuario(e.target.value)}>
          <option value="">Cargado por: todos</option>
          {(usuarios.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.nombre}
            </option>
          ))}
        </select>
        <input
          type="text"
          className={inputCls}
          placeholder="Nro (RINT… o 3c)"
          value={nro}
          onChange={(e) => setNro(e.target.value)}
        />
        {hayFiltros && (
          <button onClick={limpiar} className="text-sm font-medium text-sky-600 hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading && <p className="p-6 text-slate-500">Cargando movimientos…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.items.length === 0 && <p className="p-6 text-slate-500">No hay movimientos para este filtro.</p>}
        {data && data.items.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Nro</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Origen → Destino</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((m) => (
                <tr
                  key={m.id}
                  onClick={() => navigate(`/movimientos/${m.id}`)}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{m.nro}</td>
                  <td className="px-4 py-3 text-slate-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[m.estado]}`}
                    >
                      {m.estado.charAt(0) + m.estado.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.fecha}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="text-slate-400">{m.origen_dep_id_3c} —</span> {m.origen_nombre}
                    {m.proveedor_nombre && (
                      <span className="ml-1 font-medium text-slate-700">({m.proveedor_nombre})</span>
                    )}{' '}
                    <span className="text-slate-400">→ {m.destino_dep_id_3c} —</span> {m.destino_nombre}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
