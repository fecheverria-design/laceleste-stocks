ALTER TABLE "proveedores" ADD COLUMN "numero_3c" integer;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_numero_3c_unique" UNIQUE("numero_3c");