import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Indicadores mensuales de carga manual: ventas del mes e inflación oficial.
// Los dos campos son opcionales y aceptan null: "no lo sé todavía" es un estado válido
// (la inflación se publica a mitad del mes siguiente, el cierre de ventas puede demorar).
//
// La inflación se puede cargar MENSUAL o ACUMULADA del año, y el modo viaja SIEMPRE con el
// número. Que fuera implícito es lo que dejó pasar, sin un solo aviso, una serie acumulada
// cargada como si fuera mensual (05/08/2026): el informe comparó la canasta contra una
// inflación de un mes del 17%.
// ─────────────────────────────────────────────────────────────────────────────

const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (esperado YYYY-MM)');

const ventas = z.number().finite().nonnegative().nullable();

export const InflacionModoSchema = z.enum(['MENSUAL', 'ACUMULADA']);

// FRACCIÓN, no porcentaje: 0.025 = 2,5%.
const inflacion = z.number().finite().nullable();

/**
 * Límites por modo. Son el único filtro automático contra el dedazo, así que se eligieron
 * apretados donde se puede:
 * - MENSUAL: ±100%. Una variación mensual fuera de ese rango es, con seguridad, un
 *   porcentaje mal tipeado.
 * - ACUMULADA: hasta 1000% anual. Suena enorme, pero acá la acumulada de un año llegó a
 *   211% (2023) y el techo tiene que dejarla entrar.
 */
const LIMITES: Record<z.infer<typeof InflacionModoSchema>, { min: number; max: number; ayuda: string }> = {
  MENSUAL: {
    min: -1,
    max: 1,
    ayuda: 'La inflación mensual se carga como fracción y va entre -100% y 100%: 0,025 = 2,5%',
  },
  ACUMULADA: {
    min: -0.9,
    max: 10,
    ayuda: 'La inflación acumulada del año se carga como fracción: 0,17 = 17%',
  },
};

export const GuardarIndicadorSchema = z
  .object({
    periodo,
    ventas: ventas.optional(),
    inflacion: inflacion.optional(),
    inflacion_modo: InflacionModoSchema.optional(),
  })
  .refine((d) => d.ventas !== undefined || d.inflacion !== undefined, {
    message: 'Nada para guardar: mandá ventas y/o inflación',
  })
  // Un número de inflación sin modo es ambiguo, y la ambigüedad ya costó un informe entero.
  .refine((d) => d.inflacion === undefined || d.inflacion === null || d.inflacion_modo !== undefined, {
    message: 'Falta inflacion_modo: decí si el número es MENSUAL o ACUMULADA del año',
    path: ['inflacion_modo'],
  })
  .superRefine((d, ctx) => {
    if (d.inflacion === undefined || d.inflacion === null || d.inflacion_modo === undefined) return;
    const { min, max, ayuda } = LIMITES[d.inflacion_modo];
    if (d.inflacion < min || d.inflacion > max) {
      ctx.addIssue({ code: 'custom', message: ayuda, path: ['inflacion'] });
    }
  });

export type GuardarIndicadorInput = z.infer<typeof GuardarIndicadorSchema>;

// Rango de consulta. Sin parámetros devuelve todo lo cargado.
export const IndicadoresQuerySchema = z.object({
  desde: periodo.optional(),
  hasta: periodo.optional(),
});

export type IndicadoresQuery = z.infer<typeof IndicadoresQuerySchema>;
