import { pool } from './client.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import { reconciliarBajasPorClave, registrarAbastecimiento } from '../services/movimientos.service.js';
import { AppError } from '../domain/errors.js';
import type { AbastecimientoInput } from '../domain/movimientos.schema.js';

// Sincroniza abastecimientos desde la app del compañero (app_ordenes_produccion) →
// los materializa como RINT auto-confirmados en nuestra DB. Es PULL: nosotros leemos
// de SU API REST; su app NO se toca ni sabe de nosotros.
//
// Fuente: GET /api/abastecimiento/tabla-integral?fecha=YYYY-MM-DD (detrás de JWT).
//   Trae por área: codigo_3c (producto), codigo_3c_area (dep_id_3c del área destino),
//   cantidad_abastecer (sugerido), cantidad_abastecer_real (REAL → descuenta stock,
//   regla #2), stock_contado, unidad, proyeccion. cantidad_abastecer_real está en
//   UNIDADES BASE (segun_presentacion es solo la vista en bultos = unidades / u).
//
// Solo materializa renglones con cantidad_abastecer_real > 0 (real cargado = sesión
// completada). Agrupa por (fecha, área) → un RINT por área con sus renglones.
// Idempotente vía idempotency_key = `abast:<fecha>:<codigo_3c_area>` (uq_mov_idempotencia):
// re-sincronizar la misma fecha NO duplica.
//
// MODO RECONCILIAR (sync en vivo): el service se llama con { reconciliar: true }. Si el
// RINT de esa (fecha, área) YA existe, en vez de dejarlo como estaba lo REEDITA con el
// estado fresco de la app del compañero (si a la tarde corrigieron el real o cargaron más
// renglones, se refleja) → auditado + stock recalculado. Sin cambios = no-op (no ensucia
// el historial). Por eso ahora sí sirve correr cada ~1h.
//
// RECONCILIACIÓN DE BAJAS: reeditar alcanza mientras el área siga teniendo ALGÚN renglón con
// real. Pero si vacían el área entera (borran todos los reales del día, o los ponen en cero),
// no se arma ningún grupo → antes no había nada que reconciliar y el RINT viejo quedaba VIVO,
// descontando stock que ya no corresponde. Ahora esos RINT se ANULAN (el stock se revierte).
// Dos seguros para que sea reversible y no dispare por un error de red:
//   - solo se evalúan los días en que la API SÍ devolvió filas (un pull vacío no anula nada);
//   - la baja la hace el usuario de integración, y el modo reconciliar REVIVE sus propias
//     bajas si el real reaparece → un real borrado y vuelto a guardar se recupera solo.
// Una anulación hecha por una persona nunca se revive (regla #4).
//
// VENTANA MÓVIL: sin argumentos, sincroniza HOY + los VENTANA_DIAS_ATRAS días previos
// (default 2). Así, si la PC estuvo apagada, al volver reconcilia sola los días que se
// perdió; los días sin novedad son no-op. --fecha / --desde/--hasta siguen mandando.
//
// Uso:
//   npm run sync:abastecimientos                              (hoy + 2 días atrás)
//   npm run sync:abastecimientos -- --fecha=2026-06-30 [--dry]
//   npm run sync:abastecimientos -- --desde=2026-06-01 --hasta=2026-06-30 [--dry]
//
// Config (.env): COMPANERO_API_URL (base, ej. https://ordenes.laceleste.com.ar),
//   COMPANERO_API_USER, COMPANERO_API_PASS (usuario de servicio de SU sistema),
//   VENTANA_DIAS_ATRAS (opcional, default 2: cuántos días hacia atrás barre la ventana).

interface FilaIntegral {
  area: string;
  codigo_3c_area: string | number | null;
  codigo_3c: string | number | null;
  insumos: string | null;
  unidad: string | null;
  proyeccion: string | null;
  stock_contado: string | number | null;
  cantidad_abastecer: string | number | null;
  cantidad_abastecer_real: string | number | null;
}

