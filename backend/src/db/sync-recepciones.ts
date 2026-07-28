import { eq } from 'drizzle-orm';
import { db, pool } from './client.js';
import { proveedores } from './schema.js';
import { existentesEnMaestro, notaFaltantes, separarPorMaestro } from './sync-maestro.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import { reconciliarBajas, registrarRecepcion } from '../services/movimientos.service.js';
import { AppError } from '../domain/errors.js';
import type { RecepcionInput } from '../domain/movimientos.schema.js';

// Sincroniza recepciones de mercadería desde la app del compañero (app_ordenes_produccion)
// → las materializa como RECEPCION auto-confirmadas en nuestra DB (suma stock). Es PULL:
// nosotros leemos de SU API REST; su app NO se toca ni sabe de nosotros.
//
// A diferencia del abastecimiento (1 GET con cantidades), la recepción son DOS pasos:
//   1) GET /api/recepciones?fecha=YYYY-MM-DD  → agenda de recepciones del día + sus ítems.
//      Cada ítem trae estado_recepcion y `tiene_bpm` (si pasó por control BPM/pesado).
//   2) GET /api/bpm/recepcion/:id  → por recepción, los ítems con su BPM. La CANTIDAD
//      recibida vive solo acá: `cantidad_total` (en unidades base) — NO en el ítem.
//
// Por eso solo se materializan los ítems CON BPM y cantidad_total > 0 (lo demás es
// agenda sin cantidad → no mueve stock). Una recepción = un movimiento RECEPCION.
// Origen = depósito del proveedor (RECEPCION_ORIGEN_DEP_ID_3C, default 102 = balde
// genérico de proveedores, sin stock propio). Destino = FABRICA (DEPOSITO_PRINCIPAL).
// Idempotente vía idempotency_key = `recep:<id>` (el id de recepción es único en su app):
// re-sincronizar la misma fecha NO duplica.
//
// MODO RECONCILIAR (sync en vivo): el service se llama con { reconciliar: true }. Si la
// RECEPCION #id YA existe, en vez de dejarla como estaba la REEDITA con el estado fresco
// (si después del primer pull pasaron más ítems por BPM o corrigieron una cantidad, se
// refleja) → auditado + stock recalculado. Sin cambios = no-op. Por eso sirve correr cada ~1h.
//
// RECONCILIACIÓN DE BAJAS: además de altas y cambios, cada corrida chequea lo que
// materializamos y la app del compañero YA NO lista en la ventana. Si la recepción fue
// BORRADA allá (el id no existe en ninguna fecha) → la ANULAMOS acá (revierte stock). Si
// solo la REPROGRAMARON → se avisa y no se toca (anular es irreversible; cuando su fecha
// nueva entre en la ventana, el modo reconciliar la corrige sola). Sin esto, una entrada
// duplicada que ellos borran nos deja la mercadería contada dos veces (caso LOGINCOR 04/07).
//
// RENGLONES SIN CANTIDAD: la cantidad recibida SOLO vive en el BPM. Un ítem de la agenda sin
// BPM no tiene cantidad en ningún lado → es imposible materializarlo. No se inventa: se avisa
// ítem por ítem (⚠ incompleta) para que ese día se cargue del export de 3c (import:movimientos).
//
// VENTANA MÓVIL: sin argumentos, sincroniza HOY + los VENTANA_DIAS_ATRAS días previos
// (default 2). Autorrecupera días perdidos si la PC estuvo apagada; los días sin novedad
// son no-op. --fecha / --desde/--hasta siguen mandando.
//
// Uso:
//   npm run sync:recepciones                               (hoy + 2 días atrás)
//   npm run sync:recepciones -- --fecha=2026-06-26 [--dry]
//   npm run sync:recepciones -- --desde=2026-06-01 --hasta=2026-06-30 [--dry]
//
// Config (.env): COMPANERO_API_URL/USER/PASS, DEPOSITO_PRINCIPAL_DEP_ID_3C (destino),
//   RECEPCION_ORIGEN_DEP_ID_3C (opcional, default 102),
//   VENTANA_DIAS_ATRAS (opcional, default 2: días hacia atrás de la ventana móvil).

interface ItemRecepcion {
  id: number;
  articulo_codigo: string | number | null;
  articulo_nombre: string | null;
  estado_recepcion: string | null;
  tiene_bpm?: boolean;
}

