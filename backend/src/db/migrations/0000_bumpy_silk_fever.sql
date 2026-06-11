CREATE TABLE "lotes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"codigo_lote" varchar(64),
	"vencimiento" date
);
--> statement-breakpoint
CREATE TABLE "movimientos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"nro" varchar(32) NOT NULL,
	"tipo_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"hora" time NOT NULL,
	"turno" varchar(16),
	"origen_id" integer NOT NULL,
	"destino_id" integer NOT NULL,
	"estado" varchar(16) DEFAULT 'BORRADOR' NOT NULL,
	"proyeccion" varchar(16),
	"proveedor_id" integer,
	"usuario_id" integer NOT NULL,
	"nro_3c" varchar(64),
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmado_en" timestamp with time zone,
	"anulado_en" timestamp with time zone,
	"anulado_por" integer,
	CONSTRAINT "movimientos_nro_unique" UNIQUE("nro")
);
--> statement-breakpoint
CREATE TABLE "movimientos_detalle" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"movimiento_id" bigint NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"cantidad_real" numeric(12, 3) NOT NULL,
	"cantidad_sugerida" numeric(12, 3),
	"stock_contado" numeric(12, 3),
	"unidad" varchar(16) NOT NULL,
	"lote_id" bigint,
	"observaciones" text,
	CONSTRAINT "chk_real_positiva" CHECK ("movimientos_detalle"."cantidad_real" >= 0)
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"codigo_3c" varchar(32) PRIMARY KEY NOT NULL,
	"nombre" varchar(200) NOT NULL,
	"unidad_base" varchar(16) NOT NULL,
	"presentacion" jsonb,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" varchar(150) NOT NULL,
	"cuit" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "tipos_movimiento" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo" varchar(16) NOT NULL,
	"nombre" varchar(100) NOT NULL,
	"signo_stock" smallint NOT NULL,
	CONSTRAINT "tipos_movimiento_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "ubicaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" varchar(100) NOT NULL,
	"tipo" varchar(16) NOT NULL,
	"dep_id_3c" integer NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" varchar(100) NOT NULL,
	"email" varchar(150) NOT NULL,
	"pass_hash" varchar(255) NOT NULL,
	"rol" varchar(16) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "lotes" ADD CONSTRAINT "lotes_producto_3c_productos_codigo_3c_fk" FOREIGN KEY ("producto_3c") REFERENCES "public"."productos"("codigo_3c") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_tipo_id_tipos_movimiento_id_fk" FOREIGN KEY ("tipo_id") REFERENCES "public"."tipos_movimiento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_origen_id_ubicaciones_id_fk" FOREIGN KEY ("origen_id") REFERENCES "public"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_destino_id_ubicaciones_id_fk" FOREIGN KEY ("destino_id") REFERENCES "public"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_anulado_por_usuarios_id_fk" FOREIGN KEY ("anulado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_detalle" ADD CONSTRAINT "movimientos_detalle_movimiento_id_movimientos_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimientos"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_detalle" ADD CONSTRAINT "movimientos_detalle_producto_3c_productos_codigo_3c_fk" FOREIGN KEY ("producto_3c") REFERENCES "public"."productos"("codigo_3c") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_detalle" ADD CONSTRAINT "movimientos_detalle_lote_id_lotes_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mov_fecha" ON "movimientos" USING btree ("fecha" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_mov_estado" ON "movimientos" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "idx_mov_destino_fecha" ON "movimientos" USING btree ("destino_id","fecha" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_det_mov" ON "movimientos_detalle" USING btree ("movimiento_id");--> statement-breakpoint
CREATE INDEX "idx_det_producto" ON "movimientos_detalle" USING btree ("producto_3c");