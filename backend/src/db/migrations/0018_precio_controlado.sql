-- Precio CONTROLADO: la marca manual del área de compras sobre una fila de `precios`.
--
-- Hasta acá, "cuál es el precio del producto" lo decidía sola la categoría de la fila
-- (la última COMPRA ganaba). Marcar un precio en la pantalla de Control lo pasaba a tipo
-- COMPRA, o sea que para elegirlo había que mentir sobre qué era. Decisión de J
-- (2026-08-04): lo que marca compras es la verdad absoluta —tanto una compra como una
-- actualización pueden ser un error de carga—, así que la marca es un campo propio,
-- independiente del tipo, y le gana a todo.
--
-- Uno solo por producto: el índice parcial lo garantiza a nivel DB, y marcar uno nuevo
-- desmarca el anterior en la misma transacción.
ALTER TABLE "precios" ADD COLUMN "controlado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "precios" ADD COLUMN "controlado_por" integer;--> statement-breakpoint
ALTER TABLE "precios" ADD CONSTRAINT "precios_controlado_por_usuarios_id_fk" FOREIGN KEY ("controlado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_precio_controlado_producto" ON "precios" USING btree ("producto_3c") WHERE "precios"."controlado_en" IS NOT NULL;