#!/bin/sh
set -e

# Las migraciones corren acá y no en el build porque necesitan la DB viva.
# compose ya espera a que el healthcheck de Postgres pase antes de arrancar esto.
# db:migrate usa tsx sobre src/ (drizzle resuelve las migraciones .sql relativas al
# fuente, no al dist) — por eso la imagen conserva src/ y las devDependencies.
echo "▶ Aplicando migraciones…"
npm run db:migrate

echo "▶ Arrancando backend…"
exec node backend/dist/index.js
