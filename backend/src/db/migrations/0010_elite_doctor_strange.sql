ALTER TABLE "movimientos" ADD COLUMN "idempotencia_key" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mov_idempotencia" ON "movimientos" USING btree ("idempotencia_key");