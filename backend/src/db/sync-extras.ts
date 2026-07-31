import { pool } from './client.js';
import { existentesEnMaestro, notaFaltantes, separarPorMaestro } from './sync-maestro.js';
import {
  agruparExtras,
  armarCatalogo,
  fechasDeFilas,
  hoyEnBsAs,
  type CatalogoExtras,
  type FilaCatalogo,
  type FilaExtra,
} from './extras-mapeo.js';
import { resolverUsuarioIntegracion } from '../repositories/movimientos.repository.js';
import { reconciliarBajasPorClave, registrarAbastecimiento } from '../services/movimientos.service.js';
import { AppError } from '../domain/errors.js';
import type { AbastecimientoInput } from '../domain/movimientos.schema.js';

// Sincroniza los ABASTECIMIENTOS EXTRAS desde la app del compañero → los materializa como
// RINT auto-confirmados. Son los egresos que el encargado de depósito despacha POR FUERA del
// abastecimiento diario (ver sync-abastecimientos.ts). Mismo movimiento que el RINT diario
// pero SIN sugerido: solo hay cantidad despachada, que es la que descuenta stock (regla #2).
// Sin esto, un extra es stock que sale del depósito y nosotros nunca vemos → stock inflado.
//
// Fuente: GET /api/movimientos?fechaDesde=&fechaHasta= (detrás de JWT). En su app estos
// egresos se cargan de a UNO (POST /api/movimientos {articulo_id, cantidad, area, nota,
// fecha_hora}), así que cada fila es un artículo suelto, no un ticket con renglones.
// Campos que consumimos: fecha_hora, articulo_id (producto), area + codigo_area (destino),
// cantidad, unidad, nota, usuario. La agrupación vive en extras-mapeo.ts.
//
// PRODUCTO (verificado 2026-07-31 contra los primeros extras reales): la respuesta NO trae
// codigo_3c, trae `articulo_id`, que es el id de la fila del catálogo integral. Por eso antes
// de agrupar se arma el catálogo articulo_id → codigo_3c pidiendo
// GET /api/abastecimiento/tabla-integral?fecha=… de cada día que tenga extras (mismo endpoint
// que usa el sync diario). El código sale de SU dato, no se deriva de la numeración (regla #1).
// Si el catálogo no se puede traer, el sync ABORTA: sin él todo se descartaría por "sin
// producto" y encima el modo bajas anularía RINT buenos.
//
// AGRUPACIÓN: un RINT por (fecha, área) juntando todos los extras del día de esa área
// (decisión de J, 2026-07-30: el listado queda legible en vez de decenas de RINT de un
// renglón). Idempotency key = `abastx:<fecha>:<codigo_3c_area>`. Ojo con el prefijo: NO
// colisiona con el `abast:` del diario porque el LIKE es `abast:%` y acá el 6º char es la x.
//
// MODO RECONCILIAR: si el RINT de esa (fecha, área) ya existe, se REEDITA con lo que trae
// ahora el origen (extras nuevos del día, cantidades corregidas) → auditado y con stock
// recalculado. Sin cambios = no-op. Por eso sirve correr cada ~1h mientras avanza el día.
//
// BAJAS: su app permite BORRAR un extra (DELETE). Si se borran todos los de una (fecha, área),
// el grupo desaparece del pull y el RINT se ANULA (stock revertido). A diferencia del sync
// diario, acá el seguro NO puede ser "solo los días que devolvieron filas": un día sin ningún
// extra es lo NORMAL, y con ese criterio un extra borrado no se anularía nunca. El seguro es
// que la llamada HTTP haya sido exitosa: si falla, fetchExtras lanza y el sync aborta sin
// anular nada. Un 200 con lista vacía es un dato confiable, no un error. Y la baja la hace el
// usuario de integración → si el extra reaparece, el modo reconciliar la revive sola.
//
// PRODUCTO SIN ALTA EN NUESTRO MAESTRO: saltea ESE renglón, nunca el movimiento (mismo
// criterio que los otros dos syncs, ver sync-maestro.ts). Al darlo de alta entra solo.
//
// Uso:
//   npm run sync:extras                                (hoy + 2 días atrás)
//   npm run sync:extras -- --fecha=2026-07-30 [--dry]
//   npm run sync:extras -- --desde=2026-07-01 --hasta=2026-07-30 [--dry]
//
// Config (.env): las mismas COMPANERO_API_URL / _USER / _PASS y VENTANA_DIAS_ATRAS / SYNC_PISO
// que usa sync-abastecimientos.

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
  return { fechas: aplicarPiso(ventanaMovil(diasAtrasEnv())), dry };
}

