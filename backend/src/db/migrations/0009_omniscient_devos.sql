CREATE TABLE "compras" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"numero" varchar(64) NOT NULL,
	"fecha" date NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"proveedor_id" integer,
	"cantidad" numeric(14, 4) NOT NULL,
	"precio_unitario" numeric(14, 4) NOT NULL,
	"precio_total" numeric(16, 2) NOT NULL,
	"iva" numeric(6, 4),
	"total_con_iva" numeric(16, 2),
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "familia" varchar(64);--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_producto_3c_productos_codigo_3c_fk" FOREIGN KEY ("producto_3c") REFERENCES "public"."productos"("codigo_3c") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_compras_proveedor" ON "compras" USING btree ("proveedor_id");--> statement-breakpoint
CREATE INDEX "idx_compras_fecha" ON "compras" USING btree ("fecha" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_compras_numero_producto" ON "compras" USING btree ("numero","producto_3c");