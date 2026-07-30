import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { dec, descargarCsv } from '../../shared/lib/csv';
import { BarraFiltros, Campo, type ChipFiltro } from '../../shared/components/filtros';
import { IconoDescarga, IconoLupa } from '../../shared/components/iconos';
import { CLS_BOTON, CLS_INPUT, ThOrden } from '../../shared/components/tabla';
import { EncabezadoPagina, EtiquetaFamilia, Panel, Tarjeta, Vacio } from '../../shared/components/ui';
import type { EstadoMovimiento, FilaStock, MovimientoDeProducto } from '../../shared/api/types';

// Columnas ordenables. El orden es client-side porque esta hoja trae todo el stock de una
// sola vez (cientos de filas, no miles): ordenar acá es instantáneo y no pega al backend.
type OrdenStock = 'ubicacion' | 'codigo' | 'producto' | 'cantidad';

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

const TIPO_LABEL: Record<string, string> = {
  RECEPCION: 'Recepción',
  RINT: 'Remito interno',
  AJUSTE: 'Ajuste',
  INVENTARIO: 'Inventario',
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
      // ID y nombre de la contraparte en columnas separadas (no "47 - Panaderia" pegado).
      const contraparteId = entrada ? m.origen_dep_id_3c : m.destino_dep_id_3c;
      const contraparte = entrada ? m.origen_nombre : m.destino_nombre;
      const cant = m.estado === 'ANULADO' ? '0' : `${entrada ? '' : '-'}${dec(m.cantidad_real)}`;
      return [
        m.fecha,
        m.nro,
        TIPO_LABEL[m.tipo] ?? m.tipo,
        m.estado,
        contraparteId,
        contraparte,
        cant,
        m.unidad,
        m.saldo === null ? '' : dec(m.saldo),
      ];
    });
    descargarCsv(
      `kardex_${producto3c}_dep${ubicacionId}.csv`,
      ['Fecha', 'Nro', 'Tipo', 'Estado', 'Contraparte ID', 'Contraparte', 'Movimiento', 'Unidad', 'Saldo'],
      filas,
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2">
        <span className="text-xs text-slate-500">
          Kardex · <span className="font-medium text-slate-700">{producto3c}</span> {productoNombre} ·{' '}
          {ubicacionNombre}
        </span>
        <button
          onClick={exportarKardex}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-600 hover:underline"
        >
          <IconoDescarga className="h-3.5 w-3.5" />
          Descargar kardex
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
                <td className="whitespace-nowrap px-4 py-2 tabular-nums text-slate-600">{m.fecha}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">{m.nro}</td>
                <td className="px-4 py-2 text-slate-600">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                <td className="px-4 py-2 text-slate-600">
                  <span className="text-slate-400">{entrada ? 'desde' : 'hacia'}</span> {contraparte}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[m.estado]}`}
                  >
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

export function StockPage() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ubic, setUbic] = useState<string>(''); // ubicacion_id como string; '' = todas
  const [familia, setFamilia] = useState('');
  const [texto, setTexto] = useState('');
  const [soloNegativos, setSoloNegativos] = useState(false);
  const [panelAbierto, setPanelAbierto] = useState(false);
  const [orden, setOrden] = useState<OrdenStock>('producto');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['stock'],
    queryFn: () => apiGet<FilaStock[]>('/api/stock'),
  });

  // En acopios (todo lo que no es FABRICA, dep 1) un saldo 0 = "no hay acopio": se
  // oculta. En FABRICA un 0 es un conteo real y se muestra.
  const base = (data ?? []).filter((f) => !(f.ubicacion_dep_id_3c !== 1 && f.cantidad === 0));

  // Opciones de los filtros, derivadas de lo que hay (no de un catálogo aparte).
  const ubicaciones = [...new Map(base.map((f) => [f.ubicacion_id, f])).values()].sort(
    (a, b) => a.ubicacion_dep_id_3c - b.ubicacion_dep_id_3c,
  );
  const familias = [...new Set(base.map((f) => f.producto_familia).filter(Boolean))].sort() as string[];

  const q = texto.trim().toLowerCase();
  const filas = base.filter((f) => {
    if (ubic && String(f.ubicacion_id) !== ubic) return false;
    if (familia && f.producto_familia !== familia) return false;
    if (soloNegativos && f.cantidad >= 0) return false;
    if (q && !f.producto_nombre.toLowerCase().includes(q) && !f.producto_3c.toLowerCase().includes(q)) return false;
    return true;
  });

  const signo = dir === 'asc' ? 1 : -1;
  const ordenadas = [...filas].sort((a, b) => {
    switch (orden) {
      case 'cantidad':
        return (a.cantidad - b.cantidad) * signo;
      case 'ubicacion':
        return (a.ubicacion_dep_id_3c - b.ubicacion_dep_id_3c) * signo;
      case 'codigo':
        return a.producto_3c.localeCompare(b.producto_3c, 'es') * signo;
      default:
        return a.producto_nombre.localeCompare(b.producto_nombre, 'es') * signo;
    }
  });

  // Al cambiar de columna, la cantidad arranca descendente (lo más grande primero) y el
  // texto ascendente (alfabético): es lo que uno espera de cada tipo de dato.
  const ordenarPor = (campo: OrdenStock) => {
    if (campo === orden) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setOrden(campo);
      setDir(campo === 'cantidad' ? 'desc' : 'asc');
    }
  };

  const negativos = base.filter((f) => f.cantidad < 0).length;

  const chips: ChipFiltro[] = [
    ubic && {
      key: 'ubic',
      label: `Ubicación: ${ubicaciones.find((u) => String(u.ubicacion_id) === ubic)?.ubicacion_nombre ?? ubic}`,
      onQuitar: () => setUbic(''),
    },
    familia && { key: 'fam', label: `Familia: ${familia}`, onQuitar: () => setFamilia('') },
    texto.trim() && { key: 'texto', label: `Busca: ${texto.trim()}`, onQuitar: () => setTexto('') },
    soloNegativos && { key: 'neg', label: 'Solo negativos', onQuitar: () => setSoloNegativos(false) },
  ].filter(Boolean) as ChipFiltro[];

  const limpiar = () => {
    setUbic('');
    setFamilia('');
    setTexto('');
    setSoloNegativos(false);
  };

  // Export client-side: baja exactamente lo que se ve, en el mismo orden (WYSIWYG).
  const exportar = () => {
    descargarCsv(
      'stock.csv',
      ['Deposito', 'Ubicacion', 'Codigo', 'Producto', 'Familia', 'Cantidad'],
      ordenadas.map((f) => [
        String(f.ubicacion_dep_id_3c),
        f.ubicacion_nombre,
        f.producto_3c,
        f.producto_nombre,
        f.producto_familia ?? '',
        dec(f.cantidad),
      ]),
    );
  };

  return (
    <section>
      <EncabezadoPagina
        titulo="Stock actual"
        bajada={data ? 'Tocá una fila para ver el kardex del producto en esa ubicación' : 'Cargando…'}
      />

      {data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tarjeta etiqueta="Ítems con stock" valor={base.length.toLocaleString('es-AR')} tono="celeste" />
          <Tarjeta etiqueta="Ubicaciones" valor={ubicaciones.length} />
          <Tarjeta etiqueta="Familias" valor={familias.length} />
          <Tarjeta
            etiqueta="En negativo"
            valor={negativos}
            tono={negativos > 0 ? 'alerta' : 'ok'}
            detalle={negativos > 0 ? 'Tocá para verlos' : 'Todo en orden'}
            onClick={negativos > 0 ? () => setSoloNegativos(true) : undefined}
          />
        </div>
      )}

      <BarraFiltros
        abierto={panelAbierto}
        onToggle={() => setPanelAbierto((v) => !v)}
        chips={chips}
        onLimpiar={limpiar}
        principal={
          <div className="relative min-w-[240px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconoLupa />
            </span>
            <input
              type="search"
              className={`${CLS_INPUT} w-full pl-9`}
              placeholder="Buscar producto por código o nombre…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
        }
        acciones={
          <button
            onClick={exportar}
            disabled={ordenadas.length === 0}
            className={`${CLS_BOTON} disabled:opacity-50`}
            title="Descarga exactamente lo que estás viendo filtrado"
          >
            <IconoDescarga />
            Descargar CSV
          </button>
        }
        avanzados={
          <>
            <Campo label="Ubicación">
              <select className={CLS_INPUT} value={ubic} onChange={(e) => setUbic(e.target.value)}>
                <option value="">Todas</option>
                {ubicaciones.map((u) => (
                  <option key={u.ubicacion_id} value={u.ubicacion_id}>
                    {u.ubicacion_dep_id_3c} — {u.ubicacion_nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Familia">
              <select className={CLS_INPUT} value={familia} onChange={(e) => setFamilia(e.target.value)}>
                <option value="">Todas</option>
                {familias.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Stock negativo">
              <label className="flex h-[38px] items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  checked={soloNegativos}
                  onChange={(e) => setSoloNegativos(e.target.checked)}
                />
                Mostrar solo negativos
              </label>
            </Campo>
          </>
        }
      />

      <Panel>
        {isLoading && <p className="p-6 text-slate-500">Cargando stock…</p>}
        {isError && (
          <p className="p-6 text-rose-700">
            Error: {(error as Error).message}. ¿Está levantado el backend en localhost:3000?
          </p>
        )}
        {data && data.length === 0 && <Vacio mensaje="Sin stock cargado." />}
        {data && data.length > 0 && ordenadas.length === 0 && (
          <Vacio
            mensaje="Ningún ítem coincide con los filtros"
            accion={
              <button onClick={limpiar} className="text-sm font-medium text-sky-600 hover:underline">
                Limpiar los filtros
              </button>
            }
          />
        )}
        {ordenadas.length > 0 && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide">
                  <ThOrden campo="ubicacion" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Ubicación
                  </ThOrden>
                  <ThOrden campo="codigo" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Código 3c
                  </ThOrden>
                  <ThOrden campo="producto" orden={orden} dir={dir} onOrdenar={ordenarPor}>
                    Producto
                  </ThOrden>
                  <th className="px-4 py-3 font-medium text-slate-500">Familia</th>
                  <ThOrden campo="cantidad" orden={orden} dir={dir} onOrdenar={ordenarPor} alineado="der">
                    Cantidad
                  </ThOrden>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((f) => {
                  const key = `${f.ubicacion_id}-${f.producto_3c}`;
                  const open = abierto === key;
                  return (
                    <Fragment key={key}>
                      <tr
                        onClick={() => setAbierto(open ? null : key)}
                        className={`cursor-pointer border-b border-slate-100 transition hover:bg-sky-50/50 ${
                          open ? 'bg-sky-50/60' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          <span className="font-mono text-xs text-slate-400">{f.ubicacion_dep_id_3c}</span>{' '}
                          {f.ubicacion_nombre}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{f.producto_3c}</td>
                        <td className="px-4 py-3 text-slate-700">
                          <span className="mr-1.5 inline-block text-slate-400">{open ? '▾' : '▸'}</span>
                          {f.producto_nombre}
                        </td>
                        <td className="px-4 py-3">
                          <EtiquetaFamilia familia={f.producto_familia} />
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
                        <tr className="border-b border-slate-100 bg-sky-50/30">
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
            <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
              Mostrando <span className="font-medium text-slate-700">{ordenadas.length.toLocaleString('es-AR')}</span>{' '}
              de {base.length.toLocaleString('es-AR')} ítems
            </div>
          </>
        )}
      </Panel>
    </section>
  );
}
