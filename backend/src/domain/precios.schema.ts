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

const tipoPrecio = z.enum(['COMPRA', 'ACTUALIZACION']);

// `proveedor_id` es opcional pero importa: sin él, la cotización no se puede comparar contra
// las de otros proveedores y queda fuera del ahorro potencial y del conteo de cobertura.
// null es válido y significa "no sabemos de quién es" (así entran los precios viejos).
const proveedorId = z.number().int().positive().nullable();

export const CrearPrecioSchema = z.object({
  producto_3c: z.string().trim().min(1).max(32),
  precio: monto,
  tipo: tipoPrecio.optional(), // default: COMPRA
  vigente_desde: fechaYmd.optional(), // default: hoy
  proveedor_id: proveedorId.optional(),
});

export type CrearPrecioInput = z.infer<typeof CrearPrecioSchema>;

// Editar un precio ya cargado (corregir monto, fecha, tipo o proveedor). Al menos un campo.
export const EditarPrecioSchema = z
  .object({
    precio: monto.optional(),
    tipo: tipoPrecio.optional(),
    vigente_desde: fechaYmd.optional(),
    proveedor_id: proveedorId.optional(),
  })
  .refine(
    (p) =>
      p.precio !== undefined ||
      p.vigente_desde !== undefined ||
      p.tipo !== undefined ||
      p.proveedor_id !== undefined,
    { message: 'Nada para editar: mandá precio, tipo, proveedor y/o vigente_desde' },
  );

export type EditarPrecioInput = z.infer<typeof EditarPrecioSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Control de precios: la hoja de trabajo del área de compras. Filtra el maestro por
// prioridad y familia para armar la lista de lo que hay que revisar.
// ─────────────────────────────────────────────────────────────────────────────
export const ControlPreciosQuerySchema = z.object({
  abc: z.enum(['A', 'B', 'C', 'TODOS']).default('A'),
  familia: z.string().trim().min(1).optional(),
});

export type ControlPreciosQuery = z.infer<typeof ControlPreciosQuerySchema>;
