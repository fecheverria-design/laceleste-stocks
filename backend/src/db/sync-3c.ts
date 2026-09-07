import { pool } from './client.js';
import { consultarProxy } from './tresc-proxy.js';
import { interpretarCompras } from './compras-lectura.js';
import { persistirCompras } from './import-compras.js';

// Sincroniza datos desde 3c EN VIVO, reemplazando los exports CSV que se bajaban a mano de
// Firefox. 3c corre sobre Oracle y NO tiene API REST; se lee por el proxy SQL de solo lectura
// (ver tresc-proxy.ts) o por el servlet SqlToExcel de los informes. Cada fuente alimenta el
// MISMO importador que ya existe → cero mapeo nuevo, misma lógica de idempotencia.
//
// SOLO LECTURA sobre 3c. 3c sigue siendo la fuente de verdad; acá solo consolidamos.
//
// Fuentes:
//   compras     → proxy, vista V_COMP_PRECIOS_CPRA (ventana rodante de N días) → import:compras
//   [pendiente] existencias / precios / movimientos → servlet SqlToExcel (.xls); se agregan
//                cuando esté el lector de .xls y (movimientos) confirmado el feed rolling.
//
// Idempotente: correr cada hora re-trae la ventana solapada y NO duplica (compras upsertea por
// (numero, producto_3c, renglon)). Por eso NO hay que calcular fechas en cada corrida: se pide
// SIEMPRE los últimos N días y el upsert absorbe lo repetido.
//
// Uso:
//   npm run sync:3c                       (todas las fuentes implementadas, ventana 14 días)
//   npm run sync:3c -- --dias=30 --dry
//   npm run sync:3c -- --fuente=compras   (una sola fuente)

const FUENTES_DISPONIBLES = ['compras'] as const;
type Fuente = (typeof FUENTES_DISPONIBLES)[number];

interface Args {
  dry: boolean;
  dias: number;
  fuentes: Fuente[];
}

function parseArgs(argv: string[]): Args {
  let dry = false;
  let dias = 14;
  let fuentes: Fuente[] = [...FUENTES_DISPONIBLES];
  for (const a of argv) {
    if (a === '--dry') dry = true;
    else if (a.startsWith('--dias=')) {
      const n = Number(a.slice('--dias='.length));
      if (!Number.isInteger(n) || n < 0) throw new Error(`--dias inválido: ${a} (entero >= 0)`);
      dias = n;
    } else if (a.startsWith('--fuente=')) {
      const f = a.slice('--fuente='.length).trim();
      if (!(FUENTES_DISPONIBLES as readonly string[]).includes(f)) {
        throw new Error(`--fuente desconocida: ${f} (opciones: ${FUENTES_DISPONIBLES.join(', ')})`);
      }
      fuentes = [f as Fuente];
    }
  }
  return { dry, dias, fuentes };
}

// Compras reales de 3c, ventana rodante de N días. Parte de la query que J usa en n8n, con
// los ajustes para que entre derecho al importador:
//   · FECHA formateada dd/mm/yyyy (lo que espera compras-lectura).
//   · Nombre del proveedor con un join (V_COMP_PRECIOS_CPRA solo trae PERSONAS_ID).
//   · FAMILIA real desde V_ARTICULO (join por a.ID = v.ARTICU_ID; el ARTICU_ID de V_ARTICULO
//     es un id interno de Oracle, NO el código de producto). Sin esto los productos entraban
//     sin familia y el desglose por comprador/las exclusiones del gasto quedaban vacíos.
//   · TOTAL CON IVA reconstruido: V_COMP_PRECIOS_CPRA da neto + base gravada/exenta pero NO la
//     alícuota. La alícuota vive por producto en V_PRECIO_BASE.TIPO_IVA (21/10,5/27, foto al
//     día). con_iva = EXENTO + GRAVADO×(1+alícuota). Fallback 21% si el producto no está en la
//     foto de precios. Todos los joins son LEFT para no perder ni un renglón de compra.
function queryCompras(dias: number): string {
  return `SELECT
      v.NUMERO,
      TO_CHAR(v.FECHA, 'DD/MM/YYYY') AS FECHA,
      v.ARTICU_ID,
      v.CANTIDAD,
      v.PRECIO_UNITARIO,
      v.PRECIO_TOTAL,
      v.PERSONAS_ID,
      v.DENOMINACION,
      p.APELLIDO AS PROVEEDORES,
      a.FAMILIA_DESCR AS FAMILIA,
      NVL(pb.TIVA, 21) AS IVA,
      ROUND(NVL(v.EXENTO, 0) + NVL(v.GRAVADO, 0) * (1 + NVL(pb.TIVA, 21) / 100), 2) AS VALOR_TOTAL
    FROM LACELESTE.V_COMP_PRECIOS_CPRA v
    LEFT JOIN LACELESTE.LC_V_PROVEEDORES p ON p.PERSONAS_ID = v.PERSONAS_ID
    LEFT JOIN LACELESTE.V_ARTICULO a ON a.ID = v.ARTICU_ID
    LEFT JOIN (
      SELECT ID, MAX(TO_NUMBER(TIPO_IVA)) TIVA
      FROM LACELESTE.V_PRECIO_BASE
      WHERE TIPO_IVA IS NOT NULL
      GROUP BY ID
    ) pb ON pb.ID = v.ARTICU_ID
    WHERE TRUNC(v.FECHA) >= TRUNC(SYSDATE) - ${dias}
    ORDER BY v.DOC_ID ASC, v.ID ASC`;
}

async function syncCompras(dias: number, dry: boolean): Promise<void> {
  console.log(`▶ Compras 3c ${dry ? '(DRY-RUN) ' : ''}— últimos ${dias} días (vista V_COMP_PRECIOS_CPRA)`);
  const filas = await consultarProxy(queryCompras(dias));
  const { registros, saltadas, excluidasFamilia } = interpretarCompras(filas);
  const gastoNeto = registros.reduce((a, r) => a + r.precioTotal, 0);
  const gastoConIva = registros.reduce((a, r) => a + (r.totalConIva ?? r.precioTotal), 0);
  console.log(
    `  Filas: ${filas.length - 1} · válidas: ${registros.length} · saltadas: ${saltadas} · excluidas por familia: ${excluidasFamilia} · neto: $${gastoNeto.toLocaleString('es-AR')} · con IVA: $${gastoConIva.toLocaleString('es-AR')}`,
  );
  if (dry) {
    for (const r of registros.slice(0, 5)) {
      console.log(`    [dry] ${r.fecha} ${r.numero} · ${r.producto3c} ${r.nombre} · ${r.proveedorNombre} · ${r.cantidad} × $${r.precioUnitario} = $${r.precioTotal}`);
    }
    return;
  }
  const escritos = await persistirCompras(registros);
  console.log(`  ✔ ${escritos} renglón(es) de compra importados/actualizados.`);
}

async function main(): Promise<void> {
  const { dry, dias, fuentes } = parseArgs(process.argv.slice(2));
  console.log(`▶ Sync 3c ${dry ? '(DRY-RUN) ' : ''}· fuentes: ${fuentes.join(', ')}`);
  for (const f of fuentes) {
    if (f === 'compras') await syncCompras(dias, dry);
  }
  console.log(`\n${dry ? 'DRY-RUN — nada se escribió.' : '✔ Sync 3c completo.'}`);
}

main()
  .catch((e) => {
    console.error('✗ Sync 3c abortado:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
