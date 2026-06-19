# PROGRESO — laceleste-movimientos

> Estado para retomar fácil. Última actualización: 2026-06-19.

## ⏱️ AL VOLVER (mañana) — empezá por acá
1. **Increments 1-6 + auth + git estructural, commiteados y pusheados** en `feat/movimientos-fase1-backend` (44 tests verdes).
2. **🔴 ACCIÓN MANUAL TUYA — cambiar default branch a `main` en GitHub**: ya creé y pusheé `main` (desde el scaffold de Fase 0) y `dev` (desde main), pero `gh`/token no están, así que la default del remoto sigue siendo `feat/movimientos-fase0-setup`. Settings → Branches (o General) → Default branch → `main`. Después podés borrar `feat/movimientos-fase0-setup`.
3. **Abrir el PR de Fase 1 → `dev`**: base `dev` ← `feat/movimientos-fase1-backend`. Link: https://github.com/fecheverria-design/laceleste-stocks/compare/dev...feat/movimientos-fase1-backend
4. **Próximo slice — a elegir**: **idempotencia del POST** (necesita acordar contrato con el compañero) · export Excel / kardex / sincronizar-3c · API key para `abastecimientos` (M2M) · pulir el front (validación de form, crear movimiento desde el front).
5. **Contrato del POST**: validar supuestos con el compañero (ver "Supuestos del contrato del POST"), sobre todo **idempotencia** (hoy un re-push duplica).
6. Docker corre desde `D:\DockerData`; levantar Docker Desktop si está apagado y `docker compose up -d`. **Datos de demo**: `npm -w backend run db:seed:dev` carga 3 ubicaciones, 4 productos, 5 movimientos (2 recepciones + 2 RINT + 1 anulado) **+ usuarios de login** (`admin@laceleste.local` / `deposito@laceleste.local`, pass `laceleste123`) — idempotente. Para ver el front: backend `npm -w backend run dev` (3000) + frontend `npm -w frontend run dev` (5173) → http://localhost:5173.

## 🖥️ Front — edición de movimientos (HECHO)
Adelanto de Fase 3 (UI). En branch `feat/movimientos-fase1-backend`.
- **Página de detalle/edición** (`/movimientos/:id`): form prefilleado, **todo editable** (tipo/origen/destino con selects de catálogo, fecha, turno, observaciones, renglones dinámicos con agregar/quitar), botón Guardar → `PUT`. Invalida queries (detalle, listado, stock, historial) al guardar. Si el movimiento está ANULADO, el form se deshabilita.
- **Historial de ediciones** visible abajo (quién/cuándo/qué cambió).
- **Endpoints de catálogo** (back): `GET /api/ubicaciones`, `/api/productos`, `/api/tipos` (requireAuth) para poblar los selects. `GET /:id` enriquecido para round-trip (tipo, dep_id_3c, turno, etc.).
- Las filas del listado son clickeables → llevan al detalle.
- **Verificado e2e** (Edge headless por CDP, login real por formulario): la página renderiza con datos vivos, catálogos poblados, y **F5 mantiene la sesión** (sin bug de deslogueo). 44 tests back verdes, front typecheck/lint/build ok.

## 🖥️ Front — preview read-only (HECHO, fuera de fase)
Adelanto para "ver algo" (el front formal es Fase 3). En branch `feat/movimientos-fase1-backend`.
- **Layout con nav** (Movimientos / Stock / Estado) + **`MovimientosPage`** (tabla con filtro por estado, consume `GET /api/movimientos`) + **`StockPage`** (consume `GET /api/stock`). TanStack Query, Tailwind v4.
- **API mejorada (additivo)**: el listado ahora devuelve `origen_nombre`/`destino_nombre` y el stock `producto_nombre`/`ubicacion_nombre` (joins en el back) para no hacer joins en el front. Tests siguen verdes (26).
- **Verificado end-to-end**: ambos servers levantados, proxy `/api` ok, screenshots de las dos páginas con datos reales.
- **Tipos en `shared/api/types.ts`**: réplica de los DTOs. Pendiente real de regla #8: paquete compartido de schemas Zod back/front (hoy duplicados).

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

