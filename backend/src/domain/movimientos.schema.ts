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
  // Id externo de la app del compañero para deduplicar (idempotencia M2M). Recomendado:
  // si se reenvía el mismo abastecimiento con la misma key, NO se duplica.
  idempotency_key: z.string().trim().min(1).max(100).optional(),
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

// ─────────────────────────────────────────────────────────────────────────────
// Recepción de mercadería (sync de la app del compañero) → RECEPCION auto-confirmada.
// Espejo del abastecimiento pero SUMA stock (regla del modelo: la dirección define el
// signo, no el tipo). Diferencias de cabecera respecto del abastecimiento:
//   - origen = depósito/balde del PROVEEDOR (de dónde entra la mercadería). Requerido.
//     Por defecto el balde genérico 102 (DEPOSITO DE PROVEEDORES, sin stock propio).
//   - destino = depósito que recibe; opcional, default DEPOSITO_PRINCIPAL (FABRICA).
//   - cantidad_real = lo efectivamente recibido (regla #2). Reusa el renglón de abast.
// ─────────────────────────────────────────────────────────────────────────────
export const RecepcionSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(100).optional(),
  origen_dep_id_3c: z.number().int().positive(), // proveedor que despacha (dep_id de 3c)
  destino_dep_id_3c: z.number().int().positive().optional(), // depósito que recibe; default FABRICA
  fecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD')
    .optional(),
  observaciones: z.string().trim().max(500).optional(),
  detalle: z.array(RenglonAbastecimientoSchema).min(1, 'La recepción necesita al menos un renglón'),
});

export type RecepcionInput = z.infer<typeof RecepcionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Filtros + paginado del listado GET /api/movimientos (regla #8: compartido front).
// `tipo` se valida como string libre (no enum): tipos_movimiento es catálogo
// extensible (regla del modelo). `estado` sí es un set fijo del ciclo de vida v1.
// Las queries llegan como strings → z.coerce para page/limit/ubicacion.
// ─────────────────────────────────────────────────────────────────────────────
const fechaYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD');

export const MovimientosQuerySchema = z
  .object({
    desde: fechaYmd.optional(),
    hasta: fechaYmd.optional(),
    tipo: z.string().trim().min(1).max(16).optional(), // codigo de tipos_movimiento
    estado: z.enum(['BORRADOR', 'CONFIRMADO', 'ANULADO']).optional(),
    ubicacion: z.coerce.number().int().positive().optional(), // ubicacion_id (origen O destino)
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(50),
  })
  .refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
    message: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });

export type MovimientosQuery = z.infer<typeof MovimientosQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Edición de un movimiento (regla #4 relajada 2026-06-19: editable con historial).
// Reemplazo COMPLETO: el cliente manda el estado nuevo entero (cabecera + renglones).
// Todo es editable, incluido tipo/origen/destino (decisión de J). El stock se
// recalcula y el cambio queda auditado. `tipo` se valida como codigo del catálogo.
// ─────────────────────────────────────────────────────────────────────────────
export const EditarMovimientoSchema = z.object({
  tipo: z.string().trim().min(1).max(16), // codigo de tipos_movimiento
  origen_dep_id_3c: z.number().int().positive(),
  destino_dep_id_3c: z.number().int().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD'),
  turno: z.enum(['MAÑANA', 'TARDE']).optional(),
  proyeccion: z.enum(['MIN', 'MED', 'MAX', 'ESP']).optional(),
  observaciones: z.string().trim().max(500).optional(),
  detalle: z.array(RenglonAbastecimientoSchema).min(1, 'El movimiento necesita al menos un renglón'),
});

export type EditarMovimientoInput = z.infer<typeof EditarMovimientoSchema>;

// Crear comparte el mismo shape que editar (cabecera + renglones).
export const CrearMovimientoSchema = EditarMovimientoSchema;
export type CrearMovimientoInput = EditarMovimientoInput;