interface Recepcion {
  id: number;
  fecha: string; // ISO (se recorta a YYYY-MM-DD)
  cod_proveedor: number | string | null;
  proveedor_nombre: string | null;
  items: ItemRecepcion[];
}

interface BpmItem {
  item_id: number;
  articulo_codigo: string | number | null;
  articulo_nombre: string | null;
  bpm_id: number | null;
  cantidad_total: string | number | null;
  unidad: string | null;
}

function parseArgs(argv: string[]): { fechas: string[]; dry: boolean } {
  let fecha: string | undefined;
  let desde: string | undefined;
  let hasta: string | undefined;
  let dry = false;
  for (const a of argv) {
    if (a === '--dry') dry = true;
    else if (a.startsWith('--fecha=')) fecha = a.slice('--fecha='.length);
    else if (a.startsWith('--desde=')) desde = a.slice('--desde='.length);
    else if (a.startsWith('--hasta=')) hasta = a.slice('--hasta='.length);
  }

  const RE = /^\d{4}-\d{2}-\d{2}$/;
  if (fecha) {
    if (!RE.test(fecha)) throw new Error(`--fecha inválida: ${fecha} (esperado YYYY-MM-DD)`);
    return { fechas: [fecha], dry };
  }
  if (desde || hasta) {
    if (!desde || !hasta || !RE.test(desde) || !RE.test(hasta)) {
      throw new Error('Para un rango pasá --desde=YYYY-MM-DD --hasta=YYYY-MM-DD (ambas válidas)');
    }
    return { fechas: rangoFechas(desde, hasta), dry };
  }
  // Sin argumentos → VENTANA MÓVIL: hoy + N días atrás (default 2, VENTANA_DIAS_ATRAS).
  // Modo del scheduler: reconcilia lo reciente y autorrecupera días perdidos. Días sin
  // cambios = no-op (modo reconciliar).
  return { fechas: aplicarPiso(ventanaMovil(diasAtrasEnv())), dry };
}

// Piso de reconciliación: la ventana móvil NUNCA sincroniza fechas anteriores a SYNC_PISO
// (YYYY-MM-DD). Es el corte con el histórico de 3c: lo <= piso lo cubre el import de 3c
// (con nro_3c); el sync (sin nro_3c) sólo toca de ahí en adelante, sin solaparse ni
// duplicar. No afecta --fecha/--desde/--hasta (cargas manuales explícitas).
function aplicarPiso(fechas: string[]): string[] {
  const piso = process.env.SYNC_PISO?.trim();
  if (!piso) return fechas;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(piso)) throw new Error(`SYNC_PISO inválido: ${piso} (esperado YYYY-MM-DD)`);
  return fechas.filter((f) => f >= piso);
}

// Cuántos días hacia atrás barre la ventana móvil (además de hoy). Default 2.
function diasAtrasEnv(): number {
  const raw = process.env.VENTANA_DIAS_ATRAS?.trim();
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`VENTANA_DIAS_ATRAS inválido: ${raw} (entero >= 0)`);
  return n;
}

