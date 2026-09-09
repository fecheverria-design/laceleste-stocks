import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPut, descargarArchivo } from '../../shared/api/client';
import type { Abastecimiento, CasoAbastecimiento, VeredictoManual } from '../../shared/api/types';
import { BarraFiltros, Campo, type ChipFiltro } from '../../shared/components/filtros';
import { IconoDescarga, IconoLupa } from '../../shared/components/iconos';
import { CLS_BOTON, CLS_INPUT, Paginacion } from '../../shared/components/tabla';
import { EncabezadoPagina, Panel, Tarjeta, Vacio } from '../../shared/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// ¿Despachó lo que había que despachar?
//
// Compara el pedido contra el despacho por (día, área, producto), y marca solo lo que no
// explica ninguna razón legítima. Lo importante de esta pantalla no es el porcentaje: es la
// LISTA de lo que difiere, para revisarla de a una con un check. Lo que se marca a mano le
// gana a la regla, y queda con nombre y fecha.
// ─────────────────────────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const LIMITE = 50;

const MOTIVOS: Record<string, string> = {
  EXACTO: 'exacto',
  HORMA: 'redondeo a pieza entera',
  RELATIVA: 'dentro de la tolerancia',
  ABSOLUTA: 'una unidad',
};

const hoyYmd = () => new Date().toISOString().slice(0, 10);
const haceDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

type Filtro = 'DIFIEREN' | 'PENDIENTES' | 'TODOS';

const FILTROS: { valor: Filtro; label: string }[] = [
  { valor: 'DIFIEREN', label: 'Los que difieren' },
  { valor: 'PENDIENTES', label: 'Sin revisar' },
  { valor: 'TODOS', label: 'Todos' },
];

