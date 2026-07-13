CREATE TABLE "precios" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"precio" numeric(14, 4) NOT NULL,
	"vigente_desde" date NOT NULL,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_precio_positivo" CHECK ("precios"."precio" >= 0)
);
--> statement-breakpoint
ALTER TABLE "precios" ADD CONSTRAINT "precios_producto_3c_productos_codigo_3c_fk" FOREIGN KEY ("producto_3c") REFERENCES "public"."productos"("codigo_3c") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precios" ADD CONSTRAINT "precios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_precios_producto_fecha" ON "precios" USING btree ("producto_3c","vigente_desde" DESC NULLS LAST);