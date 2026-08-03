import { z } from 'zod';
import { COMPRADORES } from './familias.js';

// Query del Informe de Compras. `mes` es el período que se mira (siempre se compara contra
// el anterior, que se deriva). `comprador` filtra la atribución por familia; sin él, entran
// todos los que tienen comprador asignado.
export const InformeQuerySchema = z.object({
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (esperado YYYY-MM)'),
  comprador: z.enum(COMPRADORES).optional(),
});

export type InformeQuery = z.infer<typeof InformeQuerySchema>;

// Evolución del gasto: la misma query más cuántos meses mirar hacia atrás.
export const EvolucionQuerySchema = InformeQuerySchema.extend({
  meses: z.coerce.number().int().min(2).max(36).default(12),
});

export type EvolucionQuery = z.infer<typeof EvolucionQuerySchema>;

// Matriz de precios, cobertura, ahorro, canasta y evolución: solo necesita el mes y la
// ventana. El comprador no filtra acá — las solapas de precios muestran todos los A y el
// filtro por comprador se aplica en pantalla.
export const InformePreciosQuerySchema = z.object({
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes inválido (esperado YYYY-MM)'),
  meses: z.coerce.number().int().min(2).max(36).default(12),
});

export type InformePreciosQuery = z.infer<typeof InformePreciosQuerySchema>;
