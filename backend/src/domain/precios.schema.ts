import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Schema Zod ÚNICO de precios (regla #8: compartido back/front). Un precio es un
// monto que entra en vigencia en una fecha. El precio vigente de un producto es el
// de mayor vigente_desde <= hoy. `producto_3c` es el código de 3c (regla #1).
// ─────────────────────────────────────────────────────────────────────────────

// Monto no negativo, hasta 4 decimales (coincide con numeric(14,4)).
const monto = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Number.isInteger(Math.round(n * 10000)), {
    message: 'Hasta 4 decimales',
  });

const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

export const CrearPrecioSchema = z.object({
  producto_3c: z.string().trim().min(1).max(32),
  precio: monto,
  vigente_desde: fechaYmd.optional(), // default: hoy
});

export type CrearPrecioInput = z.infer<typeof CrearPrecioSchema>;

// Editar un precio ya cargado (corregir monto o fecha). Al menos un campo.
export const EditarPrecioSchema = z
  .object({
    precio: monto.optional(),
    vigente_desde: fechaYmd.optional(),
  })
  .refine((p) => p.precio !== undefined || p.vigente_desde !== undefined, {
    message: 'Nada para editar: mandá precio y/o vigente_desde',
  });

export type EditarPrecioInput = z.infer<typeof EditarPrecioSchema>;