// Piso de reconciliación: la ventana móvil nunca baja de SYNC_PISO (corte con el histórico
// de 3c). No afecta a --fecha/--desde/--hasta (cargas manuales explícitas).
function aplicarPiso(fechas: string[]): string[] {
  const piso = process.env.SYNC_PISO?.trim();
  if (!piso) return fechas;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(piso)) throw new Error(`SYNC_PISO inválido: ${piso} (esperado YYYY-MM-DD)`);
  return fechas.filter((f) => f >= piso);
}

function diasAtrasEnv(): number {
  const raw = process.env.VENTANA_DIAS_ATRAS?.trim();
  if (!raw) return 2;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`VENTANA_DIAS_ATRAS inválido: ${raw} (entero >= 0)`);
  return n;
}

// [hoy - diasAtras … hoy] en la fecha de Buenos Aires (el extra se carga en el día local del
// depósito; el LXC corre en UTC y un cron nocturno se correría un día).
function ventanaMovil(diasAtras: number): string[] {
  const out: string[] = [];
  for (let i = diasAtras; i >= 0; i--) {
    const f = new Date(`${hoyEnBsAs()}T12:00:00Z`);
    f.setUTCDate(f.getUTCDate() - i);
    out.push(f.toISOString().slice(0, 10));
  }
  return out;
}

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

// Una sola llamada por rango (su endpoint acepta fechaDesde/fechaHasta). Si falla, lanza:
// abortar es lo correcto, porque una lista vacía por error de red anularía extras buenos.
async function fetchExtras(baseUrl: string, token: string, desde: string, hasta: string): Promise<FilaExtra[]> {
  const qs = new URLSearchParams({ fechaDesde: desde, fechaHasta: hasta });
  const res = await fetch(`${baseUrl}/api/movimientos?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: FilaExtra[]; message?: string };
  if (!res.ok || !json.success) {
    throw new Error(`extras (${desde}…${hasta}) falló (${res.status}): ${json.message ?? 'sin detalle'}`);
  }
  return json.data ?? [];
}

// Catálogo articulo_id → codigo_3c desde la tabla integral de SU app (la misma que lee el sync
// diario). Se pide por día porque el endpoint lo exige; el contenido es el maestro vigente.
// Si falla, lanza: mejor abortar que descartar todo por "sin producto" (ver cabecera).
async function fetchCatalogo(
  baseUrl: string,
  token: string,
  fechas: string[],
): Promise<CatalogoExtras> {
  const cat: CatalogoExtras = new Map();
  for (const fecha of fechas) {
    const res = await fetch(`${baseUrl}/api/abastecimiento/tabla-integral?fecha=${fecha}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      data?: FilaCatalogo[];
      message?: string;
    };
    if (!res.ok || !json.success) {
      throw new Error(`catálogo (tabla-integral ${fecha}) falló (${res.status}): ${json.message ?? 'sin detalle'}`);
    }
    armarCatalogo(json.data ?? [], cat);
  }
  return cat;
}

