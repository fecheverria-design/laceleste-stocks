-- Indicadores mensuales de carga manual: ventas del mes e inflación oficial.
-- No salen de 3c ni de ningún sync: los carga el área de compras a principio de mes.
--
-- NOTA: `drizzle-kit generate` emitió además los cambios de `compras` (la columna `renglon`
-- y el índice único que la incluye), pero esos YA se habían aplicado a mano en la 0016 — el
-- snapshot venía desfasado. Se quitaron de acá porque repetirlos falla: el índice viejo que
-- intentaba borrar ya no existe. El snapshot quedó al día, así que las próximas migraciones
-- no los vuelven a emitir.
CREATE TABLE "indicadores_mensuales" (
	"periodo" varchar(7) PRIMARY KEY NOT NULL,
	"ventas" numeric(16, 2),
	"inflacion" numeric(8, 6),
	"usuario_id" integer NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "indicadores_mensuales" ADD CONSTRAINT "indicadores_mensuales_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;
