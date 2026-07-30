import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiGet, descargarArchivo } from '../../shared/api/client';
import { BarraFiltros, Campo, type ChipFiltro } from '../../shared/components/filtros';
import { IconoDescarga, IconoLupa } from '../../shared/components/iconos';
import { CLS_BOTON, CLS_BOTON_PRIMARIO, CLS_INPUT, Paginacion, ThOrden } from '../../shared/components/tabla';
import { EncabezadoPagina, Panel, Vacio } from '../../shared/components/ui';
import type {
  EstadoMovimiento,
  ListaMovimientos,
  TipoMovimiento,
  Ubicacion,
  UsuarioPublico,
} from '../../shared/api/types';

type FiltroEstado = EstadoMovimiento | 'TODOS';
const FILTROS: FiltroEstado[] = ['TODOS', 'CONFIRMADO', 'ANULADO', 'BORRADOR'];

// Mismas claves que el `orden` del backend (MovimientosQuerySchema).
type OrdenCampo = 'fecha' | 'nro' | 'tipo' | 'estado';
const LIMIT = 50;

const BADGE: Record<EstadoMovimiento, string> = {
  CONFIRMADO: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ANULADO: 'bg-rose-50 text-rose-700 ring-rose-200',
  BORRADOR: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const TIPO_LABEL: Record<string, string> = {
  RECEPCION: 'Recepción',
  RINT: 'Remito interno',
  AJUSTE: 'Ajuste',
  INVENTARIO: 'Inventario',
};

const capitalizar = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

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
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [orden, setOrden] = useState<OrdenCampo>('fecha');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const tipos = useQuery({ queryKey: ['tipos'], queryFn: () => apiGet<TipoMovimiento[]>('/api/tipos') });
  const ubicaciones = useQuery({ queryKey: ['ubicaciones'], queryFn: () => apiGet<Ubicacion[]>('/api/ubicaciones') });
  const familias = useQuery({ queryKey: ['familias'], queryFn: () => apiGet<string[]>('/api/articulos/familias') });
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => apiGet<UsuarioPublico[]>('/api/usuarios') });

  const nombreUbicacion = (id: string) => {
    const u = (ubicaciones.data ?? []).find((x) => String(x.id) === id);
    return u ? u.nombre : id;
  };
  const nombreUsuario = (id: string) => {
    const u = (usuarios.data ?? []).find((x) => String(x.id) === id);
    return u ? u.nombre : id;
  };

  // Chips de lo que está filtrado. El estado no entra: ya se ve en las pestañas.
  const chips: ChipFiltro[] = [
    tipo && { key: 'tipo', label: `Tipo: ${TIPO_LABEL[tipo] ?? tipo}`, onQuitar: () => setTipo('') },
    ubicacion && { key: 'ubic', label: `Ubicación: ${nombreUbicacion(ubicacion)}`, onQuitar: () => setUbicacion('') },
    desde && { key: 'desde', label: `Desde: ${desde}`, onQuitar: () => setDesde('') },
    hasta && { key: 'hasta', label: `Hasta: ${hasta}`, onQuitar: () => setHasta('') },
    producto.trim() && { key: 'prod', label: `Producto: ${producto.trim()}`, onQuitar: () => setProducto('') },
    familia && { key: 'fam', label: `Familia: ${familia}`, onQuitar: () => setFamilia('') },
    usuario && { key: 'user', label: `Cargado por: ${nombreUsuario(usuario)}`, onQuitar: () => setUsuario('') },
    nro.trim() && { key: 'nro', label: `Nro: ${nro.trim()}`, onQuitar: () => setNro('') },
  ].filter(Boolean) as ChipFiltro[];

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

  // Cambiar un filtro vuelve a la página 1: si estabas en la 7 y filtrás algo que deja
  // 2 páginas, quedarías mirando una página vacía sin entender por qué.
  useEffect(() => {
    setPage(1);
  }, [estado, tipo, ubicacion, desde, hasta, producto, familia, usuario, nro]);

  const ordenarPor = (campo: OrdenCampo) => {
    if (campo === orden) {
      setDir(dir === 'asc' ? 'desc' : 'asc');
    } else {
      setOrden(campo);
      setDir('desc');
    }
    setPage(1);
  };

  // Querystring de filtros, compartido por el listado y el export (sin page/limit).
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
    qs.set('orden', orden);
    qs.set('dir', dir);
    return qs;
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['movimientos', estado, tipo, ubicacion, desde, hasta, producto, familia, usuario, nro, orden, dir, page],
    queryFn: () => {
      const qs = filtrosQs();
      qs.set('limit', String(LIMIT));
      qs.set('page', String(page));
      return apiGet<ListaMovimientos>(`/api/movimientos?${qs.toString()}`);
    },
  });

  const exportar = () => {
    const qs = filtrosQs().toString();
    void descargarArchivo(`/api/movimientos/export.csv${qs ? `?${qs}` : ''}`, 'movimientos.csv');
  };

  const hayFiltros = chips.length > 0 || estado !== 'TODOS';

  return (
    <section>
      <EncabezadoPagina
        titulo="Movimientos"
        bajada={
          data
            ? `${data.total.toLocaleString('es-AR')} movimiento${data.total === 1 ? '' : 's'}${
                hayFiltros ? ' con los filtros puestos' : ''
              }`
            : 'Cargando…'
        }
        acciones={
          <Link to="/movimientos/nuevo" className={CLS_BOTON_PRIMARIO}>
            + Nuevo movimiento
          </Link>
        }
      />

      <BarraFiltros
        abierto={panelAbierto}
        onToggle={() => setPanelAbierto((v) => !v)}
        chips={chips}
        onLimpiar={limpiar}
        principal={
          <>
            <div className="relative min-w-[240px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <IconoLupa />
              </span>
              <input
                type="text"
                className={`${CLS_INPUT} w-full pl-9`}
                placeholder="Buscar producto por código o nombre…"
                value={producto}
                onChange={(e) => setProducto(e.target.value)}
              />
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {FILTROS.map((f) => (
                <button
                  key={f}
                  onClick={() => setEstado(f)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    estado === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {f === 'TODOS' ? 'Todos' : capitalizar(f)}
                </button>
              ))}
            </div>
          </>
        }
        acciones={
          <button onClick={exportar} className={CLS_BOTON} title="Descarga exactamente lo que estás viendo filtrado">
            <IconoDescarga />
            Descargar CSV
          </button>
        }
        avanzados={
          <>
            <Campo label="Tipo">
              <select className={CLS_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="">Todos</option>
                {(tipos.data ?? []).map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {TIPO_LABEL[t.codigo] ?? t.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Ubicación (origen o destino)">
              <select className={CLS_INPUT} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
                <option value="">Todas</option>
                {(ubicaciones.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.dep_id_3c} — {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Familia">
              <select className={CLS_INPUT} value={familia} onChange={(e) => setFamilia(e.target.value)}>
                <option value="">Todas</option>
                {(familias.data ?? []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Cargado por">
              <select className={CLS_INPUT} value={usuario} onChange={(e) => setUsuario(e.target.value)}>
                <option value="">Todos</option>
                {(usuarios.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Desde">
              <input type="date" className={CLS_INPUT} value={desde} onChange={(e) => setDesde(e.target.value)} />
            </Campo>
            <Campo label="Hasta">
              <input type="date" className={CLS_INPUT} value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </Campo>
            <Campo label="Número (propio o de 3c)">
              <input
                type="text"
                className={CLS_INPUT}
                placeholder="RINT-2026-… o nro de 3c"
                value={nro}
                onChange={(e) => setNro(e.target.value)}
              />
            </Campo>
          </>
        }
      />

      <Panel>
        {isLoading && <p className="p-6 text-slate-500">Cargando movimientos…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.items.length === 0 && (
          <Vacio
            mensaje="No hay movimientos con estos filtros"
            accion={
              hayFiltros && (
                <button onClick={limpiar} className="text-sm font-medium text-sky-600 hover:underline">
                  Limpiar los filtros
                </button>
              )
            }
          />
        )}
        {data && data.items.length > 0 && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide">
                  <ThOrden campo="nro" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Nro
                  </ThOrden>
                  <ThOrden campo="tipo" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Tipo
                  </ThOrden>
                  <ThOrden campo="estado" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Estado
                  </ThOrden>
                  <ThOrden campo="fecha" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Fecha
                  </ThOrden>
                  <th className="px-4 py-3 font-medium text-slate-500">Origen → Destino</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => navigate(`/movimientos/${m.id}`)}
                    className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-sky-50/50"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-700">{m.nro}</td>
                    <td className="px-4 py-3 text-slate-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[m.estado]}`}
                      >
                        {capitalizar(m.estado)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{m.fecha}</td>
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
            <Paginacion page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </section>
  );
}