async function main(): Promise<void> {
  const { fechas, dry } = parseArgs(process.argv.slice(2));
  if (fechas.length === 0) {
    console.log('▶ Sync extras: la ventana quedó vacía por SYNC_PISO, nada que hacer.');
    return;
  }
  const baseUrl = requireEnv('COMPANERO_API_URL').replace(/\/+$/, '');
  const usuario = requireEnv('COMPANERO_API_USER');
  const password = requireEnv('COMPANERO_API_PASS');

  const usuarioId = await resolverUsuarioIntegracion();
  if (usuarioId === undefined) {
    throw new Error('Falta el usuario de integración en nuestra DB (corré npm run db:seed)');
  }

  const desde = fechas[0]!;
  const hasta = fechas[fechas.length - 1]!;
  console.log(`▶ Sync abastecimientos EXTRAS ${dry ? '(DRY-RUN) ' : ''}desde ${baseUrl}`);
  console.log(`  Fechas: ${fechas.length === 1 ? desde : `${desde} … ${hasta} (${fechas.length})`}`);

  const token = await login(baseUrl, usuario, password);
  console.log('  Login OK.');

  const filas = await fetchExtras(baseUrl, token, desde, hasta);

  // Solo se pide el catálogo de los días que efectivamente tienen extras (lo normal es que no
  // haya ninguno: en ese caso ni se sale a buscarlo).
  const ventana = new Set(fechas);
  const conExtras = fechasDeFilas(filas, ventana);
  const catalogo = conExtras.length > 0 ? await fetchCatalogo(baseUrl, token, conExtras) : new Map();
  if (conExtras.length > 0) {
    console.log(`  Catálogo: ${catalogo.size} artículo(s) (tabla integral de ${conExtras.join(', ')}).`);
  }

  const { grupos, descartes } = agruparExtras(filas, ventana, catalogo);
  console.log(`  ${filas.length} extra(s) en el origen → ${grupos.length} movimiento(s) por (fecha, área).`);

  if (descartes.areasDesconocidas.size > 0) {
    console.log(
      `  ⚠ Área(s) que no sabemos mapear a un depósito de 3c: ${[...descartes.areasDesconocidas].join(', ')} → salteadas. Agregar el id de 3c en AREAS_3C (extras-mapeo.ts).`,
    );
  }
  if (descartes.areasSinDeposito.size > 0) {
    console.log(
      `  ⚠ Área(s) sin depósito en 3c: ${[...descartes.areasSinDeposito].join(', ')} → salteadas (no hay dónde imputar el egreso).`,
    );
  }
  if (descartes.areasEnConflicto.size > 0) {
    console.log(
      `  ⚠ Área(s) donde su codigo_area no coincide con nuestra tabla (gana el del origen): ${[...descartes.areasEnConflicto].join('; ')}`,
    );
  }
  if (descartes.sinCantidad > 0 || descartes.sinProducto > 0 || descartes.sinFecha > 0) {
    console.log(
      `  ⚠ Descartes: ${descartes.sinCantidad} sin cantidad, ${descartes.sinProducto} sin producto resoluble, ${descartes.sinFecha} sin fecha_hora válida.`,
    );
  }
  if (descartes.articulosSinCatalogo.size > 0) {
    console.log(
      `  ⚠ articulo_id que no está en la tabla integral (no sabemos su codigo_3c): ${[...descartes.articulosSinCatalogo].join(', ')}`,
    );
  }

  let movimientos = 0;
  let renglones = 0;
  let errores = 0;
  let prodSalteados = 0;
  let gruposSalteados = 0;
  const clavesVistas = new Set<string>();

  for (const g of grupos) {
    const existentes = await existentesEnMaestro(g.detalle.map((r) => r.producto_3c));
    const { detalle, faltantes } = separarPorMaestro(g.detalle, existentes);
    if (faltantes.length > 0) {
      prodSalteados += g.detalle.length - detalle.length;
      console.log(
        `    ⚠ ${g.area} (${g.fecha}): ${faltantes.length} producto(s) sin alta en el maestro → ${faltantes.join(', ')} (renglón salteado; entra solo al darlos de alta)`,
      );
    }
    if (detalle.length === 0) {
      gruposSalteados++;
      console.log(`  ⚠ ${g.fecha} ${g.area}: ningún producto está en el maestro → salteado.`);
      continue;
    }

    // La clave se registra recién acá: si el grupo entero se saltea por maestro, NO la damos
    // por vista, para no anular un RINT bueno de una corrida anterior.
    const key = `abastx:${g.fecha}:${g.destino_dep_id_3c}`;
    clavesVistas.add(key);

    const input: AbastecimientoInput = {
      idempotency_key: key,
      destino_dep_id_3c: g.destino_dep_id_3c,
      fecha: g.fecha,
      detalle,
      observaciones: `Extras app_ordenes_produccion (${g.fecha})${notaFaltantes(faltantes)}`,
    };

    if (dry) {
      console.log(
        `    [dry] ${g.area} (${g.fecha}): ${detalle.length} renglón(es)${faltantes.length ? ` (+${g.detalle.length - detalle.length} salteado)` : ''}`,
      );
      movimientos++;
      renglones += detalle.length;
      continue;
    }

    try {
      const mov = await registrarAbastecimiento(input, { usuarioId, reconciliar: true });
      movimientos++;
      renglones += detalle.length;
      console.log(`    ✔ ${mov.nro} → ${g.area} (${g.fecha}, ${detalle.length} renglón/es)`);
    } catch (e) {
      errores++;
      const msg = e instanceof AppError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      console.error(`    ✗ ${g.area} (${g.fecha}): ${msg}`);
    }
  }

  // BAJAS: (fecha, área) que teníamos y el origen ya no lista → los borraron allá. Acá el
  // seguro es que el fetch haya sido exitoso (ver cabecera), no que haya devuelto filas.
  const bajas = await reconciliarBajasPorClave('abastx:', fechas, clavesVistas, { usuarioId, dry });
  for (const b of bajas) {
    console.log(
      `    ⌫ ${b.nro} (${b.idempotenciaKey}) ya no tiene extras en la app del compañero → ${dry ? '[dry] se ANULARÍA' : 'ANULADO'} (stock revertido; si vuelven a cargarlo, se recupera solo)`,
    );
  }

  console.log(
    `\n${dry ? 'DRY-RUN — nada se escribió. ' : ''}` +
      `${movimientos} movimiento(s), ${renglones} renglón(es)` +
      `${prodSalteados ? `, ${prodSalteados} renglón(es) sin producto en el maestro (dar de alta y se completan solos)` : ''}` +
      `${gruposSalteados ? `, ${gruposSalteados} grupo(s) salteado(s) entero(s)` : ''}` +
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
