# PROGRESO — laceleste-movimientos

> Estado para retomar fácil. Última actualización: 2026-06-11.

## ✅ Fase 0 — CERRADA (2026-06-11)

Setup del monorepo + schema acordado. Los 4 comandos contra Postgres en Docker corrieron **en verde**:

```bash
docker compose up -d   # Postgres 16 healthy, puerto host 5433 ✅
npm run db:migrate     # migraciones 0000 + 0001 aplicadas ✅
npm run db:seed        # tipos_movimiento: RECEPCION(+1), RINT(-1), AJUSTE(0) ✅
npm test               # backend: test de conexión a DB de test ✅ (1 passed)
```

### Qué quedó en Fase 0
- **Monorepo** npm workspaces: `backend/` + `frontend/` + `docker-compose.yml` + `docs/`.
- **docker-compose.yml**: Postgres 16, volumen persistente, puerto host **5433**, credenciales desde `.env`. Script `docker/initdb/01-create-test-db.sql` crea la DB de test en el primer arranque.
- **Backend**: TypeScript estricto (ESM/nodenext) + Express 5 + Drizzle. Config validada con Zod. `GET /api/health` que verifica DB (503 si cae). Capas completas: routes → controllers → services → repositories + domain/middleware/db/config.
- **Schema Drizzle** con las **8 tablas** de §8 (`ubicaciones`, `productos`, `tipos_movimiento`, `movimientos`, `movimientos_detalle`, `usuarios`, `lotes`, `proveedores`), nombres/tipos exactos, índices y check `chk_real_positiva`.
- **Migraciones aplicadas**: `0000` (8 tablas + índices + FKs + check) y `0001` (secuencias de correlativos, función `generar_nro`, matview `stock_actual` + unique index).
- **Frontend**: Vite + React 19 + TS + Tailwind v4 + Router + TanStack Query, estructura por features. `HealthPage` placeholder.
- **Tooling**: ESLint + typecheck en ambos paquetes; Vitest en backend; GitHub Actions (lint + typecheck + tests con service de Postgres).

### Cambio de diseño aplicado en el cierre (11/06)
- **Se descartó el flujo n8n y la tabla `sugeridos_dia`** (migración `0002` eliminada). Motivo: la app del compañero ya muestra el sugerido y depósito carga el real ahí; ese número final entra a nuestra app **por API REST** y se materializa como **RINT auto-confirmado**. Ver `ARCHITECTURE.md` §8/§15. Schema reverificado: `db:generate` → "No schema changes".

## 🔜 Fase 1 — Backend de movimientos (PRÓXIMA)

Branch nueva (`feat/movimientos-fase1-...`). Lo central:

1. **Endpoint de ingreso de abastecimiento** (`POST`): recibe de la app del compañero cabecera (área destino, fecha) + renglones (`producto_3c`, `cantidad_real`, `cantidad_sugerida`, unidad).
2. **Crear RINT + auto-confirmar transaccional**: estado CONFIRMADO + correlativo `RINT-2026-xxxxx` (`generar_nro`) + descuento de stock por `cantidad_real` + `REFRESH ... CONCURRENTLY` de `stock_actual`, todo en una transacción (reglas inviolables #2, #6, #7).
3. **Anulación por contramovimiento** (los confirmados son inmutables, regla #4).
4. **Tests primero** en lógica de stock y transiciones, incluyendo transaccionalidad y concurrencia (regla #5).
5. Validación con Zod, un schema compartido back/front (regla #8).

## 🧷 Recordatorios sueltos (cancha de J)
- **C: del equipo de J está al límite (~99% usado).** Conviene una limpieza a fondo del disco del sistema (Docker Desktop, descargas) cuando haya un rato; el cierre de Fase 0 necesitó liberar npm-cache+Temp para tener aire.
- Definir el **contrato fino del POST** con el compañero (campos exactos, auth, idempotencia si re-empuja el mismo abastecimiento).
- Falta poner `docs/demo-movimientos-internos.html` (referencia de UX para Fase 3).
- Cuando se sepa el **motor de DB del compañero**, anotarlo en §15 de `ARCHITECTURE.md` (no bloquea nada).
