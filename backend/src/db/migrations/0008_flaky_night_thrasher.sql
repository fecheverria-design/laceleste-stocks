DROP INDEX "uq_precio_prod_prov_fecha";--> statement-breakpoint
ALTER TABLE "precios" ADD COLUMN "tipo" varchar(16) DEFAULT 'COMPRA' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_precio_prod_prov_fecha_tipo" ON "precios" USING btree ("producto_3c","proveedor_id","vigente_desde","tipo");