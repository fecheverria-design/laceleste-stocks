import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { enviarCsv } from '../lib/csv.js';
import { EvolucionQuerySchema, InformeQuerySchema } from '../domain/informe.schema.js';
import { evolucionGasto, informePorComprador, mesesDisponibles } from '../services/informe.service.js';

// Los números del informe van con coma decimal como el resto de los export de la app.
const money = (n: number): string => n.toFixed(2).replace('.', ',');
const pct = (v: number | null): string => (v === null ? '' : (v * 100).toFixed(1).replace('.', ','));

// GET /api/informe/compradores?mes=YYYY-MM[&comprador=] — gasto del mes por proveedor y por
// producto, con la variación contra el mes anterior.
export async function getInformeCompradores(req: Request, res: Response): Promise<void> {
  const parsed = InformeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await informePorComprador(parsed.data.mes, parsed.data.comprador));
}

// GET /api/informe/evolucion?mes=YYYY-MM[&meses=12][&comprador=] — serie del gasto.
export async function getInformeEvolucion(req: Request, res: Response): Promise<void> {
  const parsed = EvolucionQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await evolucionGasto(parsed.data.mes, parsed.data.meses, parsed.data.comprador));
}

// GET /api/informe/meses — meses con compras cargadas (para el selector).
export async function getInformeMeses(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await mesesDisponibles());
}

// GET /api/informe/export.csv — el detalle por producto con el mismo filtro de la pantalla.
export async function getInformeCsv(req: Request, res: Response): Promise<void> {
  const parsed = InformeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const informe = await informePorComprador(parsed.data.mes, parsed.data.comprador);
  enviarCsv(
    res,
    `informe-compras-${informe.mes}.csv`,
    ['Codigo 3c', 'Producto', 'Familia', 'Comprador', 'ABC', 'Gasto (con IVA)', 'Gasto mes anterior', 'Cantidad', 'Precio vigente', 'Precio mes anterior', 'Var. precio %', 'Precio pagado (prom.)'],
    informe.productos.map((p) => [
      p.producto_3c,
      p.nombre,
      p.familia ?? '',
      p.comprador,
      p.clasificacion_abc ?? '',
      money(p.gasto),
      money(p.gasto_anterior),
      money(p.cantidad),
      p.precio === null ? '' : money(p.precio),
      p.precio_anterior === null ? '' : money(p.precio_anterior),
      pct(p.var_precio),
      p.precio_pagado === null ? '' : money(p.precio_pagado),
    ]),
  );
}
