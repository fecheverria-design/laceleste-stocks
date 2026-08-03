import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Indicadores mensuales de carga manual: ventas del mes e inflación oficial.
// Los dos campos son opcionales y aceptan null: "no lo sé todavía" es un estado válido
// (la inflación se publica a mitad del mes siguiente, el cierre de ventas puede demorar).
// ─────────────────────────────────────────────────────────────────────────────

const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (esperado YYYY-MM)');

const ventas = z.number().finite().nonnegative().nullable();

// FRACCIÓN, no porcentaje: 0.025 = 2,5%. El límite de ±100% mensual no es capricho —
// una inflación mensual fuera de ese rango es, con seguridad, un porcentaje mal tipeado.
const inflacion = z
  .number()
  .finite()
  .min(-1, 'La inflación mensual se carga como fracción: 0,025 = 2,5%')
  .max(1, 'La inflación mensual se carga como fracción: 0,025 = 2,5%')
  .nullable();

export const GuardarIndicadorSchema = z
  .object({
    periodo,
    ventas: ventas.optional(),
    inflacion: inflacion.optional(),
  })
  .refine((d) => d.ventas !== undefined || d.inflacion !== undefined, {
    message: 'Nada para guardar: mandá ventas y/o inflación',
  });

export type GuardarIndicadorInput = z.infer<typeof GuardarIndicadorSchema>;

// Rango de consulta. Sin parámetros devuelve todo lo cargado.
export const IndicadoresQuerySchema = z.object({
  desde: periodo.optional(),
  hasta: periodo.optional(),
});

export type IndicadoresQuery = z.infer<typeof IndicadoresQuerySchema>;
