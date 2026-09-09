CREATE TABLE "abastecimiento_revisiones" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"area_dep_3c" integer NOT NULL,
	"producto_3c" varchar(32) NOT NULL,
	"veredicto" varchar(8) NOT NULL,
	"nota" text,
	"usuario_id" integer NOT NULL,
	"revisado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "abastecimiento_revisiones" ADD CONSTRAINT "abastecimiento_revisiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_abast_revision" ON "abastecimiento_revisiones" USING btree ("fecha","area_dep_3c","producto_3c");--> statement-breakpoint
CREATE INDEX "idx_abast_revision_fecha" ON "abastecimiento_revisiones" USING btree ("fecha");