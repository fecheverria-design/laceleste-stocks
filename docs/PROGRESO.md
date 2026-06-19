# PROGRESO — laceleste-movimientos

> Estado para retomar fácil. Última actualización: 2026-06-19.

## ⏱️ AL VOLVER (mañana) — empezá por acá
1. **Increments 1 y 2 commiteados y pusheados** en `feat/movimientos-fase1-backend` (19 tests verdes). Falta **abrir el PR** (link que GitHub ya ofreció al pushear).
2. **Próximo slice — a elegir**: `GET /api/movimientos` (listado+filtros+paginado, slice limpio sin decisiones abiertas) · **Auth JWT** + middleware · **idempotencia del POST** (necesita acordar contrato con el compañero).
3. **Contrato del POST**: validar supuestos con el compañero (ver "Supuestos del contrato del POST"), sobre todo **idempotencia** (hoy un re-push duplica).
4. Docker corre desde `D:\DockerData`; levantar Docker Desktop si está apagado y `docker compose up -d`. La DB de dev tiene 1 abastecimiento de prueba (RINT-2026-00001) cargado en el smoke.

---

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

## 🚧 Fase 1 — Backend de movimientos (EN CURSO)

Branch `feat/movimientos-fase1-backend`.

### ✅ Increment 1 — Ingreso de abastecimiento (HECHO, 13 tests verdes)
- **`POST /api/abastecimientos`**: recibe el abastecimiento de la app del compañero → crea **RINT** → **auto-confirma transaccional** (regla #6): correlativo `RINT-2026-xxxxx` (`generar_nro`) + cabecera CONFIRMADO + detalle + `REFRESH CONCURRENTLY stock_actual`, todo en una tx. Si algo falla → rollback total.
- **Descuento por `cantidad_real`** del depósito origen (regla #2); `cantidad_sugerida`/`stock_contado` quedan como referencia.
- **`GET /api/stock`**: stock actual (matview), filtrable por `ubicacion_id`/`producto_3c`.
- **Validación Zod** (`domain/movimientos.schema.ts`, regla #8) — pensado para compartir con el front.
- **Capas respetadas**: routes → controller → service (dueño de la tx) → repository.
- **Tests (regla #5)**: stock correcto, real-no-sugerida, rollback de validación, transaccionalidad (rollback tras insertar cabecera), **concurrencia** (2 ingresos simultáneos → nros distintos, stock = suma). Infra: `tests/globalSetup.ts` migra la DB de test; `tests/helpers/db.ts` limpia+siembra.
- **Verificado por HTTP** además de los tests: POST→201 (RINT-2026-00001), inválido→400, área inexistente→404, stock recalculado.
- **Verificado técnico**: `REFRESH MATERIALIZED VIEW CONCURRENTLY` SÍ corre dentro de la tx en PG16 (regla #6 viable tal cual).

### ✅ Increment 2 — Anulación (HECHO, 6 tests nuevos = 19 verdes)
- **`PUT /api/movimientos/:id/anular`**: CONFIRMADO → ANULADO transaccional. **DECISIÓN 2026-06-19: flip de estado, NO contramovimiento** (J eligió). Como `stock_actual` filtra `estado='CONFIRMADO'`, voltear el original + `REFRESH` ya revierte el stock; un contramovimiento duplicaría la reversión. Sella `anulado_por`/`anulado_en` (regla #7). Doc actualizada: `CLAUDE.md` regla #4, `ARCHITECTURE.md` §8 (justificación) y §9 (endpoint).
- **Guards**: inexistente → 404 `MOVIMIENTO_NO_ENCONTRADO`; ya anulado → 409 `YA_ANULADO`; estado ≠ CONFIRMADO → 409 `ESTADO_INVALIDO`. Lock `FOR UPDATE` serializa anulaciones simultáneas.
- **Tests**: revierte stock + sella auditoría, doble anulación, inexistente, reversión puntual (no toca otros movimientos), transaccionalidad (rollback deja CONFIRMADO), concurrencia (2 anular del mismo mov → una gana, otra YA_ANULADO, stock revierte 1 sola vez).

### ⏳ Pendiente en Fase 1 (próximos increments)
- **Auth JWT** + middleware (hoy ingreso y anulación se auditan al usuario de integración `integracion@laceleste.local`, creado por el seed).
- **GET /api/movimientos** (listado con filtros + paginado), **GET /api/movimientos/:id**, export Excel, kardex, sincronizar-3c.

### ❓ Supuestos del contrato del POST — VALIDAR con el compañero
1. **Área destino** identificada por su `dep_id_3c` de 3c (campo `destino_dep_id_3c`).
2. **Depósito origen**: `origen_dep_id_3c` opcional; si falta usa `DEPOSITO_PRINCIPAL_DEP_ID_3C` (.env). v1 = un solo depósito.
3. **Renglón**: `producto_3c`, `cantidad_real` (oblig.), `cantidad_sugerida`/`stock_contado` (opc.), `unidad`.
4. **Idempotencia**: NO implementada. Si la app del compañero re-empuja el mismo abastecimiento, se duplica. Falta acordar un id externo único para deduplicar (recomendado: que su app mande su propio id y lo guardemos para rechazar duplicados).

## 🧷 Recordatorios sueltos (cancha de J)
- **C: del equipo de J está al límite (~99% usado).** Conviene una limpieza a fondo del disco del sistema (Docker Desktop, descargas) cuando haya un rato; el cierre de Fase 0 necesitó liberar npm-cache+Temp para tener aire.
- Definir el **contrato fino del POST** con el compañero (campos exactos, auth, idempotencia si re-empuja el mismo abastecimiento).
- Falta poner `docs/demo-movimientos-internos.html` (referencia de UX para Fase 3).
- Cuando se sepa el **motor de DB del compañero**, anotarlo en §15 de `ARCHITECTURE.md` (no bloquea nada).
