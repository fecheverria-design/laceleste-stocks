CREATE TABLE "movimientos_auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"movimiento_id" bigint NOT NULL,
	"usuario_id" integer NOT NULL,
	"accion" varchar(16) NOT NULL,
	"cambios" jsonb NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movimientos_auditoria" ADD CONSTRAINT "movimientos_auditoria_movimiento_id_movimientos_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimientos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimientos_auditoria" ADD CONSTRAINT "movimientos_auditoria_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_mov" ON "movimientos_auditoria" USING btree ("movimiento_id");