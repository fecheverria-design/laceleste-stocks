import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Inventarios (conteo físico → AJUSTE). Regla #8: schema Zod único. La hoja se arma
// por depósito + familias; se completa `cantidad_contada` por renglón; al confirmar se
// generan los AJUSTE contra el balde 101 para dejar el stock exacto en lo contado.
// ─────────────────────────────────────────────────────────────────────────────

const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

// Cantidad contada: número no negativo hasta 3 decimales (coincide con numeric(12,3)).
const contada = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Number.isInteger(Math.round(n * 1000)), { message: 'Hasta 3 decimales' });

export const CrearInventarioSchema = z.object({
  ubicacion_id: z.number().int().positive(), // depósito a contar (id interno de ubicaciones)
  fecha: fechaYmd,
  // Familias a incluir; si se omite, el service usa las 5 de insumos por defecto.
  familias: z.array(z.string().trim().min(1).max(64)).optional(),
  observaciones: z.string().trim().max(500).optional(),
});
export type CrearInventarioInput = z.infer<typeof CrearInventarioSchema>;

// Guardar avances del conteo: cada renglón con su cantidad (o null = sin contar aún).
export const GuardarLineasSchema = z.object({
  lineas: z
    .array(
      z.object({
        producto_3c: z.string().trim().min(1).max(32),
        cantidad_contada: contada.nullable(),
      }),
    )
    .min(1),
});
export type GuardarLineasInput = z.infer<typeof GuardarLineasSchema>;

// Agregar a la hoja un producto que no estaba (contaron algo fuera de la familia).
export const AgregarLineaSchema = z.object({
  producto_3c: z.string().trim().min(1).max(32),
});
export type AgregarLineaInput = z.infer<typeof AgregarLineaSchema>;
