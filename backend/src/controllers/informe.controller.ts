import type { Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../domain/errors.js';
import { enviarCsv } from '../lib/csv.js';
import { EvolucionQuerySchema, InformePreciosQuerySchema, InformeQuerySchema } from '../domain/informe.schema.js';
import { evolucionGasto, informePorComprador, mesesDisponibles } from '../services/informe.service.js';
import { informePrecios } from '../services/informe-precios.service.js';

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

// GET /api/informe/precios?mes=YYYY-MM[&meses=12] — matriz de cotizaciones, cobertura,
// control de datos, ahorro potencial, variación 1/3/6m, canasta A y evolución de precios.
export async function getInformePrecios(req: Request, res: Response): Promise<void> {
  const parsed = InformePreciosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  res.status(200).json(await informePrecios(parsed.data.mes, parsed.data.meses));
}

// GET /api/informe/matriz.csv — la matriz de precios A, una fila por cotización.
export async function getMatrizCsv(req: Request, res: Response): Promise<void> {
  const parsed = InformePreciosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const informe = await informePrecios(parsed.data.mes, parsed.data.meses);
  enviarCsv(
    res,
    `informe-matriz-precios-${informe.mes}.csv`,
    ['Codigo 3c', 'Producto', 'Familia', 'Cotiz. vigentes', 'Proveedor', 'Precio', 'Fecha', 'Dias', 'Vigente', 'Es el usado'],
    informe.matriz.flatMap((m) =>
      m.cotizaciones.map((c) => [
        m.producto_3c,
        m.producto,
        m.familia ?? '',
        String(m.n_prov),
        c.proveedor,
        money(c.precio),
        c.fecha,
        String(c.dias),
        c.vigente ? 'SI' : 'NO',
        c.es_usado ? 'SI' : '',
      ]),
    ),
  );
}

// GET /api/informe/ahorro.csv — los dos lados del ahorro potencial en un solo archivo.
export async function getAhorroCsv(req: Request, res: Response): Promise<void> {
  const parsed = InformePreciosQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw badRequest('VALIDACION', z.prettifyError(parsed.error));
  }
  const { ahorro, mes } = await informePrecios(parsed.data.mes, parsed.data.meses);
  const filas = [
    ...ahorro.favor.map((f) => ({ lado: 'A FAVOR', f })),
    ...ahorro.contra.map((f) => ({ lado: 'EN CONTRA', f })),
  ];
  enviarCsv(
    res,
    `informe-ahorro-${mes}.csv`,
    ['Lado', 'Producto', 'Familia', 'Comprador', 'Precio compra', 'Mejor alternativa', 'Proveedor alternativa', 'Gap %', 'Gasto del mes', 'Monto'],
    filas.map(({ lado, f }) => [
      lado,
      f.producto,
      f.familia ?? '',
      f.comprador ?? '',
      money(f.compra),
      money(f.mejor),
      f.mejor_proveedor,
      pct(f.gap),
      money(f.gasto),
      money(f.monto),
    ]),
  );
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
