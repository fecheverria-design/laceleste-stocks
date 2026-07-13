import { z } from 'zod';

// Filtros del reporte de consumos (regla #8: compartido con el front).
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

export const ConsumosQuerySchema = z
  .object({
    desde: fechaYmd.optional(), // default: hace 12 semanas
    hasta: fechaYmd.optional(), // default: hoy
    producto_3c: z.string().trim().min(1).max(32).optional(),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });

export type ConsumosQuery = z.infer<typeof ConsumosQuerySchema>;