// proyeccion de su sistema → enum nuestro (AbastecimientoSchema)
const PROYECCION_MAP: Record<string, 'MIN' | 'MED' | 'MAX' | 'ESP'> = {
  minima: 'MIN',
  media: 'MED',
  maxima: 'MAX',
  especial: 'ESP',
};

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
  // Es el modo del scheduler: reconcilia lo reciente y autorrecupera días perdidos si la
  // PC estuvo apagada. Los días sin cambios son no-op (gracias al modo reconciliar).
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

// [hoy - diasAtras … hoy] como YYYY-MM-DD. Usa la fecha LOCAL (el real se carga en el
// día local del compañero), no UTC, para no adelantarse/atrasarse un día.
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

async function fetchTablaIntegral(baseUrl: string, token: string, fecha: string): Promise<FilaIntegral[]> {
  const res = await fetch(`${baseUrl}/api/abastecimiento/tabla-integral?fecha=${fecha}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: FilaIntegral[]; message?: string };
  if (!res.ok || !json.success) {
    throw new Error(`tabla-integral (${fecha}) falló (${res.status}): ${json.message ?? 'sin detalle'}`);
  }
  return json.data ?? [];
}

// Redondea a 3 decimales (coincide con numeric(12,3) y el refine del schema).
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function aNumero(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

interface RenglonAbast {
  producto_3c: string;
  cantidad_real: number;
  cantidad_sugerida?: number;
  stock_contado?: number;
  unidad: string;
}

interface Grupo {
  fecha: string;
  destino_dep_id_3c: number;
  proyeccion?: 'MIN' | 'MED' | 'MAX' | 'ESP';
  detalle: RenglonAbast[];
}

// Agrupa las filas de una fecha por área destino, quedándose solo con renglones que
// tienen real > 0. Devuelve los grupos listos + contadores de lo descartado.
function agrupar(fecha: string, filas: FilaIntegral[]): { grupos: Grupo[]; sinReal: number; sinArea: number; sinProd: number } {
  const porArea = new Map<number, Grupo>();
  let sinReal = 0;
  let sinArea = 0;
  let sinProd = 0;

  for (const f of filas) {
    const real = aNumero(f.cantidad_abastecer_real);
    if (real === null || real <= 0) {
      sinReal++;
      continue;
    }
    const dep = aNumero(f.codigo_3c_area);
    if (dep === null || !Number.isInteger(dep) || dep <= 0) {
      sinArea++;
      continue;
    }
    const prod = f.codigo_3c === null || f.codigo_3c === undefined ? '' : String(f.codigo_3c).trim();
    if (prod === '') {
      sinProd++;
      continue;
    }

    let grupo = porArea.get(dep);
    if (!grupo) {
      const proy = f.proyeccion ? PROYECCION_MAP[f.proyeccion.trim().toLowerCase()] : undefined;
      grupo = { fecha, destino_dep_id_3c: dep, proyeccion: proy, detalle: [] };
      porArea.set(dep, grupo);
    }

    const sugerida = aNumero(f.cantidad_abastecer);
    const contado = aNumero(f.stock_contado);
    grupo.detalle.push({
      producto_3c: prod,
      cantidad_real: round3(real),
      cantidad_sugerida: sugerida !== null && sugerida >= 0 ? round3(sugerida) : undefined,
      stock_contado: contado !== null && contado >= 0 ? round3(contado) : undefined,
      unidad: (f.unidad ?? '').trim() || 'UNIDAD',
    });
  }

  return { grupos: [...porArea.values()].filter((g) => g.detalle.length > 0), sinReal, sinArea, sinProd };
}

async function main(): Promise<void> {
  const { fechas, dry } = parseArgs(process.argv.slice(2));
  const baseUrl = requireEnv('COMPANERO_API_URL').replace(/\/+$/, '');
  const usuario = requireEnv('COMPANERO_API_USER');
  const password = requireEnv('COMPANERO_API_PASS');

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new Error('Falta el usuario de integración en nuestra DB (corré npm run db:seed)');
  }

  console.log(`▶ Sync abastecimientos ${dry ? '(DRY-RUN) ' : ''}desde ${baseUrl}`);
  console.log(`  Fechas: ${fechas.length === 1 ? fechas[0] : `${fechas[0]} … ${fechas[fechas.length - 1]} (${fechas.length})`}`);

  const token = await login(baseUrl, usuario, password);
  console.log('  Login OK.');

  let movimientos = 0;
  let renglones = 0;
  let errores = 0;
  // Días en que la API SÍ devolvió filas: son los únicos donde una (fecha, área) ausente
  // significa "la vaciaron" y no "el pull falló". Y las claves que el origen sigue teniendo.
  const fechasConDatos: string[] = [];
  const clavesVistas = new Set<string>();

  for (const fecha of fechas) {
    const filas = await fetchTablaIntegral(baseUrl, token, fecha);
    if (filas.length > 0) fechasConDatos.push(fecha);
    const { grupos, sinReal, sinArea, sinProd } = agrupar(fecha, filas);
    for (const g of grupos) clavesVistas.add(`abast:${g.fecha}:${g.destino_dep_id_3c}`);
    if (grupos.length === 0) {
      console.log(`  ${fecha}: sin abastecimientos con real cargado (${filas.length} filas, ${sinReal} sin real).`);
      continue;
    }
    if (sinArea > 0 || sinProd > 0) {
      console.log(`  ⚠ ${fecha}: ${sinArea} renglón(es) sin codigo_3c_area y ${sinProd} sin codigo_3c → salteados.`);
    }

    for (const g of grupos) {
      const input: AbastecimientoInput = {
        idempotency_key: `abast:${g.fecha}:${g.destino_dep_id_3c}`,
        destino_dep_id_3c: g.destino_dep_id_3c,
        fecha: g.fecha,
        proyeccion: g.proyeccion,
        detalle: g.detalle,
        observaciones: `Sync app_ordenes_produccion (${g.fecha})`,
      };

      if (dry) {
        console.log(`    [dry] área ${g.destino_dep_id_3c}: ${g.detalle.length} renglón(es)`);
        movimientos++;
        renglones += g.detalle.length;
        continue;
      }

      try {
        // reconciliar: si el RINT de esta (fecha, área) ya existe, el service lo REEDITA
        // con el estado fresco (real corregido / renglones nuevos) en vez de dejarlo como
        // estaba; auditado y con stock recalculado. Sin cambios = no-op. No duplica.
        const mov = await registrarAbastecimiento(input, { usuarioId, reconciliar: true });
        movimientos++;
        renglones += g.detalle.length;
        console.log(`    ✔ ${mov.nro} → área ${g.destino_dep_id_3c} (${g.detalle.length} renglón/es)`);
      } catch (e) {
        errores++;
        const msg = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
        console.error(`    ✗ área ${g.destino_dep_id_3c} (${g.fecha}): ${msg}`);
      }
    }
  }

  // BAJAS: (fecha, área) que teníamos materializadas y el origen ya no lista con real.
  // Solo en los días que devolvieron filas → un pull vacío o caído nunca anula nada.
  const bajas = await reconciliarBajasPorClave('abast:', fechasConDatos, clavesVistas, { usuarioId, dry });
  for (const b of bajas) {
    console.log(
      `    ⌫ ${b.nro} (${b.idempotenciaKey}) ya no tiene real en la app del compañero → ${dry ? '[dry] se ANULARÍA' : 'ANULADO'} (stock revertido; si el real vuelve, se recupera solo)`,
    );
  }

  console.log(
    `\n${dry ? 'DRY-RUN — nada se escribió. ' : ''}` +
      `${movimientos} movimiento(s), ${renglones} renglón(es)` +
      `${bajas.length ? `, ${bajas.length} anulado(s) por baja en el origen` : ''}` +
      `${errores ? `, ${errores} con error` : ''}.`,
  );
}

main()
  .catch((e) => {
    console.error('✗ Sync abortado:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
