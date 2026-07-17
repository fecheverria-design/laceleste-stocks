# syntax=docker/dockerfile:1

# Imagen del frontend: buildea el estático con Vite y lo sirve con nginx, que además hace
# de proxy de /api al backend. Un solo puerto expuesto → un solo link en Traefik y sin CORS.
# Contexto de build: la RAÍZ del repo.
#   docker build -f frontend/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root --include=dev
COPY frontend/ frontend/
# Sin VITE_API_URL a propósito: el cliente HTTP cae a rutas relativas (/api…) y las
# resuelve el nginx de abajo, en el mismo origen. Setearlo acá rompería eso.
RUN npm run build -w frontend

FROM nginx:alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
