import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPut } from '../../shared/api/client';
import { CLS_BOTON, CLS_INPUT } from '../../shared/components/tabla';
import { EncabezadoPagina, EtiquetaFamilia, Panel, Tarjeta, Vacio } from '../../shared/components/ui';
import type { AlertaPrecio, ControlPrecios, FilaControlPrecio, TipoPrecio } from '../../shared/api/types';

// ─────────────────────────────────────────────────────────────────────────────
// Control de precios — la hoja de trabajo del área de compras.
//
// Responde "qué tengo que revisar y por qué", y deja arreglarlo sin salir de la fila:
// cargar la cotización de un proveedor, o marcar cuál es el precio al que se compra.
// Lo que se toca acá mueve el informe en la siguiente carga, sin reimportar nada.
//
// "Usar este precio" es el tick `Usar` de la planilla: marca esa fila como EL precio del
// producto, sea compra o actualización, y NO le cambia la categoría. Antes elegir un
// precio obligaba a pasarlo a COMPRA, o sea a mentir sobre qué era; y una actualización
// legítima —la compra fue hace seis meses y todavía queda stock— no se podía elegir sin
// eso. Si no hay ninguna marcada sigue mandando la última compra, como siempre.
// ─────────────────────────────────────────────────────────────────────────────

const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 });

