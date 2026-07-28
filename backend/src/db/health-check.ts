import { sql } from 'drizzle-orm';
import { db, pool } from './client.js';

// Vigía de DATOS: corre los chequeos que necesitan la DB y la API del compañero, e imprime
// los problemas encontrados. NO manda mail: eso lo hace scripts/health-check.sh, que corre
// este script y usa la salida. División a propósito — acá está lo que sabe de negocio, allá
// lo que sabe de infraestructura (cron, backups, contenedores) y el envío por SMTP.
//
// Nace del incidente 2026-07-23: el sync estuvo caído del 17 al 23/07 y nadie se enteró hasta
// que faltaron movimientos a la vista. Antes vivía en PowerShell en la PC de J y consultaba la
// DB local; desde la mudanza al server esa DB quedó vieja, así que el vigía se mudó también.
//
// SALIDA: exit 0 = todo bien · exit 10 = hay problemas (stdout trae el detalle, un problema
// por bloque) · exit 1 = el chequeo en sí falló. El wrapper distingue por código.
//
// Uso (dentro del contenedor backend):
//   npm -w backend run health-check

interface FilaIntegral {
  area: string;
  codigo_3c: string | number | null;
  cantidad_abastecer: string | number | null;
  cantidad_abastecer_real: string | number | null;
}

function requireEnv(nombre: string): string {
  const v = process.env[nombre];
  if (!v || v.trim() === '') throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return v.trim();
}

