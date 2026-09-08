CREATE TABLE "movimientos_3c" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"numero" varchar(64) NOT NULL,
	"renglon" integer DEFAULT 1 NOT NULL,
	"tipo_doc" varchar(16) NOT NULL,
	"origen_dep_3c" integer,
	"destino_dep_3c" integer,
	"producto_3c" varchar(32) NOT NULL,
	"cantidad" numeric(14, 4) NOT NULL,
	"unidad" varchar(16),
	"usuario_3c" varchar(64),
	"importado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mov3c_numero_producto_renglon" ON "movimientos_3c" USING btree ("numero","producto_3c","renglon");--> statement-breakpoint
CREATE INDEX "idx_mov3c_fecha" ON "movimientos_3c" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "idx_mov3c_destino" ON "movimientos_3c" USING btree ("destino_dep_3c");