const ETIQUETA_ALERTA: Record<AlertaPrecio, { texto: string; clase: string; ayuda: string }> = {
  SIN_COMPRA: {
    texto: 'sin precio de compra',
    clase: 'bg-rose-50 text-rose-700 ring-rose-200',
    ayuda: 'No tiene ningún precio marcado como compra: se está usando una actualización como respaldo.',
  },
  VENCIDO: {
    texto: 'precio vencido',
    clase: 'bg-amber-50 text-amber-700 ring-amber-200',
    ayuda: 'El precio que se usa tiene más de 90 días.',
  },
  POCAS_COTIZACIONES: {
    texto: 'faltan cotizaciones',
    clase: 'bg-orange-50 text-orange-700 ring-orange-200',
    ayuda: 'Menos de 3 proveedores con cotización vigente (últimos 6 meses).',
  },
  SALTO: {
    texto: 'salto de precio',
    clase: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
    ayuda: 'El precio saltó más de 40% en un mes. Puede ser un dedazo o un cambio de unidad.',
  },
  SIN_PROVEEDOR: {
    texto: 'sin proveedor',
    clase: 'bg-slate-100 text-slate-600 ring-slate-200',
    ayuda: 'El precio que se usa no tiene proveedor asignado, así que no se puede comparar con otros.',
  },
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesLargo = (m: string) => `${MESES[Number(m.split('-')[1]) - 1] ?? m} ${m.split('-')[0]}`;
const hoyYmd = () => new Date().toISOString().slice(0, 10);
// `controlado_en` viene como timestamp; para el cartelito alcanza el día.
const fechaCorta = (ts: string) => ts.slice(0, 10).split('-').reverse().join('/');

function Chip({ alerta }: { alerta: AlertaPrecio }) {
  const e = ETIQUETA_ALERTA[alerta];
  return (
    <span
      title={e.ayuda}
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${e.clase}`}
    >
      {e.texto}
    </span>
  );
}

export function ControlPreciosPage() {
  const [abc, setAbc] = useState('A');
  const [familia, setFamilia] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [soloRevisar, setSoloRevisar] = useState(true);
  const [alerta, setAlerta] = useState<AlertaPrecio | ''>('');
  const [abierto, setAbierto] = useState<string>('');

  const qs = `?abc=${abc}${familia ? `&familia=${encodeURIComponent(familia)}` : ''}`;
  const control = useQuery({
    queryKey: ['control-precios', abc, familia],
    queryFn: () => apiGet<ControlPrecios>(`/api/precios/control${qs}`),
  });
  const familias = useQuery({ queryKey: ['familias'], queryFn: () => apiGet<string[]>('/api/familias') });

  const items = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (control.data?.items ?? []).filter((i) => {
      if (soloRevisar && i.alertas.length === 0) return false;
      if (alerta && !i.alertas.includes(alerta)) return false;
      if (q) {
        const enProv = i.cotizaciones.some((c) => c.proveedor.toLowerCase().includes(q));
        if (!i.producto.toLowerCase().includes(q) && !i.producto_3c.includes(q) && !enProv) return false;
      }
      return true;
    });
  }, [control.data, soloRevisar, alerta, busqueda]);

  const r = control.data?.resumen;

  // Un filtro por tarjeta: tocar "Vencidos" deja solo esos.
  const filtrarPor = (a: AlertaPrecio) => {
    setAlerta(alerta === a ? '' : a);
    setSoloRevisar(true);
  };

  return (
    <div>
      <EncabezadoPagina
        titulo="Control de precios"
        bajada="Qué precios hay que revisar y por qué. Lo que corrijas acá mueve el informe en la próxima carga."
      />

      {r && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            etiqueta="Para revisar"
            valor={`${r.a_revisar}`}
            detalle={`de ${r.productos} productos`}
            tono="celeste"
          />
          <Tarjeta
            etiqueta="Faltan cotizaciones"
            valor={`${r.pocas_cotizaciones}`}
            detalle={`objetivo: ${control.data?.objetivo_cotizaciones} por producto`}
            onClick={() => filtrarPor('POCAS_COTIZACIONES')}
          />
          <Tarjeta
            etiqueta="Precio vencido"
            valor={`${r.vencidos}`}
            detalle={`más de ${control.data?.dias_vencido} días`}
            onClick={() => filtrarPor('VENCIDO')}
          />
          <Tarjeta
            etiqueta="Saltos de precio"
            valor={`${r.saltos}`}
            detalle="más de 40% en un mes"
            onClick={() => filtrarPor('SALTO')}
          />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <input
          className={`${CLS_INPUT} min-w-56 flex-1`}
          placeholder="Buscar producto, código o proveedor…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select className={CLS_INPUT} value={abc} onChange={(e) => setAbc(e.target.value)}>
          <option value="A">Prioridad A</option>
          <option value="B">Prioridad B</option>
          <option value="C">Prioridad C</option>
          <option value="TODOS">Todas las prioridades</option>
        </select>
        <select className={CLS_INPUT} value={familia} onChange={(e) => setFamilia(e.target.value)}>
          <option value="">Todas las familias</option>
          {(familias.data ?? []).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={soloRevisar}
            onChange={(e) => setSoloRevisar(e.target.checked)}
            className="rounded border-slate-300"
          />
          Solo los que hay que revisar
        </label>
        {alerta && (
          <button type="button" className={CLS_BOTON} onClick={() => setAlerta('')}>
            Quitar filtro «{ETIQUETA_ALERTA[alerta].texto}»
          </button>
        )}
      </div>

      {control.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {control.isError && <p className="text-sm text-rose-600">No se pudo cargar el control de precios.</p>}

      {control.data && (
        <Panel>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Producto</th>
                <th className="px-4 py-3 text-left font-medium">Familia</th>
                <th className="px-4 py-3 text-right font-medium">Precio de compra</th>
                <th className="px-4 py-3 text-left font-medium">Proveedor</th>
                <th className="px-4 py-3 text-center font-medium">Cotiz.</th>
                <th className="px-4 py-3 text-left font-medium">A revisar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <FilaProducto
                  key={i.producto_3c}
                  item={i}
                  abierto={abierto === i.producto_3c}
                  onToggle={() => setAbierto(abierto === i.producto_3c ? '' : i.producto_3c)}
                />
              ))}
            </tbody>
          </table>
          {items.length === 0 && (
            <Vacio
              mensaje={
                soloRevisar
                  ? 'No hay nada para revisar con estos filtros. 🎉'
                  : 'No hay productos con estos filtros.'
              }
              accion={
                soloRevisar ? (
                  <button type="button" className={CLS_BOTON} onClick={() => setSoloRevisar(false)}>
                    Ver todos
                  </button>
                ) : undefined
              }
            />
          )}
        </Panel>
      )}
    </div>
  );
}

function FilaProducto({
  item,
  abierto,
  onToggle,
}: {
  item: FilaControlPrecio;
  abierto: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="px-4 py-2.5">
          <span className={`mr-1 inline-block text-sky-600 transition ${abierto ? 'rotate-90' : ''}`}>▶</span>
          <span className="text-slate-400">{item.producto_3c}</span> <span className="text-slate-900">{item.producto}</span>
        </td>
        <td className="px-4 py-2.5">
          <EtiquetaFamilia familia={item.familia} />
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-slate-900">
          {item.precio === null ? '—' : ars.format(item.precio)}
          {item.controlado && (
            <span
              title={`Precio marcado a mano${item.controlado_por ? ` por ${item.controlado_por}` : ''}${
                item.controlado_en ? ` el ${fechaCorta(item.controlado_en)}` : ''
              }`}
              className="ml-1 text-emerald-600"
            >
              ✓
            </span>
          )}
          {item.dias !== null && (
            <span className="block text-xs text-slate-400">hace {item.dias} días</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-slate-600">{item.proveedor ?? <span className="text-slate-400">—</span>}</td>
        <td className="px-4 py-2.5 text-center">
          <span
            title={`${item.n_prov} con cotización vigente · ${item.alternativas_frescas} alternativas frescas`}
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
              item.n_prov >= 3
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : item.n_prov === 2
                  ? 'bg-amber-50 text-amber-700 ring-amber-200'
                  : 'bg-rose-50 text-rose-700 ring-rose-200'
            }`}
          >
            {item.n_prov}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <div className="flex flex-wrap gap-1">
            {item.alertas.map((a) => (
              <Chip key={a} alerta={a} />
            ))}
          </div>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-4 py-4">
            <DetalleProducto item={item} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleProducto({ item }: { item: FilaControlPrecio }) {
  const queryClient = useQueryClient();
  const invalidar = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['control-precios'] }),
      queryClient.invalidateQueries({ queryKey: ['precios'] }),
      queryClient.invalidateQueries({ queryKey: ['informe-precios'] }),
    ]);

  const proveedores = useQuery({
    queryKey: ['proveedores-lista'],
    queryFn: () => apiGet<Array<{ id: number; nombre: string }>>('/api/proveedores'),
  });

  const [precio, setPrecio] = useState('');
  const [fecha, setFecha] = useState(hoyYmd());
  const [tipo, setTipo] = useState<TipoPrecio>('COMPRA');
  const [proveedor, setProveedor] = useState('');
  const [error, setError] = useState('');

  const idPorNombre = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of proveedores.data ?? []) m.set(p.nombre.toLowerCase(), p.id);
    return m;
  }, [proveedores.data]);

  const crear = useMutation({
    mutationFn: () => {
      const nombre = proveedor.trim();
      const proveedorId = nombre ? idPorNombre.get(nombre.toLowerCase()) : undefined;
      if (nombre && proveedorId === undefined) {
        throw new Error(`No encuentro el proveedor «${nombre}». Elegilo de la lista.`);
      }
      return apiPost('/api/precios', {
        producto_3c: item.producto_3c,
        precio: Number(precio),
        tipo,
        vigente_desde: fecha,
        proveedor_id: proveedorId ?? null,
      });
    },
    onSuccess: async () => {
      setPrecio('');
      setProveedor('');
      setError('');
      await invalidar();
    },
    onError: (e: Error) => setError(e.message),
  });

  // El "tick Usar" de la planilla. NO cambia la categoría de la fila: una actualización
  // marcada sigue siendo una actualización, pero pasa a ser EL precio del producto y le
  // gana a la última compra. Uno solo por producto: marcar otro desmarca el anterior.
  const marcar = useMutation({
    mutationFn: ({ precioId, controlado }: { precioId: number; controlado: boolean }) =>
      apiPut(`/api/precios/${precioId}/controlado`, { controlado }),
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  const puedeGuardar = precio !== '' && Number(precio) > 0 && !crear.isPending;

  return (
    <div className="space-y-4">
      {item.salto && (
        <p className="rounded-lg bg-fuchsia-50 px-3 py-2 text-xs text-fuchsia-800 ring-1 ring-inset ring-fuchsia-200">
          En {mesLargo(item.salto.mes)} el precio pasó de {ars.format(item.salto.de)} a {ars.format(item.salto.a)} (
          {item.salto.var > 0 ? '+' : ''}
          {(item.salto.var * 100).toFixed(1)}%). Verificá que no sea un error de carga o un cambio de unidad.
        </p>
      )}

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Última cotización de cada proveedor
        </h4>
        <p className="mb-2 text-xs text-slate-400">
          El ✓ es el precio que usa la app. «Usar este precio» fija cualquiera de estas filas como el precio del
          producto —aunque sea una actualización— y no le cambia la categoría. Sin marca manda la última compra.
        </p>
        {item.cotizaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Sin cotizaciones cargadas.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-200">
              {item.cotizaciones.map((c) => (
                <tr key={c.precio_id} className={c.es_usado ? 'bg-emerald-50' : undefined}>
                  <td className="py-2 pr-3">
                    {c.es_usado && (
                      <span title="Es el precio que se usa" className="mr-1 font-bold text-emerald-600">
                        ✓
                      </span>
                    )}
                    {c.proveedor}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium text-slate-900">
                    {ars.format(c.precio)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-500">
                    {c.fecha} · hace {c.dias} días
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                        c.tipo === 'COMPRA'
                          ? 'bg-sky-50 text-sky-700 ring-sky-200'
                          : 'bg-slate-100 text-slate-600 ring-slate-200'
                      }`}
                    >
                      {c.tipo === 'COMPRA' ? 'compra' : 'actualización'}
                    </span>
                    {c.controlado && (
                      <span
                        title={`Marcado a mano como el precio de este producto${
                          c.controlado_por ? ` por ${c.controlado_por}` : ''
                        }${c.controlado_en ? ` el ${fechaCorta(c.controlado_en)}` : ''}`}
                        className="ml-2 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      >
                        controlado
                      </span>
                    )}
                    {!c.vigente && <span className="ml-2 text-xs text-rose-600">vencida</span>}
                  </td>
                  <td className="py-2 text-right">
                    {/* Se puede marcar cualquier fila, sea compra o actualización: la marca
                        es la decisión de compras y le gana a la categoría. */}
                    <button
                      type="button"
                      className={CLS_BOTON}
                      disabled={marcar.isPending}
                      onClick={() => marcar.mutate({ precioId: c.precio_id, controlado: !c.controlado })}
                    >
                      {c.controlado ? 'Quitar la marca' : 'Usar este precio'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Cargar una cotización</h4>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-500">
            Proveedor
            <input
              className={`${CLS_INPUT} mt-1 block w-64`}
              list={`prov-${item.producto_3c}`}
              placeholder="Buscar proveedor…"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
            />
            <datalist id={`prov-${item.producto_3c}`}>
              {(proveedores.data ?? []).map((p) => (
                <option key={p.id} value={p.nombre} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-slate-500">
            Precio
            <input
              className={`${CLS_INPUT} mt-1 block w-32`}
              type="number"
              step="0.01"
              min="0"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-500">
            Fecha
            <input
              className={`${CLS_INPUT} mt-1 block`}
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-500">
            Tipo
            <select
              className={`${CLS_INPUT} mt-1 block`}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoPrecio)}
            >
              <option value="COMPRA">Compra (es el que se paga)</option>
              <option value="ACTUALIZACION">Cotización (referencia)</option>
            </select>
          </label>
          <button
            type="button"
            className={CLS_BOTON}
            disabled={!puedeGuardar}
            onClick={() => crear.mutate()}
          >
            {crear.isPending ? 'Guardando…' : 'Agregar'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Sin proveedor la cotización no se puede comparar con las de otros, así que no cuenta para la cobertura ni
          para el ahorro potencial.
        </p>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
