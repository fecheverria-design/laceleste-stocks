# syntax=docker/dockerfile:1

# Imagen del backend (Express + Drizzle).
# OJO: el contexto de build es la RAÍZ del repo, no backend/. El monorepo instala con
# workspaces desde el package.json de arriba, así que necesita el package-lock de la raíz.
#   docker build -f backend/Dockerfile .

FROM node:20-alpine AS base
WORKDIR /app
# La app razona por DÍA (fecha del movimiento, ventana móvil de los syncs). Sin tzdata el
# contenedor corre en UTC y un movimiento de la noche cae en el día siguiente.
RUN apk add --no-cache tzdata
ENV TZ=America/Argentina/Buenos_Aires

FROM base AS build
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --include-workspace-root --include=dev
COPY backend/ backend/
RUN npm run build -w backend

FROM base AS runtime
ENV NODE_ENV=production

# Se copian node_modules CON devDependencies a propósito. No es un descuido: los scripts de
# operación (sync:*, import:*, usuarios, db:migrate) corren con tsx sobre src/, que es una
# devDependency. Sacarla achica la imagen y rompe la operación diaria.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend ./backend

COPY docker/backend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