// [hoy - diasAtras … hoy] como YYYY-MM-DD, en fecha LOCAL (no UTC) para no correrse un día.
function ventanaMovil(diasAtras: number): string[] {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = hoy.getMonth();
  const d = hoy.getDate();
  const out: string[] = [];
  for (let i = diasAtras; i >= 0; i--) {
    const f = new Date(y, m, d - i);
    const yyyy = f.getFullYear();
    const mm = String(f.getMonth() + 1).padStart(2, '0');
    const dd = String(f.getDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

// Lista de fechas YYYY-MM-DD inclusive, en UTC para no correrse por timezone.
function rangoFechas(desde: string, hasta: string): string[] {
  const out: string[] = [];
  const d = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  if (d > fin) throw new Error('--desde no puede ser posterior a --hasta');
  while (d <= fin) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function requireEnv(nombre: string): string {
  const v = process.env[nombre];
  if (!v || v.trim() === '') {
    throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  }
  return v.trim();
}

// Login contra SU API: POST /api/auth/login {usuario, password} → { token }.
async function login(baseUrl: string, usuario: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; token?: string; message?: string };
  if (!res.ok || !json.success || !json.token) {
    throw new Error(`Login a la API del compañero falló (${res.status}): ${json.message ?? 'sin detalle'}`);
  }
  return json.token;
}

// Lista paginada de recepciones de un día (sigue `hayMas` hasta agotar).
async function fetchRecepciones(baseUrl: string, token: string, fecha: string): Promise<Recepcion[]> {
  const out: Recepcion[] = [];
  let offset = 0;
  const limit = 60;
  for (;;) {
    const res = await fetch(`${baseUrl}/api/recepciones?fecha=${fecha}&limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: Recepcion[];
      hayMas?: boolean;
      message?: string;
    };
    if (!res.ok || !json.success) {
      throw new Error(`recepciones (${fecha}) falló (${res.status}): ${json.message ?? 'sin detalle'}`);
    }
    out.push(...(json.data ?? []));
    if (!json.hayMas || (json.data ?? []).length === 0) break;
    offset += limit;
  }
  return out;
}

// Índice completo de recepciones del origen (id → fecha), sin filtrar por fecha. Se usa solo
// cuando hay huérfanas, para distinguir BORRADA (no está en ninguna fecha) de REPROGRAMADA
// (está, con otra fecha). Son ~500 filas → unas pocas páginas.
async function fetchIndiceRecepciones(baseUrl: string, token: string): Promise<Map<number, string>> {
  const indice = new Map<number, string>();
  let offset = 0;
  const limit = 100;
  for (;;) {
    const res = await fetch(`${baseUrl}/api/recepciones?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: Recepcion[];
      hayMas?: boolean;
      message?: string;
    };
    if (!res.ok || !json.success) {
      throw new Error(`índice de recepciones falló (${res.status}): ${json.message ?? 'sin detalle'}`);
    }
    const data = json.data ?? [];
    for (const r of data) indice.set(r.id, (r.fecha ?? '').slice(0, 10));
    if (!json.hayMas || data.length === 0) break;
    offset += limit;
  }
  return indice;
}

async function fetchBpm(baseUrl: string, token: string, recepcionId: number): Promise<BpmItem[]> {
  const res = await fetch(`${baseUrl}/api/bpm/recepcion/${recepcionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: BpmItem[]; message?: string };
  if (!res.ok || !json.success) {
    throw new Error(`bpm/recepcion/${recepcionId} falló (${res.status}): ${json.message ?? 'sin detalle'}`);
  }
  return json.data ?? [];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function aNumero(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface RenglonRecep {
  producto_3c: string;
  cantidad_real: number;
  unidad: string;
}

// Resuelve el cod_proveedor de 3c (que la app de Tincho manda en la recepción) a nuestro
// proveedores.id vía numero_3c (regla #1: los ids de 3c mandan). Cachea por corrida para
// no repetir la query. Devuelve null si el proveedor no está en nuestro maestro (la
// recepción igual se materializa; queda sin proveedor asociado hasta importar el maestro).
const cacheProveedor = new Map<number, number | null>();
async function resolverProveedorId(cod: number | string | null): Promise<number | null> {
  const num = cod === null || cod === undefined ? null : Number(cod);
  if (num === null || !Number.isInteger(num) || num <= 0) return null;
  if (cacheProveedor.has(num)) return cacheProveedor.get(num)!;
  const [row] = await db
    .select({ id: proveedores.id })
    .from(proveedores)
    .where(eq(proveedores.numero3c, num))
    .limit(1);
  const id = row?.id ?? null;
  cacheProveedor.set(num, id);
  return id;
}

async function main(): Promise<void> {
  const { fechas, dry } = parseArgs(process.argv.slice(2));
  const baseUrl = requireEnv('COMPANERO_API_URL').replace(/\/+$/, '');
  const usuario = requireEnv('COMPANERO_API_USER');
  const password = requireEnv('COMPANERO_API_PASS');
  // Origen = balde/depósito del proveedor. Default 102 (DEPOSITO DE PROVEEDORES, sin stock).
  const origenDep = Number(process.env.RECEPCION_ORIGEN_DEP_ID_3C?.trim() || '102');
  if (!Number.isInteger(origenDep) || origenDep <= 0) {
    throw new Error(`RECEPCION_ORIGEN_DEP_ID_3C inválido: ${process.env.RECEPCION_ORIGEN_DEP_ID_3C}`);
  }

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new Error('Falta el usuario de integración en nuestra DB (corré npm run db:seed)');
  }

  console.log(`▶ Sync recepciones ${dry ? '(DRY-RUN) ' : ''}desde ${baseUrl} (origen ${origenDep} → FABRICA)`);
  console.log(`  Fechas: ${fechas.length === 1 ? fechas[0] : `${fechas[0]} … ${fechas[fechas.length - 1]} (${fechas.length})`}`);

  const token = await login(baseUrl, usuario, password);
  console.log('  Login OK.');

  let movimientos = 0;
  let renglones = 0;
  let saltadasSinBpm = 0;
  let prodSalteados = 0;
  let provNoResuelto = 0;
  let errores = 0;
  let incompletas = 0;
  let itemsSinCantidad = 0;
  // Ids de recepción que la app del compañero SÍ listó en la ventana (aunque no se
  // materialicen: sin BPM, sin producto en el maestro, etc.). Lo que tenemos nosotros y no
  // está acá es una baja → reconciliarBajas() decide si anular.
  const vistas = new Set<number>();

  for (const fecha of fechas) {
    const recepciones = await fetchRecepciones(baseUrl, token, fecha);
    if (recepciones.length === 0) {
      console.log(`  ${fecha}: sin recepciones.`);
      continue;
    }

    for (const r of recepciones) {
      vistas.add(r.id);
      // Solo tiene sentido pedir el BPM si algún ítem pasó por control (tiene cantidad).
      const conBpm = r.items?.some((i) => i.tiene_bpm) ?? false;
      if (!conBpm) {
        saltadasSinBpm++;
        continue;
      }

      const bpm = await fetchBpm(baseUrl, token, r.id);
      const candidatos: RenglonRecep[] = [];
      for (const b of bpm) {
        const cant = aNumero(b.cantidad_total);
        if (cant === null || cant <= 0) continue;
        const prod = b.articulo_codigo === null || b.articulo_codigo === undefined ? '' : String(b.articulo_codigo).trim();
        if (prod === '') continue;
        candidatos.push({
          producto_3c: prod,
          cantidad_real: round3(cant),
          unidad: (b.unidad ?? '').trim() || 'UNIDAD',
        });
      }
      if (candidatos.length === 0) {
        saltadasSinBpm++;
        continue;
      }

      // Ítems de la agenda que NO aportan cantidad (sin BPM, o BPM en 0). La cantidad solo
      // vive en el BPM, así que estos renglones son imposibles de materializar: la recepción
      // entra INCOMPLETA. Se avisan uno por uno en vez de desaparecer en silencio — así se
      // ve que ese día hay que completarlo con el export de 3c (import:movimientos).
      const conCantidad = new Set(candidatos.map((c) => c.producto_3c));
      const sinCantidad = (r.items ?? []).filter((i) => {
        const cod = i.articulo_codigo === null || i.articulo_codigo === undefined ? '' : String(i.articulo_codigo).trim();
        return cod !== '' && !conCantidad.has(cod);
      });
      if (sinCantidad.length > 0) {
        incompletas++;
        itemsSinCantidad += sinCantidad.length;
        const lista = sinCantidad.map((i) => `${i.articulo_codigo} ${i.articulo_nombre ?? ''}`.trim()).join(', ');
        console.log(
          `    ⚠ recep #${r.id} ${r.proveedor_nombre ?? ''}: ${sinCantidad.length} ítem(s) SIN cantidad (sin BPM) → ${lista}`,
        );
      }

      // Pre-filtra productos inexistentes en nuestro maestro: así una recepción no se
      // pierde entera por un artículo que aún no está en 3c (se saltea ese renglón).
      // Mismo criterio que el sync de abastecimientos, ver sync-maestro.ts.
      const existentes = await existentesEnMaestro(candidatos.map((c) => c.producto_3c));
      const { detalle, faltantes } = separarPorMaestro(candidatos, existentes);
      const faltan = candidatos.length - detalle.length;
      if (faltan > 0) {
        prodSalteados += faltan;
        console.log(
          `    ⚠ recep #${r.id} ${r.proveedor_nombre ?? ''}: ${faltantes.length} producto(s) sin alta en el maestro → ${faltantes.join(', ')} (renglón salteado; entra solo al darlos de alta)`,
        );
      }
      if (detalle.length === 0) {
        console.log(`  ⚠ ${fecha} recep #${r.id} (${r.proveedor_nombre ?? '?'}): ${faltan} artículo(s) no están en el maestro → recepción salteada.`);
        continue;
      }

      // Proveedor real de la mercadería (además del balde 102 que usa el stock).
      const proveedorId = await resolverProveedorId(r.cod_proveedor);
      const provNota = proveedorId === null && r.cod_proveedor ? ` ⚠ proveedor #${r.cod_proveedor} no está en el maestro` : '';
      if (provNota) provNoResuelto++;

      const input: RecepcionInput = {
        idempotency_key: `recep:${r.id}`,
        origen_dep_id_3c: origenDep,
        // destino omitido → DEPOSITO_PRINCIPAL (FABRICA)
        fecha: (r.fecha ?? fecha).slice(0, 10),
        proveedor_id: proveedorId,
        detalle,
        observaciones:
          `Sync recepción #${r.id} ${r.proveedor_nombre ?? ''} (${fecha})`.trim() + notaFaltantes(faltantes),
      };

      if (dry) {
        console.log(`    [dry] recep #${r.id} ${r.proveedor_nombre ?? ''}: ${detalle.length} renglón(es)${faltan ? ` (+${faltan} salteado)` : ''}${provNota}`);
        movimientos++;
        renglones += detalle.length;
        continue;
      }

      try {
        // reconciliar: si la RECEPCION de este id ya existe, el service la REEDITA con el
        // estado fresco (más ítems por BPM / cantidad corregida) en vez de dejarla igual;
        // auditado y con stock recalculado. Sin cambios = no-op. No duplica.
        const mov = await registrarRecepcion(input, { usuarioId, reconciliar: true });
        movimientos++;
        renglones += detalle.length;
        console.log(`    ✔ ${mov.nro} ← recep #${r.id} ${r.proveedor_nombre ?? ''} (${detalle.length} renglón/es)${provNota}`);
      } catch (e) {
        errores++;
        const msg = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        console.error(`    ✗ recep #${r.id} (${fecha}): ${msg}`);
      }
    }
  }

  // BAJAS: lo que tenemos materializado y la app del compañero ya no lista en estas fechas.
  // Borrada allá → anular acá (revierte stock). Reprogramada → avisar, no tocar.
  const { anuladas, reprogramadas } = await reconciliarBajas(
    'recep:',
    fechas,
    vistas,
    () => fetchIndiceRecepciones(baseUrl, token),
    { usuarioId, dry },
  );
  for (const a of anuladas) {
    console.log(
      `    ⌫ ${a.nro} (recep #${a.externoId}, ${a.fecha}) ya no existe en la app del compañero → ${dry ? '[dry] se ANULARÍA' : 'ANULADO'} (stock revertido)`,
    );
  }
  for (const r of reprogramadas) {
    console.log(
      `    ⚠ ${r.nro} (recep #${r.externoId}) se movió del ${r.fecha} al ${r.fechaEnOrigen} en la app del compañero → NO se anula; revisá la fecha.`,
    );
  }

  console.log(
    `\n${dry ? 'DRY-RUN — nada se escribió. ' : ''}` +
      `${movimientos} recepción(es), ${renglones} renglón(es)` +
      `${saltadasSinBpm ? `, ${saltadasSinBpm} sin BPM/cantidad` : ''}` +
      `${incompletas ? `, ${incompletas} INCOMPLETA(s) (${itemsSinCantidad} ítem(s) sin cantidad → completar con el export de 3c)` : ''}` +
      `${prodSalteados ? `, ${prodSalteados} renglón(es) sin producto en maestro` : ''}` +
      `${provNoResuelto ? `, ${provNoResuelto} sin proveedor en maestro` : ''}` +
      `${anuladas.length ? `, ${anuladas.length} anulada(s) por baja en el origen` : ''}` +
      `${reprogramadas.length ? `, ${reprogramadas.length} reprogramada(s)` : ''}` +
      `${errores ? `, ${errores} con error` : ''}.`,
  );
}

main()
  .catch((e) => {
    console.error('✗ Sync abortado:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