export function AbastecimientoPanel() {
  const [desde, setDesde] = useState(haceDias(29));
  const [hasta, setHasta] = useState(hoyYmd());
  const [filtro, setFiltro] = useState<Filtro>('DIFIEREN');
  const [texto, setTexto] = useState('');
  const [area, setArea] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [page, setPage] = useState(1);
  const [notaAbierta, setNotaAbierta] = useState<string | null>(null);

  const qc = useQueryClient();
  const qs = `?desde=${desde}&hasta=${hasta}`;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['abastecimiento', desde, hasta],
    queryFn: () => apiGet<Abastecimiento>(`/api/abastecimiento${qs}`),
  });

  const revisar = useMutation({
    mutationFn: (v: {
      caso: CasoAbastecimiento;
      veredicto: VeredictoManual | null;
      nota?: string | null;
    }) =>
      apiPut('/api/abastecimiento/revision', {
        fecha: v.caso.fecha,
        area_dep_3c: v.caso.area_dep_3c,
        producto_3c: v.caso.producto_3c,
        veredicto: v.veredicto,
        nota: v.nota ?? v.caso.revision?.nota ?? null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['abastecimiento'] });
    },
  });

  const q = texto.trim().toLowerCase();
  const casos = useMemo(() => {
    return (data?.casos ?? []).filter((c) => {
      if (c.recalibrar) return false; // tienen su propia lista
      if (filtro === 'DIFIEREN' && c.bien) return false;
      if (filtro === 'PENDIENTES' && (c.bien || c.revision !== null)) return false;
      if (area && String(c.area_dep_3c) !== area) return false;
      if (q && !c.producto_nombre.toLowerCase().includes(q) && !c.producto_3c.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filtro, area, q]);

  const pagina = casos.slice((page - 1) * LIMITE, page * LIMITE);
  const total = data?.total;

  const chips: ChipFiltro[] = [];
  if (area) {
    const nombre = data?.areas.find((a) => String(a.area_dep_3c) === area)?.area_nombre ?? area;
    chips.push({ key: 'area', label: `Área: ${nombre}`, onQuitar: () => setArea('') });
  }

  return (
    <section>
      <EncabezadoPagina
        titulo="¿Se despachó lo que había que despachar?"
        bajada={
          data
            ? `${data.desde} → ${data.hasta} · el pedido contra lo abastecido, día por día`
            : 'Cargando…'
        }
        acciones={
          <button
            onClick={() => void descargarArchivo(`/api/abastecimiento/export.csv${qs}`, 'abastecimiento.csv')}
            className={CLS_BOTON}
          >
            <IconoDescarga />
            Descargar CSV
          </button>
        }
      />

      {isLoading && <p className="text-slate-500">Cargando…</p>}
      {isError && <p className="text-rose-600">{(error as Error).message}</p>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta
              etiqueta="Bien abastecido"
              valor={total?.bien_pct === null || total === undefined ? '—' : `${nf.format(total.bien_pct)}%`}
              detalle={`${nf.format(total?.bien ?? 0)} de ${nf.format(total?.casos ?? 0)} casos`}
              tono="ok"
            />
            <Tarjeta
              etiqueta="Despachó de más"
              valor={nf.format(total?.de_mas ?? 0)}
              detalle="por encima de lo que el pedido justifica"
              tono="alerta"
            />
            <Tarjeta etiqueta="Quedó corto" valor={nf.format(total?.de_menos ?? 0)} detalle="por debajo del pedido" />
            <Tarjeta
              etiqueta="Sin revisar"
              valor={nf.format(total?.pendientes_de_revisar ?? 0)}
              detalle={`${nf.format(total?.revisados ?? 0)} ya revisados a mano`}
              tono="celeste"
              onClick={() => {
                setFiltro('PENDIENTES');
                setPage(1);
              }}
            />
          </div>

          <p className="mb-5 text-xs text-slate-500">
            Se marca solo lo que no explica ninguna razón legítima: el redondeo a la pieza entera, una tolerancia del{' '}
            {nf.format((data.tolerancias.relativa ?? 0) * 100)}% en lo que se pesa o se corta, y una unidad de
            diferencia siempre.{' '}
            <strong className="font-medium text-slate-600">
              Lo que marcás vos acá le gana a la regla y queda con tu nombre.
            </strong>
          </p>

          {/* Productos con sesgo sistemático: el problema es el pedido, no el despacho. */}
          {data.recalibrar.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50">
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-amber-900">
                  {data.recalibrar.length} producto{data.recalibrar.length === 1 ? '' : 's'} para recalibrar el pedido
                </h3>
                <p className="text-xs text-amber-800">
                  Fallan casi todos los días para el mismo lado. Nadie se equivoca 45 de 46 veces en la misma
                  dirección: ahí lo que está mal es el sugerido, no el despacho. Quedan fuera del porcentaje de arriba
                  ({nf.format(total?.casos_recalibrar ?? 0)} casos).
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-amber-900/70">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Producto</th>
                      <th className="px-4 py-2 text-left font-medium">Área</th>
                      <th className="px-4 py-2 text-left font-medium">Presentación</th>
                      <th className="px-4 py-2 text-right font-medium">Días</th>
                      <th className="px-4 py-2 text-right font-medium">Falla</th>
                      <th className="px-4 py-2 text-right font-medium">Se despacha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {data.recalibrar.map((p) => (
                      <tr key={`${p.area_dep_3c}-${p.producto_3c}`}>
                        <td className="px-4 py-2">
                          <p className="font-medium text-slate-800">{p.producto_nombre}</p>
                          <p className="text-xs text-slate-500">
                            {p.producto_3c}
                            {p.unidad_base ? ` · ${p.unidad_base}` : ''}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{p.area_nombre}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{p.presentacion_compra ?? '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">{p.dias}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {p.marcados} ({Math.round((100 * p.marcados) / p.dias)}%)
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-amber-800">
                          {nf.format(p.ratio_medio)}× lo pedido
                          <span className="ml-1 text-xs font-normal text-slate-500">±{nf.format(p.desvio)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <BarraFiltros
            abierto={abierto}
            onToggle={() => setAbierto((v) => !v)}
            chips={chips}
            onLimpiar={() => {
              setArea('');
              setTexto('');
              setPage(1);
            }}
            principal={
              <>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <IconoLupa />
                  </span>
                  <input
                    value={texto}
                    onChange={(e) => {
                      setTexto(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Buscar producto…"
                    className={`${CLS_INPUT} w-64 pl-9`}
                  />
                </div>
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                  {FILTROS.map((f) => (
                    <button
                      key={f.valor}
                      type="button"
                      onClick={() => {
                        setFiltro(f.valor);
                        setPage(1);
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        filtro === f.valor ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            }
            avanzados={
              <>
                <Campo label="Desde">
                  <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={CLS_INPUT} />
                </Campo>
                <Campo label="Hasta">
                  <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={CLS_INPUT} />
                </Campo>
                <Campo label="Área">
                  <select
                    value={area}
                    onChange={(e) => {
                      setArea(e.target.value);
                      setPage(1);
                    }}
                    className={CLS_INPUT}
                  >
                    <option value="">Todas</option>
                    {data.areas.map((a) => (
                      <option key={a.area_dep_3c} value={a.area_dep_3c}>
                        {a.area_nombre} ({a.bien_pct === null ? '—' : `${nf.format(a.bien_pct)}%`})
                      </option>
                    ))}
                  </select>
                </Campo>
              </>
            }
          />

          <Panel>
            {casos.length === 0 ? (
              <Vacio mensaje="No hay casos con esos filtros." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Día</th>
                        <th className="px-4 py-3 text-left font-medium">Producto</th>
                        <th className="px-4 py-3 text-right font-medium">Pedido</th>
                        <th className="px-4 py-3 text-right font-medium">Despachó</th>
                        <th className="px-4 py-3 text-right font-medium">Diferencia</th>
                        <th className="px-4 py-3 text-left font-medium">Correcto era</th>
                        <th className="px-4 py-3 text-left font-medium">¿Estuvo bien?</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pagina.map((c) => {
                        const id = `${c.fecha}|${c.area_dep_3c}|${c.producto_3c}`;
                        return (
                          <tr key={id} className={c.revision ? 'bg-sky-50/40' : undefined}>
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                              {c.fecha.slice(8, 10)}/{c.fecha.slice(5, 7)}
                              <p className="text-xs text-slate-400">{c.area_nombre}</p>
                            </td>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-slate-800">{c.producto_nombre}</p>
                              <p className="text-xs text-slate-400">
                                {c.producto_3c}
                                {c.unidad_base ? ` · ${c.unidad_base}` : ''}
                                {c.presentacion_compra ? ` · ${c.presentacion_compra}` : ''}
                              </p>
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{nf.format(c.pedido)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">
                              {nf.format(c.despacho)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                                c.diferencia > 0 ? 'text-sky-700' : 'text-rose-600'
                              }`}
                            >
                              {c.diferencia > 0 ? '+' : ''}
                              {nf.format(c.diferencia)}
                              {c.diferencia_pct !== null && (
                                <span className="ml-1 text-xs font-normal text-slate-400">
                                  ({c.diferencia_pct > 0 ? '+' : ''}
                                  {nf.format(c.diferencia_pct)}%)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-500">
                              {c.piso === c.techo ? nf.format(c.piso) : `${nf.format(c.piso)} a ${nf.format(c.techo)}`}
                              {c.motivo && <p className="text-slate-400">{MOTIVOS[c.motivo] ?? c.motivo}</p>}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={revisar.isPending}
                                  onClick={() =>
                                    revisar.mutate({
                                      caso: c,
                                      veredicto: c.revision?.veredicto === 'BIEN' ? null : 'BIEN',
                                    })
                                  }
                                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                                    c.revision?.veredicto === 'BIEN'
                                      ? 'bg-emerald-600 text-white ring-emerald-600'
                                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-emerald-50'
                                  }`}
                                  title="Estuvo bien abastecido"
                                >
                                  ✓ Bien
                                </button>
                                <button
                                  type="button"
                                  disabled={revisar.isPending}
                                  onClick={() =>
                                    revisar.mutate({
                                      caso: c,
                                      veredicto: c.revision?.veredicto === 'MAL' ? null : 'MAL',
                                    })
                                  }
                                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${
                                    c.revision?.veredicto === 'MAL'
                                      ? 'bg-rose-600 text-white ring-rose-600'
                                      : 'bg-white text-slate-600 ring-slate-300 hover:bg-rose-50'
                                  }`}
                                  title="Estuvo mal abastecido"
                                >
                                  ✗ Mal
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNotaAbierta(notaAbierta === id ? null : id)}
                                  className="rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                                  title="Anotar por qué"
                                >
                                  ✎
                                </button>
                              </div>
                              {c.revision && (
                                <p className="mt-1 text-xs text-slate-400">
                                  {c.revision.por} · {c.revision.cuando}
                                  {c.revision.nota ? ` · ${c.revision.nota}` : ''}
                                </p>
                              )}
                              {notaAbierta === id && (
                                <form
                                  className="mt-2 flex items-center gap-1"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const nota = new FormData(e.currentTarget).get('nota');
                                    revisar.mutate({
                                      caso: c,
                                      veredicto: c.revision?.veredicto ?? 'BIEN',
                                      nota: String(nota ?? ''),
                                    });
                                    setNotaAbierta(null);
                                  }}
                                >
                                  <input
                                    name="nota"
                                    defaultValue={c.revision?.nota ?? ''}
                                    placeholder="Por qué…"
                                    autoFocus
                                    className={`${CLS_INPUT} w-48 py-1 text-xs`}
                                  />
                                  <button type="submit" className="text-xs font-medium text-sky-600 hover:underline">
                                    Guardar
                                  </button>
                                </form>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Paginacion page={page} limit={LIMITE} total={casos.length} onPage={setPage} />
              </>
            )}
          </Panel>
        </>
      )}
    </section>
  );
}
