import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { DesempenoQuerySchema } from '../domain/desempeno.schema.js';
import { enviarCsv } from '../lib/csv.js';
import { obtenerDesempeno } from '../services/desempeno.service.js';

const ETIQUETA: Record<string, string> = {
  EXACTO: 'Coincide',
  DENTRO_BULTO: 'Dentro de un bulto',
  DIFIERE: 'Difiere',
  SOLO_3C: 'Solo en 3c (no pasó por la app)',
  SOLO_APP: 'Solo en la app (3c no lo tiene)',
  SIN_SUGERIDO: 'Sin sugerido (no se puede juzgar)',
};

// Fecha local YYYY-MM-DD con offset de días.
function ymd(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// GET /api/desempeno — cruce de lo que la app del compañero registró contra lo que el
// encargado cargó en 3c, por (área, producto) en el período.
export async function getDesempeno(req: Request, res: Response): Promise<void> {
  const parsed = DesempenoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(
    await obtenerDesempeno({
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
      base: parsed.data.base,
      hoy: ymd(0),
      ayer: ymd(-1),
    }),
  );
}

// GET /api/desempeno/export.csv — el detalle (área, producto) del mismo período, para
// revisarlo a mano: es la lista con la que se corrigen los casos de a uno.
export async function getDesempenoCsv(req: Request, res: Response): Promise<void> {
  const parsed = DesempenoQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const datos = await obtenerDesempeno({
    desde: parsed.data.desde,
    hasta: parsed.data.hasta,
    base: parsed.data.base,
    hoy: ymd(0),
    ayer: ymd(-1),
  });
  enviarCsv(
    res,
    `desempeno-${datos.desde}-a-${datos.hasta}.csv`,
    [
      'Area',
      'Producto 3c',
      'Producto',
      'Unidad',
      'Sugerido',
      'App (real)',
      '3c',
      'Diferencia',
      'Bulto',
      'Dif. en bultos',
      'Resultado',
    ],
    datos.items.map((i) => [
      i.area_nombre,
      i.producto_3c,
      i.producto_nombre,
      i.unidad_base ?? '',
      i.cantidad_sugerida,
      i.cantidad_app,
      i.cantidad_3c,
      i.diferencia,
      i.unidades_por_bulto ?? '',
      i.diferencia_bultos ?? '',
      ETIQUETA[i.clasificacion] ?? i.clasificacion,
    ]),
  );
}
