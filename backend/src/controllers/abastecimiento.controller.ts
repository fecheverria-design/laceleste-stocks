import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { AbastecimientoQuerySchema, RevisionSchema } from '../domain/abastecimiento.schema.js';
import { enviarCsv } from '../lib/csv.js';
import { borrarRevision, guardarRevision } from '../repositories/abastecimiento.repository.js';
import { obtenerAbastecimiento } from '../services/abastecimiento.service.js';

const MOTIVO: Record<string, string> = {
  EXACTO: 'Exacto',
  HORMA: 'Redondeo a pieza entera',
  RELATIVA: 'Dentro de la tolerancia',
  ABSOLUTA: 'Una unidad de diferencia',
};

// Fecha local YYYY-MM-DD con offset de días.
function ymd(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function filtrosDe(query: unknown): { desde: string; hasta: string; areas?: number[] } {
  const parsed = AbastecimientoQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  return {
    desde: parsed.data.desde ?? ymd(-29),
    hasta: parsed.data.hasta ?? ymd(0),
    areas: parsed.data.areas?.split(',').map(Number),
  };
}

// GET /api/abastecimiento — ¿despachó lo que había que despachar?, por (día, área, producto).
export async function getAbastecimiento(req: Request, res: Response): Promise<void> {
  res.status(200).json(await obtenerAbastecimiento(filtrosDe(req.query)));
}

// GET /api/abastecimiento/export.csv — el mismo detalle, para revisarlo fuera de la app.
export async function getAbastecimientoCsv(req: Request, res: Response): Promise<void> {
  const datos = await obtenerAbastecimiento(filtrosDe(req.query));
  enviarCsv(
    res,
    `abastecimiento-${datos.desde}-a-${datos.hasta}.csv`,
    [
      'Fecha',
      'Area',
      'Producto 3c',
      'Producto',
      'Unidad',
      'Presentacion',
      'Pedido',
      'Despacho',
      'Diferencia',
      'Dif %',
      'Rango correcto',
      'Resultado',
      'Motivo',
      'Revision',
      'Nota',
      'A recalibrar',
    ],
    datos.casos.map((c) => [
      c.fecha,
      c.area_nombre,
      c.producto_3c,
      c.producto_nombre,
      c.unidad_base ?? '',
      c.presentacion_compra ?? '',
      c.pedido,
      c.despacho,
      c.diferencia,
      c.diferencia_pct ?? '',
      `${c.piso} a ${c.techo}`,
      c.bien ? 'BIEN' : c.resultado === 'DE_MAS' ? 'DE MAS' : 'DE MENOS',
      c.motivo === null ? '' : (MOTIVO[c.motivo] ?? c.motivo),
      c.revision?.veredicto ?? '',
      c.revision?.nota ?? '',
      c.recalibrar ? 'si' : '',
    ]),
  );
}

// PUT /api/abastecimiento/revision — el check manual de un caso. Le gana a la regla.
// `veredicto: null` saca la revisión y devuelve el caso a lo que diga el automatismo.
export async function putRevision(req: Request, res: Response): Promise<void> {
  const parsed = RevisionSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { fecha, area_dep_3c, producto_3c, veredicto, nota } = parsed.data;
  if (veredicto === null) {
    await borrarRevision({ fecha, areaDep3c: area_dep_3c, producto3c: producto_3c });
    res.status(200).json({ ok: true, revision: null });
    return;
  }
  await guardarRevision({
    fecha,
    areaDep3c: area_dep_3c,
    producto3c: producto_3c,
    veredicto,
    nota: nota ?? null,
    // Regla #7: la revisión queda a nombre de quien la hizo, no del sistema.
    usuarioId: req.user!.id,
  });
  res.status(200).json({ ok: true, revision: { veredicto, nota: nota ?? null } });
}
