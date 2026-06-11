# laceleste-movimientos

Módulo de **Movimientos Internos** de La Celeste (recepciones, remitos internos a áreas y ajustes de stock). Monorepo independiente: backend propio, DB propia, frontend propio. Contexto completo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); reglas inviolables en [`CLAUDE.md`](CLAUDE.md).

## Stack

- **Backend:** Node 20+ · Express 5 · TypeScript estricto · Drizzle ORM · Zod · PostgreSQL 16
- **Frontend:** React 19 · Vite · Tailwind v4 · TanStack Query · React Router · React Hook Form · Zod
- **Infra:** Docker (Postgres local) · monorepo npm workspaces · GitHub Actions

## Estructura

```
backend/    API Express por capas (routes → controllers → services → repositories)
frontend/   SPA React por features
docs/        ARCHITECTURE.md (+ demo de UX)
docker-compose.yml   Postgres 16 local
```

## Arranque desde cero

Requisitos: Node 20+, Docker Desktop.

```bash
# 1. Variables de entorno
cp .env.example .env            # ajustar si hace falta (Windows: copy .env.example .env)

# 2. Dependencias (instala backend + frontend vía workspaces)
npm install

# 3. Base de datos (Postgres 16 en Docker, puerto host 5433)
docker compose up -d            # crea también la DB de test en el primer arranque

# 4. Migrar y seedear
npm run db:migrate              # aplica las migraciones Drizzle
npm run db:seed                 # carga tipos_movimiento: RECEPCION, RINT, AJUSTE

# 5. Levantar
npm run dev:backend             # http://localhost:3000  (health: /api/health)
npm run dev:frontend            # http://localhost:5173  (proxea /api al backend)
```

## Scripts útiles

| Comando | Qué hace |
|---|---|
| `npm run dev:backend` / `npm run dev:frontend` | Levanta backend / frontend en watch |
| `npm run build` | Buildea ambos workspaces |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` en ambos |
| `npm test` | Vitest (backend) — requiere Docker arriba |
| `npm run db:generate` | Genera migración Drizzle desde el schema |
| `npm run db:migrate` / `npm run db:seed` | Aplica migraciones / seed |

## Notas

- El `.env` real **no se commitea** (`.gitignore`); solo `.env.example`.
- Postgres expone el puerto **5433** en el host (configurable con `POSTGRES_PORT`) para no chocar con un Postgres local en 5432.
- Branching: `main` (desplegable) / `dev` (activo) / `feat/*`. Conventional commits.
