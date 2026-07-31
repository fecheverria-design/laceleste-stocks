-- ─────────────────────────────────────────────────────────────────────────────
-- compras.renglon: un mismo remito puede traer el MISMO producto en varias líneas.
-- La clave única era (numero, producto_3c), así que en esos casos la segunda línea
-- pisaba a la primera y la compra se perdía. Medido sobre el export del 31/07/2026:
-- 65 renglones y $60.705.167 netos que nunca entraron, y por eso el gasto de junio
-- de Fausto daba $71,5M contra los $74,15M del informe.
--
-- El export de 3c NO trae un id de línea (DOC_ID es del documento y se repite), así
-- que el renglón lo numera el importador por orden de aparición dentro de cada
-- (numero, producto_3c). Es determinístico: reimportar el mismo archivo cae en las
-- mismas filas y sigue siendo idempotente.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE compras ADD COLUMN IF NOT EXISTS renglon integer NOT NULL DEFAULT 1;
--> statement-breakpoint

DROP INDEX IF EXISTS uq_compras_numero_producto;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_numero_producto_renglon
  ON compras (numero, producto_3c, renglon);
