import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Schema Zod ÚNICO del ingreso de abastecimiento (regla #8: compartido back/front).
// Contrato del POST que manda la app del compañero. SUPUESTOS razonables (a validar
// con el compañero — ver docs/PROGRESO.md "contrato del POST"):
//   - El ÁREA destino se identifica por su dep_id de 3c (regla #1: IDs de 3c = verdad).
//   - El depósito origen es opcional; si falta, se usa DEPOSITO_PRINCIPAL_DEP_ID_3C.
//   - cantidad_real es obligatoria y es LA VERDAD que descuenta stock (regla #2).
//     cantidad_sugerida y stock_contado son referencia (lo que mostraba/contaba el área).
// ─────────────────────────────────────────────────────────────────────────────

// Cantidad numérica no negativa, hasta 3 decimales (coincide con numeric(12,3)).
const cantidad = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Number.isInteger(Math.round(n * 1000)), {
    message: 'Hasta 3 decimales',
  });

export const RenglonAbastecimientoSchema = z.object({
  producto_3c: z.string().trim().min(1).max(32), // código de 3c (regla #1)
  cantidad_real: cantidad, // obligatoria: mueve stock (regla #2)
  cantidad_sugerida: cantidad.optional(), // referencia
  stock_contado: cantidad.optional(), // referencia: lo que contó el área
  unidad: z.string().trim().min(1).max(16),
  observaciones: z.string().trim().max(500).optional(),
});

export const AbastecimientoSchema = z.object({
  destino_dep_id_3c: z.number().int().positive(), // área que recibe (dep_id de 3c)
  origen_dep_id_3c: z.number().int().positive().optional(), // depósito que despacha
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD')
    .optional(), // default: hoy
  turno: z.enum(['MAÑANA', 'TARDE']).optional(),
  proyeccion: z.enum(['MIN', 'MED', 'MAX', 'ESP']).optional(),
  observaciones: z.string().trim().max(500).optional(),
  detalle: z.array(RenglonAbastecimientoSchema).min(1, 'El abastecimiento necesita al menos un renglón'),
});

export type AbastecimientoInput = z.infer<typeof AbastecimientoSchema>;
export type RenglonAbastecimiento = z.infer<typeof RenglonAbastecimientoSchema>;
