import { z } from 'zod';

// Filtros y payload del indicador de abastecimiento (regla #8: compartido con el front).
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

export const AbastecimientoQuerySchema = z
  .object({
    desde: fechaYmd.optional(), // default: últimos 30 días
    hasta: fechaYmd.optional(),
    /** Áreas a medir (dep_id_3c). Por defecto, las que usan la app del compañero. */
    areas: z
      .string()
      .regex(/^\d+(,\d+)*$/, 'Lista de dep_id_3c separados por coma')
      .optional(),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });

// El check manual de un caso. `veredicto: null` saca la revisión y lo deja como lo dejó la regla.
export const RevisionSchema = z.object({
  fecha: fechaYmd,
  area_dep_3c: z.coerce.number().int().positive(),
  producto_3c: z.string().trim().min(1).max(32),
  veredicto: z.enum(['BIEN', 'MAL']).nullable(),
  nota: z.string().trim().max(500).nullable().optional(),
});

export type AbastecimientoQuery = z.infer<typeof AbastecimientoQuerySchema>;
export type RevisionPayload = z.infer<typeof RevisionSchema>;