### ✅ Increment 3 — Listado + detalle (HECHO, 7 tests nuevos = 26 verdes)
- **`GET /api/movimientos`**: listado con filtros `desde`/`hasta` (rango de fecha inclusive), `tipo` (codigo del catálogo, string libre — extensible), `estado` (set fijo), `ubicacion` (matchea origen O destino) + paginado `page`/`limit` (default 1/50, máx 200). Devuelve `{items, page, limit, total}`; orden recientes primero (fecha desc, id desempata).
- **`GET /api/movimientos/:id`**: detalle (cabecera + renglones); 404 `MOVIMIENTO_NO_ENCONTRADO` si no existe.
- **Schema en `domain/movimientos.schema.ts`** (`MovimientosQuerySchema`, regla #8): el front reusa los filtros. Valida `desde <= hasta`.
- **Tests**: orden y total, filtro por estado, por ubicación (origen/destino), por rango de fechas, por tipo, paginado (total = del filtro completo), detalle + inexistente.
- **🐛 Fix de concurrencia (latente desde inc. 1)**: dos confirmaciones simultáneas podían dejar la matview sin uno de los movimientos (REFRESH con snapshots que no veían el commit ajeno). Solución: `pg_advisory_xact_lock` antes del `REFRESH` en `refrescarStock` (serializa refresh+commit). El test de concurrencia de abastecimientos dejó de ser flaky (3/3 estable). Blinda también la anulación.

### ✅ Increment 5 — Auth JWT (HECHO, 11 tests nuevos = 37 verdes)
- **JWT propio** (Bearer + localStorage). `POST /api/auth/login` (bcrypt + token firmado, expira en 8h) y `GET /api/auth/me`. Secreto en `JWT_SECRET` (.env + CI). Roles v1: ADMIN, DEPOSITO (+ SISTEMA = integración M2M).
- **Middleware** `requireAuth` (cuelga `req.user`) + `requireRole`. Protección: lecturas movimientos/stock = cualquier login; **anular = solo ADMIN** (audita al usuario del token, no al de integración); login público; `abastecimientos` M2M abierto (API key pendiente).
- **Front**: `LoginPage`, `AuthProvider` + `useAuth`, guarda `RequireAuth`, Bearer automático en el cliente HTTP + manejo de 401 (cierra sesión), header con usuario/rol + botón Salir.
- **Tests**: login OK/credenciales inválidas/usuario inactivo, firma+verificación de token, `requireAuth` (sin header / token malo / OK), `requireRole` (permite/deniega 403). Verificado end-to-end por HTTP: 401 sin token, 200 con token, 403 DEPOSITO→anular.
- **Usuarios dev** en `db:seed:dev` (admin/deposito, pass `laceleste123`).

### ✅ Increment 6 — Editar movimiento con historial (HECHO, 7 tests nuevos = 44 verdes)
- **Regla #4 relajada (decisión de J 2026-06-19)**: auditabilidad sobre inmutabilidad. Los movimientos **se editan** (cualquier usuario logueado, sin restricción de rol), pero **toda edición deja historial**. Anular sigue siendo solo-ADMIN y de vez en cuando.
- **`PUT /api/movimientos/:id`**: reemplazo completo (todo editable, incluido tipo/origen/destino). Transaccional (regla #6): valida refs → actualiza cabecera + renglones → registra diff en `movimientos_auditoria` → recalcula stock. 409 si el movimiento está ANULADO.
- **`GET /api/movimientos/:id/historial`**: lista las ediciones (quién/cuándo/qué cambió, valor antes/después).
- **Tabla nueva** `movimientos_auditoria` (migración `0002`): una fila por edición, `cambios` JSONB con el diff. Aplicada en dev; `globalSetup` la aplica en test.
- **Tests**: editar cantidad recalcula stock + historial, cambio de producto mueve stock, edición descriptiva no toca stock, edición sin cambios no genera historial, 404 inexistente, 409 anulado, rollback transaccional. Verificado e2e por HTTP (1350→1380 + historial con diff).

### ✅ Estructura git (HECHO)
- Creadas y pusheadas `main` (desde scaffold Fase 0 = baseline desplegable) y `dev` (desde main). Falta el paso manual: setear `main` como default branch en GitHub (no hay `gh`/token). Las fases mergean por PR a `dev`; `dev`→`main` al liberar.

### ⏳ Pendiente en Fase 1 (próximos increments)
- **POST /api/movimientos** (crear BORRADOR) + **PUT /:id/confirmar**, export Excel, kardex, sincronizar-3c.
- **Idempotencia** del POST de abastecimientos + **API key** para asegurar ese endpoint M2M.
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
