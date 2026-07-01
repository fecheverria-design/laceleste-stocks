CREATE TABLE "inventario_lineas" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventario_id" integer NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"unidad" varchar(16) NOT NULL,
	"cantidad_contada" numeric(12, 3)
);
--> statement-breakpoint
CREATE TABLE "inventarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"ubicacion_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"estado" varchar(16) DEFAULT 'BORRADOR' NOT NULL,
	"familias" jsonb,
	"observaciones" text,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmado_en" timestamp with time zone,
	"confirmado_por" integer,
	"movimiento_entrada_id" bigint,
	"movimiento_salida_id" bigint
);
--> statement-breakpoint
ALTER TABLE "inventario_lineas" ADD CONSTRAINT "inventario_lineas_inventario_id_inventarios_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."inventarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_lineas" ADD CONSTRAINT "inventario_lineas_producto_3c_productos_codigo_3c_fk" FOREIGN KEY ("producto_3c") REFERENCES "public"."productos"("codigo_3c") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "public"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_confirmado_por_usuarios_id_fk" FOREIGN KEY ("confirmado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_movimiento_entrada_id_movimientos_id_fk" FOREIGN KEY ("movimiento_entrada_id") REFERENCES "public"."movimientos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventarios" ADD CONSTRAINT "inventarios_movimiento_salida_id_movimientos_id_fk" FOREIGN KEY ("movimiento_salida_id") REFERENCES "public"."movimientos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_inv_linea_inv" ON "inventario_lineas" USING btree ("inventario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inv_linea" ON "inventario_lineas" USING btree ("inventario_id","producto_3c");