function numEnv(nombre: string, def: number): number {
  const v = Number(process.env[nombre]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

function aNumero(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function diasEntre(desde: string, hasta: string): number {
  const a = new Date(`${desde}T00:00:00Z`).getTime();
  const b = new Date(`${hasta}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
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

async function main(): Promise<void> {
  const problemas: string[] = [];
  const hoy = hoyISO();
  const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const staleDias = numEnv('SYNC_STALE_DIAS', 2);
  const diasCaido = numEnv('DIAS_CAIDO', 3);

  // ── 1) FRESCURA: ¿el sync está entrando? ──────────────────────────────────────────
  // Si esto falla, todo lo demás miente (con datos viejos "todos los productos se cayeron").
  let syncStale = false;
  const fresco = await db.execute<{ ultima: string | null }>(
    sql`SELECT to_char(max(fecha), 'YYYY-MM-DD') AS ultima FROM movimientos WHERE observaciones LIKE 'Sync %'`,
  );
  const ultima = fresco.rows[0]?.ultima ?? null;
  if (!ultima) {
    syncStale = true;
    problemas.push('No hay NINGÚN movimiento del sync en la DB. Revisá el cron del LXC (crontab -l) y /var/log/laceleste-sync.log.');
  } else {
    const edad = diasEntre(ultima, hoy);
    if (edad > staleDias) {
      syncStale = true;
      problemas.push(
        `El sync no está entrando: el último movimiento es del ${ultima} (${edad} día/s atrás, umbral ${staleDias}).\n` +
          `  Revisá /var/log/laceleste-sync.log. Catch-up del hueco:\n` +
          `  cd /opt/laceleste && docker compose -f docker-compose.prod.yml exec -T backend \\\n` +
          `    npm -w backend run sync:abastecimientos -- --desde=${ultima} --hasta=${hoy}   (ídem sync:recepciones)`,
      );
    }
  }

  // ── 2) PRODUCTOS SIN ALTA EN EL MAESTRO ───────────────────────────────────────────
  // Desde sync-maestro.ts un producto que falta ya no tumba el movimiento: se saltea el
  // renglón y queda anotado en las observaciones. Eso lo hace silencioso, así que el vigía
  // lo levanta acá: son renglones de mercadería que NO están afectando el stock.
  const faltantesRes = await db.execute<{ fecha: string; nro: string; observaciones: string }>(
    sql`SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nro, observaciones
        FROM movimientos
        WHERE observaciones LIKE '%SIN ALTA EN EL MAESTRO%'
          AND estado = 'CONFIRMADO'
          AND fecha >= CURRENT_DATE - INTERVAL '14 days'
        ORDER BY fecha DESC, nro`,
  );
  const faltantes = faltantesRes.rows;
  if (faltantes.length > 0) {
    const detalle = faltantes
      .map((f) => `  - ${f.nro} (${f.fecha}): ${f.observaciones.split('SIN ALTA EN EL MAESTRO')[1]?.trim() ?? ''}`)
      .join('\n');
    problemas.push(
      `Hay ${faltantes.length} movimiento(s) con renglones SALTEADOS por productos que no están en el maestro ` +
        `(esa mercadería no movió stock):\n${detalle}\n` +
        `  Dalos de alta (import:productos con el maestro de 3c, o INSERT con el código que asignó 3c) y el sync ` +
        `los completa solo en la ventana móvil; si el día ya salió de la ventana, corré el sync con --fecha=<día>.`,
    );
  }

  // ── 3) ORIGEN: lo que pasa en la app del compañero ────────────────────────────────
  const baseUrl = requireEnv('COMPANERO_API_URL').replace(/\/+$/, '');
  const token = await login(baseUrl, requireEnv('COMPANERO_API_USER'), requireEnv('COMPANERO_API_PASS'));
  const filas = await fetchTablaIntegral(baseUrl, token, ayer);

  // 3a) Área que cargó sugeridos pero NINGÚN real → no cerró la sesión y ese día no entró
  //     nada de esa área al stock (regla #2: descontamos por real).
  const porArea = new Map<string, { sug: number; real: number }>();
  for (const f of filas) {
    const a = (f.area ?? '?').trim();
    const acc = porArea.get(a) ?? { sug: 0, real: 0 };
    if (aNumero(f.cantidad_abastecer) > 0) acc.sug++;
    if (aNumero(f.cantidad_abastecer_real) > 0) acc.real++;
    porArea.set(a, acc);
  }
  const sinCerrar = [...porArea.entries()]
    .filter(([, v]) => v.sug > 0 && v.real === 0)
    .map(([a, v]) => `${a} (${v.sug} sugerido/s, 0 reales)`);
  if (sinCerrar.length > 0) {
    problemas.push(
      `Áreas que NO cargaron NINGÚN real el ${ayer} (no cerraron la sesión → nada de esas áreas entró al stock): ` +
        `${sinCerrar.join('; ')}.\n  Que guarden la sesión de ese día, o cargá el día del export de 3c (import:movimientos).`,
    );
  }

  // 3b) Producto "caído": venía moviéndose seguido y hace >= DIAS_CAIDO días que no tiene
  //     real, aunque el compañero LO SIGUE SUGIRIENDO (caso "base de torta" 19-23/07).
  //     Se saltea si el sync está stale: un bajón global marcaría a todos como caídos.
  if (!syncStale) {
    const sugeridos = new Set(
      filas.filter((f) => aNumero(f.cantidad_abastecer) > 0).map((f) => String(f.codigo_3c ?? '').trim()),
    );
    // El corte NO es en días calendario sino en DÍAS CON ACTIVIDAD (fechas en que entró
    // algún RINT del sync). Contando calendario, un producto que se movió el sábado
    // figuraba "caído" el martes y la alerta se llenaba de falsos positivos: los fines de
    // semana y feriados no mueven nada y no significan que el producto se haya caído.
    const caidosRes = await db.execute<{ producto_3c: string; nombre: string; ultimo: string; dias: number; sin_real: number }>(
      sql`WITH rint AS (
            SELECT m.fecha, d.producto_3c
            FROM movimientos_detalle d
            JOIN movimientos m ON m.id = d.movimiento_id
            JOIN tipos_movimiento tm ON tm.id = m.tipo_id
            WHERE tm.codigo = 'RINT' AND m.estado = 'CONFIRMADO' AND m.observaciones LIKE 'Sync %'
              AND m.fecha >= CURRENT_DATE - INTERVAL '21 days'
          ),
          dias_activos AS (SELECT DISTINCT fecha FROM rint),
          por_producto AS (
            SELECT producto_3c, max(fecha) AS ultimo, count(DISTINCT fecha)::int AS dias
            FROM rint GROUP BY producto_3c HAVING count(DISTINCT fecha) >= 5
          )
          SELECT pp.producto_3c, p.nombre, to_char(pp.ultimo, 'YYYY-MM-DD') AS ultimo, pp.dias,
                 (SELECT count(*)::int FROM dias_activos da WHERE da.fecha > pp.ultimo) AS sin_real
          FROM por_producto pp
          JOIN productos p ON p.codigo_3c = pp.producto_3c
          WHERE (SELECT count(*) FROM dias_activos da WHERE da.fecha > pp.ultimo) >= ${diasCaido}
          ORDER BY sin_real DESC, p.nombre`,
    );
    const relevantes = caidosRes.rows.filter((c) => sugeridos.has(c.producto_3c));
    if (relevantes.length > 0) {
      const detalle = relevantes
        .map(
          (c) =>
            `  - ${c.nombre} (${c.producto_3c}): último RINT ${c.ultimo} — ${c.sin_real} día(s) con movimiento desde entonces, y en ninguno entró; movía ${c.dias} de los últimos 21`,
        )
        .join('\n');
      problemas.push(
        `Productos que SE CAYERON (venían moviéndose seguido y pasaron >= ${diasCaido} días CON ACTIVIDAD sin real, ` +
          `pero el compañero los sigue sugiriendo):\n${detalle}\n` +
          `  Revisá si el área los dejó de cargar (que guarde la sesión) o si realmente dejaron de moverse.`,
      );
    }
  }

  if (problemas.length === 0) {
    console.log(`OK — sin novedades. Último movimiento del sync: ${ultima ?? '(ninguno)'}.`);
    return;
  }
  for (const p of problemas) console.log(`* ${p}\n`);
  process.exitCode = 10;
}

main()
  .catch((e) => {
    console.error('✗ El chequeo falló:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
