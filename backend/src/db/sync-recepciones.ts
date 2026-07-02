import { inArray } from 'drizzle-orm';
import { db, pool } from './client.js';
import { productos } from './schema.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import { registrarRecepcion } from '../services/movimientos.service.js';
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

// Códigos de producto que SÍ existen en nuestro maestro (los demás no se pueden mover).
async function existentesEnMaestro(codigos: string[]): Promise<Set<string>> {
  const unicos = [...new Set(codigos)];
  if (unicos.length === 0) return new Set();
  const rows = await db
    .select({ c: productos.codigo3c })
    .from(productos)
    .where(inArray(productos.codigo3c, unicos));
  return new Set(rows.map((r) => r.c));
}

interface RenglonRecep {
  producto_3c: string;
  cantidad_real: number;
  unidad: string;
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
  let errores = 0;

  for (const fecha of fechas) {
    const recepciones = await fetchRecepciones(baseUrl, token, fecha);
    if (recepciones.length === 0) {
      console.log(`  ${fecha}: sin recepciones.`);
      continue;
    }

    for (const r of recepciones) {
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

      // Pre-filtra productos inexistentes en nuestro maestro: así una recepción no se
      // pierde entera por un artículo que aún no está en 3c (se saltea ese renglón).
      const existentes = await existentesEnMaestro(candidatos.map((c) => c.producto_3c));
      const detalle = candidatos.filter((c) => existentes.has(c.producto_3c));
      const faltan = candidatos.length - detalle.length;
      if (faltan > 0) prodSalteados += faltan;
      if (detalle.length === 0) {
        console.log(`  ⚠ ${fecha} recep #${r.id} (${r.proveedor_nombre ?? '?'}): ${faltan} artículo(s) no están en el maestro → recepción salteada.`);
        continue;
      }

      const input: RecepcionInput = {
        idempotency_key: `recep:${r.id}`,
        origen_dep_id_3c: origenDep,
        // destino omitido → DEPOSITO_PRINCIPAL (FABRICA)
        fecha: (r.fecha ?? fecha).slice(0, 10),
        detalle,
        observaciones: `Sync recepción #${r.id} ${r.proveedor_nombre ?? ''} (${fecha})`.trim(),
      };

      if (dry) {
        console.log(`    [dry] recep #${r.id} ${r.proveedor_nombre ?? ''}: ${detalle.length} renglón(es)${faltan ? ` (+${faltan} salteado)` : ''}`);
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
        console.log(`    ✔ ${mov.nro} ← recep #${r.id} ${r.proveedor_nombre ?? ''} (${detalle.length} renglón/es)`);
      } catch (e) {
        errores++;
        const msg = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        console.error(`    ✗ recep #${r.id} (${fecha}): ${msg}`);
      }
    }
  }

  console.log(
    `\n${dry ? 'DRY-RUN — nada se escribió. ' : ''}` +
      `${movimientos} recepción(es), ${renglones} renglón(es)` +
      `${saltadasSinBpm ? `, ${saltadasSinBpm} sin BPM/cantidad` : ''}` +
      `${prodSalteados ? `, ${prodSalteados} renglón(es) sin producto en maestro` : ''}` +
      `${errores ? `, ${errores} con error` : ''}.`,
  );
}

main()
  .catch((e) => {
    console.error('✗ Sync abortado:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
