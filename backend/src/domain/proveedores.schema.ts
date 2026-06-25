import { z } from 'zod';

// Alta de proveedor. numero_3c OBLIGATORIO (decisión de J: solo proveedores que ya
// existen en 3c; regla #1 — el ID viene del ERP). cuit opcional.
export const CrearProveedorSchema = z.object({
  numero_3c: z.coerce.number().int().positive(),
  nombre: z.string().trim().min(1).max(150),
  cuit: z.string().trim().max(20).optional(),
});
export type CrearProveedorInput = z.infer<typeof CrearProveedorSchema>;

// Filtros del gasto por proveedor (para el gráfico).
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');
export const GastoQuerySchema = z
  .object({
    familia: z.string().trim().min(1).max(64).optional(),
    desde: fechaYmd.optional(),
    hasta: fechaYmd.optional(),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });
export type GastoQuery = z.infer<typeof GastoQuerySchema>;
