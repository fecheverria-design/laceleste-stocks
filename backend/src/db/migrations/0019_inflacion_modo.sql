-- La inflación se puede cargar de las dos formas en que se publica: mensual o acumulada.
--
-- Hasta acá `indicadores_mensuales.inflacion` era la variación MENSUAL, y eso vivía solo en
-- un comentario. El 05/08/2026 se cargó la serie acumulada del año en esa misma columna
-- (2,9 / 5,9 / 9,5 / 12,2 / 14,6 / 17,0) y nada avisó: el validador solo mira que el número
-- esté entre ±100%, y 17% en un mes es perfectamente posible. El informe quedó comparando la
-- canasta contra una inflación mensual del 17% y una ventana de 3 meses de ~40%.
--
-- La columna guarda ahora LO QUE SE TIPEÓ y `inflacion_modo` dice qué significa. La serie
-- mensual —la que consume todo el informe— se deriva al servir:
--   mensual_m = (1 + acum_m) / (1 + acum_m-1) − 1,  con base 0 en diciembre del año anterior,
-- que es la convención del acumulado del año calendario.
--
-- El default MENSUAL conserva el significado de las filas viejas. Las que hoy están en
-- producción son acumuladas y se reetiquetan a mano en el deploy: reinterpretar datos ya
-- cargados no es algo que deba decidir una migración.
ALTER TABLE "indicadores_mensuales" ADD COLUMN "inflacion_modo" text DEFAULT 'MENSUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "indicadores_mensuales" ADD CONSTRAINT "indicadores_inflacion_modo_check" CHECK ("inflacion_modo" IN ('MENSUAL', 'ACUMULADA'));
