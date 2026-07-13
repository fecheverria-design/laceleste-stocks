import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Maestro de artículos (productos). Regla #8: schema Zod único, compartible con el
// front. Regla #1 (matizada por J): los artículos de 3c conservan su codigo_3c; los
// creados en NUESTRA app reciben un código propio que CONTINÚA la numeración (no se
// manda en el alta: lo genera el backend) y quedan marcados creado_local.
// ─────────────────────────────────────────────────────────────────────────────

// Rubro/subrubro: se guardan en MAYÚSCULAS (como el import de 3c). '' → null.
const rubro = z
  .string()
  .trim()
  .max(64)
  .transform((s) => (s === '' ? null : s.toUpperCase()))
  .nullish()
  .transform((s) => s ?? null);

// Texto opcional que '' → null.
const textoNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullish()
    .transform((s) => s ?? null);

// Factor de bulto: número positivo o null (1 = suelto).
const factorBulto = z
  .number()
  .finite()
  .positive()
  .nullish()
  .transform((n) => n ?? null);

// Campos de presentación/bulto/ABC/info comunes a alta y edición.
const camposComunes = {
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(200),
  unidad_base: z.string().trim().min(1, 'La unidad es obligatoria').max(16),
  familia: rubro,
  subfamilia: rubro,
  presentacion_compra: textoNull(100),
  unidades_por_bulto: factorBulto,
  clasificacion_abc: textoNull(4).transform((s) => (s === null ? null : s.toUpperCase())),
  informacion: textoNull(500),
};

export const CrearArticuloSchema = z.object(camposComunes);
export type CrearArticuloInput = z.infer<typeof CrearArticuloSchema>;

// Editar: mismos campos + activo (baja lógica). El codigo_3c NO se edita (es la PK).
export const EditarArticuloSchema = z.object({ ...camposComunes, activo: z.boolean().optional() });
export type EditarArticuloInput = z.infer<typeof EditarArticuloSchema>;

// Filtros del listado del maestro: búsqueda por texto (código o nombre), familia,
// activo, y paginado. `q` matchea código o nombre (ILIKE en el repo).
export const ArticulosQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  familia: z.string().trim().max(64).optional(),
  activo: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type ArticulosQuery = z.infer<typeof ArticulosQuerySchema>;
