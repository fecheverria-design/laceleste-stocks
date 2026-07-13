ALTER TABLE "productos" ADD COLUMN "presentacion_compra" varchar(100);--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "unidades_por_bulto" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "clasificacion_abc" varchar(4);--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "informacion" text;