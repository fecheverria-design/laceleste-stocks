import { z } from 'zod';

// Filtros del cruce app-del-compañero contra 3c (regla #8: compartido con el front).
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

export const DesempenoQuerySchema = z
  .object({
    // Sin fechas: el período por defecto es el que cubre el export de 3c, sin el día en curso.
    desde: fechaYmd.optional(),
    hasta: fechaYmd.optional(),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });

export type DesempenoQuery = z.infer<typeof DesempenoQuerySchema>;
