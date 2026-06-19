# ARCHITECTURE.md — laceleste-movimientos

> Documento de arquitectura del módulo de Movimientos Internos de La Celeste. Consolida todas las decisiones de la sesión de planeamiento. Todo lo que figura acá está **cerrado y acordado con J** salvo lo marcado como pendiente en §15. Las reglas inviolables del día a día viven en `CLAUDE.md` (raíz del repo).

---

## 1. Contexto del negocio

**La Celeste** es una panadería/empresa de producción de alimentos en Argentina, con múltiples sucursales y áreas de producción: Panadería, Pastelería, Recetas, Sandwichería, Heladería.

**Sistemas existentes relevantes:**

- **App de producción** en `produccion.laceleste.com.ar` (propiedad del compañero de sistemas de J). Stack: React 19 + Vite + Tailwind + React Router v7 en frontend; Node.js + Express + REST + JWT en backend; DB propia (sin BaaS); VPS con Nginx. Módulos actuales: **Recepciones** y **Abastecimiento de Áreas** (conteo diario + cálculo de qué abastecer según proyección mín/med/máx/especial).
- **ERP 3c:** donde hoy se registran los movimientos internos (recepciones y remitos internos). Es la fuente de verdad contable actual.
- **Planilla de Google Sheets de abastecimiento:** la maneja J. De ahí sale el "cuánto abastecer" (el sugerido). La app del compañero ya la lee con un flujo propio.

## 2. El problema

El circuito actual duplica trabajo y tiene una brecha de control:

1. Depósito recibe mercadería → la carga en la app (Recepciones) **y** la transcribe en 3c.
2. Se cuenta stock de cada área con el colector → planilla de abastecimiento → la planilla calcula cuánto despachar.
3. Depósito despacha físicamente a las áreas.
4. Ese despacho (remito interno = **Rint**) se transcribe en 3c, generalmente después.
5. 3c da stock y abastecido → de ahí salen consumos por promedios.

**Problemas:**
- **Duplicación:** todo se carga dos veces (app + 3c).
- **Brecha de control:** depósito despacha sistemáticamente más de lo que indica la planilla. Como el Rint se transcribe DESPUÉS del despacho físico, 3c no controla: justifica a posteriori. (Análisis del histórico: varios miles de kg/unidades despachados por fuera de lo sugerido en 2 semanas.)
- **Stock desfasado:** el stock en 3c puede tener días de retraso.
- **Consumos sucios:** mientras los Rint no reflejen exactamente lo despachado, no se pueden recalcular targets con datos limpios.

**Objetivo:** llevar el registro de movimientos internos (recepciones + Rint a áreas) de 3c a una app propia, cerrando el ciclo de stock dentro de la app, respetando los mismos códigos y lógica para poder reconciliar con 3c.

## 3. EL INSIGHT CENTRAL

**El egreso desde depósito es la verdad. La cantidad sugerida es solo una referencia.**

Ejemplo del jamón: la planilla dice "abastecer 145 kg" (estimación). En depósito pesan una pieza real: 150 kg → despachan 150. Esos 150 kg son lo que realmente salió — el dato contable, el que mueve el stock. La diferencia de 5 kg no es un error ni un desvío sospechoso: es la realidad física de que el jamón viene en piezas.

**Consecuencias de diseño (no negociables):**
- Dos cantidades por renglón: `cantidad_sugerida` (referencia, opcional) y `cantidad_real` (la verdad, obligatoria).
- **El stock se descuenta SIEMPRE por `cantidad_real`.**
- La diferencia sugerido-vs-real se **registra, no se juzga**. J después decide qué es ruido (jamón, bultos cerrados) y qué es señal (desvío sistemático en fraccionables → investigar).
- Esto resuelve la brecha de control de raíz: al separar sugerido y real, el desvío se ve en vivo.

## 4. Estrategia: proyecto paralelo e independiente

Se construye un proyecto **independiente**: repo propio, DB propia, backend propio, frontend propio. Desarrollado 100% con Claude Code, sin depender del compañero ni de su agenda. No se rompe nada de la app de producción existente.

**Integración futura (NO ahora):** cuando madure (fases 1-3 + piloto andando), se integra con la app del compañero **vía API REST**, no compartiendo DB. La decisión monorepo-del-compañero vs microservicio se toma en ese momento, con el compañero en el loop.

**De dónde sale el dato (DECIDIDO 11/06/2026 — reemplaza al flujo n8n):** la app del compañero ya muestra el sugerido a abastecer y, en otra columna, depósito carga el **real** despachado. Esa app es la **fuente del número final** y nos lo empuja por **API REST**. La "independencia" es de repo/DB/backend/frontend y código (integración por API, nunca DB compartida), no de los datos: el ingreso del abastecimiento depende de que su app nos haga el POST.

```
App del compañero (muestra sugerido + depósito carga el REAL)
        └──→ POST /api/... (API REST) → backend de esta app
                └──→ crea RINT + AUTO-CONFIRMA (transaccional)

cantidad_real → descuenta stock (la verdad física)
cantidad_sugerida → viaja en el MISMO payload → diferencia registrada, no juzgada
```

**Servidores:** no se necesita ninguno para desarrollar — todo local (Postgres en Docker, backend y frontend en localhost). Staging/prod al final: probablemente un VPS propio barato para staging y el servidor del compañero para prod del piloto (con onboarding previo y aislamiento en contenedor).

## 5. La regla de oro: los IDs de 3c son la fuente de verdad

**Cerrada e inviolable. Grabada en `CLAUDE.md`.**

- La app NUNCA inventa códigos de productos ni de depósitos. Siempre usa los de 3c.
- `productos.codigo_3c` es la PK de productos (el "401" de harina 000, el "7" de bolsa de carro). Viene del maestro de 3c.
- Cada ubicación guarda su `dep_id_3c`. La app tiene su `id` interno por comodidad, pero el `dep_id_3c` viaja siempre al lado para reconciliar.
- Lo ÚNICO con numeración propia: `movimientos.nro` (`RINT-2026-00452`), a propósito, para no pisarse con 3c. Campo `nro_3c` nullable para mapear al sincronizar.

## 6. Alcance de v1

- **Rint** (abastecimiento a áreas) — el corazón.
- **Recepciones** (entrada de mercadería al depósito).
- **Ajustes** (correcciones de stock).
- **Dashboard y reportes** + export a Excel.

Roles v1: **ADMIN + DEPOSITO** solamente. Los conteos de área NO los hace esta app (viven en la app del compañero).

Filosofía: **puerta abierta para todo, habitación construida solo para el piloto.** El esquema deja lista la estructura para crecer (lotes, vencimientos, proveedores, conversión de unidades, multi-depósito), pero en v1 esas features no se implementan.

## 7. Decisiones de arquitectura (todas CERRADAS)

### Bloque 1 — Fundamentos
| Decisión | Valor |
|---|---|
| Repo | Monorepo nuevo: `backend/` + `frontend/` + `docker-compose.yml` + `docs/` + `CLAUDE.md` |
| DB | PostgreSQL 16, instancia nueva y separada, Docker local |
| Lenguaje | TypeScript en backend Y frontend (no negociable) |
| Runtime | Node.js 20+ LTS |
| Framework backend | Express 5 |
| Entornos | Local primero; staging/prod más adelante |
| Secrets | `.env` por entorno + `.env.example` versionado |
| Branching | `main` / `dev` / `feat/*` · conventional commits |

### Bloque 2 — Backend
| Decisión | Valor |
|---|---|
| ORM | Drizzle (migraciones explícitas, ve el SQL) |
| Arquitectura | Capas estrictas: routes → controllers → services → repositories |
| Migraciones | `drizzle-kit`, versionadas en Git |
| Validación | Zod (fuente única: tipo + validación) |

Estructura de carpetas: ver `CLAUDE.md`.

Se desarrolla en Postgres aunque el motor del compañero sea otro: (a) mejor para inventario (transacciones, materialized views, numéricos exactos), (b) proyecto independiente con su propia base, (c) la integración es por API REST, motor-agnóstica.

### Bloque 3 — Modelo de datos extensible
Concepto genérico de **ubicaciones** (renombre interno de depósito/área; el usuario sigue viendo "Depósito", "Panadería"). Es lo que hace que multi-depósito y multi-sucursal salgan gratis.

Puertas abiertas confirmadas (estructura lista, lógica después):
- **Tipos de movimiento extensibles** → catálogo `tipos_movimiento` con `signo_stock`. Sumar DEVOLUCION/TRANSFERENCIA = insertar fila, cero migración. (Se construye bien de entrada, es casi gratis.)
- **Lotes y vencimientos** → `movimientos_detalle.lote_id` nullable → tabla `lotes`. En v1 siempre null.
- **Conversión de unidades** → `productos.presentacion` JSONB estructurado. En v1 se muestra pero se carga en unidad base.
- **Proveedores** → tabla `proveedores`, `movimientos.proveedor_id` nullable.
- **Multi-depósito** → gratis: stock indexado por `(producto, ubicacion)` desde el día uno.

NO se modela en v1: productos compuestos / recetas / BOM.

### Bloque 4 — Auth y permisos
| Decisión | Valor |
|---|---|
| Roles v1 | ADMIN + DEPOSITO |
| Login | Propio, usuarios y roles, JWT |
| Conteos de área | NO en esta app |
| Auditoría | Quién creó y quién confirmó, con timestamp |
| Inmutabilidad | Confirmado = inmutable en cantidad/producto. Anulación v1 = **flip de estado** CONFIRMADO→ANULADO + sellos (no contramovimiento — ver §8/§9, decisión 2026-06-19) |

Roles (modelo de 4 documentado; v1 usa los dos primeros):
- **ADMIN** (J, sistemas): todo — usuarios, anular, configurar productos/ubicaciones, reportes.
- **DEPOSITO**: crear y confirmar movimientos, ver stock y sus movimientos. No anula viejos ni toca config.
- *(Futuro)* AREA: ver lo suyo, cargar conteos. *(Futuro)* COMPRAS/GERENCIA: solo lectura, dashboard, exports.

### Bloque 5 — Frontend
| Decisión | Valor |
|---|---|
| Componentes | Por feature, no por tipo |
| Datos del servidor | TanStack Query |
| Estado de UI | React Context + hooks |
| Formularios | React Hook Form + Zod (schema compartido con backend) |

El formulario más complejo es el modal de carga de movimientos (grilla editable: producto, stock contado, sugerido, real editable). Referencia visual del UX: `docs/demo-movimientos-internos.html`.

### Bloque 6 — Testing y CI/CD
| Nivel | Herramienta | Alcance |
|---|---|---|
| Unit | Vitest | Lógica de negocio: confirmar movimiento, calcular stock, transiciones. Acá va el esfuerzo. |
| Integración | Vitest + DB de test | Endpoints: que POST + confirmar realmente descuente stock |
| E2E | Playwright (mínimo) | Login, cargar movimiento, verlo aparecer |
| CI | GitHub Actions | En cada push a `feat/*` y `dev`: lint + typecheck + tests. Deploy manual. |

### Bloque 7 — Convivencia con 3c
- 3c sigue siendo la verdad contable durante el piloto y un tiempo después. La app es la verdad operativa.
- **Doble carga temporal** durante el piloto (app Y 3c), a propósito — red de seguridad.
- **Reconciliación diaria** app vs 3c. El puente: códigos 3c + dep_id.
- **Apagado gradual:** primero Panadería deja de cargarse en 3c, después las demás. 3c puede quedar para inventario valorizado indefinidamente (decisión del compañero, más adelante).

### Bloque 8 — Plan del piloto
- **Alcance:** solo Panadería. **Duración:** 2 semanas en paralelo con 3c.
- **Se mide:** (1) ningún egreso perdido, (2) stock de la app cuadra con 3c (margen razonable, contemplando jamón/piezas), (3) la carga es igual o más rápida, (4) aparecen desvíos sugerido-vs-real interesantes.
- **Go/no-go:** cuadra y nada perdido → escalar a las otras 4 áreas. No cuadra → investigar antes de seguir.
- **Quién opera:** la gente de depósito de siempre. Cambia la herramienta, no la gente.

## 8. Modelo de datos (DDL de referencia)

> Base para el schema Drizzle. Mantener nombres y tipos. Tipos de movimiento como catálogo, no enum fijo.

**Tablas v1:** `ubicaciones`, `productos`, `tipos_movimiento`, `movimientos`, `movimientos_detalle`, `stock_actual` (matview), `usuarios`.
**Puerta abierta (vacías en v1):** `lotes`, `proveedores`.

### ubicaciones
```sql
CREATE TABLE ubicaciones (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  tipo        VARCHAR(16) NOT NULL,        -- 'DEPOSITO' | 'AREA' | 'SUCURSAL'
  dep_id_3c   INTEGER NOT NULL,            -- EL PUENTE CON 3C
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);
```

### tipos_movimiento (catálogo extensible)
```sql
CREATE TABLE tipos_movimiento (
  id           SERIAL PRIMARY KEY,
  codigo       VARCHAR(16) UNIQUE NOT NULL, -- 'RECEPCION' | 'RINT' | 'AJUSTE' | (futuros)
  nombre       VARCHAR(100) NOT NULL,
  signo_stock  SMALLINT NOT NULL            -- +1 suma, -1 resta, 0 según renglón
);
-- seed: RECEPCION(+1), RINT(-1), AJUSTE(0 — el signo va en cantidad_real)
```

### productos
```sql
CREATE TABLE productos (
  codigo_3c     VARCHAR(32) PRIMARY KEY,    -- CÓDIGO DE 3C, NO INVENTAR
  nombre        VARCHAR(200) NOT NULL,
  unidad_base   VARCHAR(16) NOT NULL,       -- 'KG' | 'UN' | 'LT'
  presentacion  JSONB,                      -- {"bulto":"bolsa","equivale":25,"unidad":"KG"}
  activo        BOOLEAN NOT NULL DEFAULT TRUE
);
```

### movimientos (cabecera)
```sql
CREATE TABLE movimientos (
  id              BIGSERIAL PRIMARY KEY,
  nro             VARCHAR(32) UNIQUE NOT NULL,   -- 'RINT-2026-00452' (propio)
  tipo_id         INTEGER NOT NULL REFERENCES tipos_movimiento(id),
  fecha           DATE NOT NULL,
  hora            TIME NOT NULL,
  turno           VARCHAR(16),                   -- 'MAÑANA' | 'TARDE' | NULL
  origen_id       INTEGER NOT NULL REFERENCES ubicaciones(id),
  destino_id      INTEGER NOT NULL REFERENCES ubicaciones(id),
  estado          VARCHAR(16) NOT NULL DEFAULT 'BORRADOR', -- 'BORRADOR'|'CONFIRMADO'|'ANULADO'
  proyeccion      VARCHAR(16),                   -- 'MIN'|'MED'|'MAX'|'ESP' (solo Rint)
  proveedor_id    INTEGER REFERENCES proveedores(id), -- nullable, puerta abierta
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
  nro_3c          VARCHAR(64),                   -- nullable, sync con 3c
  observaciones   TEXT,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_en   TIMESTAMPTZ,
  anulado_en      TIMESTAMPTZ,
  anulado_por     INTEGER REFERENCES usuarios(id)
);
CREATE INDEX idx_mov_fecha ON movimientos(fecha DESC);
CREATE INDEX idx_mov_estado ON movimientos(estado);
CREATE INDEX idx_mov_destino_fecha ON movimientos(destino_id, fecha DESC);
```

### movimientos_detalle
```sql
CREATE TABLE movimientos_detalle (
  id                 BIGSERIAL PRIMARY KEY,
  movimiento_id      BIGINT NOT NULL REFERENCES movimientos(id) ON DELETE RESTRICT,
  producto_3c        VARCHAR(32) NOT NULL REFERENCES productos(codigo_3c),
  cantidad_real      NUMERIC(12,3) NOT NULL,     -- LA VERDAD. Mueve el stock. Obligatorio.
  cantidad_sugerida  NUMERIC(12,3),              -- referencia, nullable (solo Rint)
  stock_contado      NUMERIC(12,3),              -- nullable (solo Rint)
  unidad             VARCHAR(16) NOT NULL,
  lote_id            BIGINT REFERENCES lotes(id), -- nullable, puerta abierta
  observaciones      TEXT,
  CONSTRAINT chk_real_positiva CHECK (cantidad_real >= 0)
);
CREATE INDEX idx_det_mov ON movimientos_detalle(movimiento_id);
CREATE INDEX idx_det_producto ON movimientos_detalle(producto_3c);
```

### stock_actual (vista materializada — refresh on confirm)
```sql
CREATE MATERIALIZED VIEW stock_actual AS
SELECT
  d.producto_3c,
  CASE WHEN tm.codigo = 'RINT' THEN m.origen_id ELSE m.destino_id END AS ubicacion_id,
  SUM(d.cantidad_real * tm.signo_stock) AS cantidad,
  MAX(m.confirmado_en) AS actualizado_en
FROM movimientos m
JOIN tipos_movimiento tm ON tm.id = m.tipo_id
JOIN movimientos_detalle d ON d.movimiento_id = m.id
WHERE m.estado = 'CONFIRMADO'
GROUP BY d.producto_3c, ubicacion_id;
CREATE UNIQUE INDEX idx_stock_prod_ubic ON stock_actual(producto_3c, ubicacion_id);
```
Refresh: dentro de la transacción de confirmación, `REFRESH MATERIALIZED VIEW CONCURRENTLY stock_actual`. Si crece y se vuelve lento, reemplazar por tabla con triggers o snapshots mensuales. **El refresh va precedido de `pg_advisory_xact_lock` (xact-level): serializa el par refresh+commit entre transacciones simultáneas; sin él, dos confirmaciones concurrentes pueden refrescar con snapshots que no ven el commit de la otra y la matview queda sin uno de los movimientos (regla #5/#6).**

**Anulación = flip de estado (decisión 2026-06-19).** Como `stock_actual` filtra `WHERE estado = 'CONFIRMADO'`, marcar el original `ANULADO` (+ sellos `anulado_por`/`anulado_en`) y refrescar la matview ya **revierte el stock** en una sola tx. Un contramovimiento físico *además* del flip **duplicaría la reversión**, así que las dos mecánicas se excluyen y v1 usa SOLO el flip. La inmutabilidad de la regla #4 se preserva en su intención: nunca se editan cantidad/producto del confirmado, solo se voltea el estado y se sellan los campos de auditoría que el schema ya tiene para eso (regla #7). El lock `FOR UPDATE` sobre la fila serializa dos anulaciones simultáneas.

### usuarios, lotes, proveedores
```sql
CREATE TABLE usuarios (
  id        SERIAL PRIMARY KEY,
  nombre    VARCHAR(100) NOT NULL,
  email     VARCHAR(150) UNIQUE NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  rol       VARCHAR(16) NOT NULL,   -- 'ADMIN' | 'DEPOSITO' (v1)
  activo    BOOLEAN NOT NULL DEFAULT TRUE
);

-- Puerta abierta (vacías en v1):
CREATE TABLE lotes (
  id           BIGSERIAL PRIMARY KEY,
  producto_3c  VARCHAR(32) NOT NULL REFERENCES productos(codigo_3c),
  codigo_lote  VARCHAR(64),
  vencimiento  DATE
);
CREATE TABLE proveedores (
  id      SERIAL PRIMARY KEY,
  nombre  VARCHAR(150) NOT NULL,
  cuit    VARCHAR(20)
);
```

### Correlativos
Secuencia por tipo y año (`seq_rint_2026`, `seq_rec_2026`, `seq_aju_2026`) + función `generar_nro(tipo, anio)` que arma `RINT-2026-00452`, `REC-2026-00118`, etc.

### Ingreso del abastecimiento (API REST — reemplaza al flujo n8n)
El abastecimiento llega desde la app del compañero por **API REST**: un POST con cabecera (área destino, fecha) + renglones (`producto_3c`, `cantidad_real`, `cantidad_sugerida`, unidad). El backend lo materializa como un movimiento **RINT** y lo **auto-confirma** en transacción (cambio de estado + correlativo + descuento de stock por `cantidad_real` + refresh de `stock_actual`). **No existe tabla de aterrizaje `sugeridos_dia`** (descartada 11/06/2026): el sugerido viaja embebido en el mismo payload y queda como referencia en `movimientos_detalle.cantidad_sugerida`. La app jamás habla con Google Sheets.

## 9. Endpoints REST

Patrón `/api/...`, JWT en header `Authorization: Bearer`. **Protección (Fase 1):** lecturas de movimientos/stock e **historial** requieren login (cualquier rol); **editar** (`PUT /movimientos/:id`) lo puede hacer cualquier rol logueado (queda en el historial); `anular` requiere rol **ADMIN** (DEPOSITO no anula); `login` es público; `abastecimientos` es M2M (abierto por ahora). El middleware `requireAuth`/`requireRole` cuelga `req.user` desde el token.

| Método | Path | Descripción |
|---|---|---|
| POST | `/api/auth/login` | **Login: valida credenciales (bcrypt) y devuelve `{token, user}`. Público. Implementado en Fase 1.** |
| GET | `/api/auth/me` | **Identidad del token. Requiere Bearer. Implementado en Fase 1.** |
| POST | `/api/abastecimientos` | **Ingreso desde la app del compañero: crea RINT y lo AUTO-CONFIRMA (transaccional). Implementado en Fase 1. M2M: abierto (auth de máquina por API key, pendiente).** |
| POST | `/api/movimientos` | Crear movimiento en BORRADOR |
| GET | `/api/movimientos` | **Listar con filtros: `desde`, `hasta`, `tipo`, `ubicacion`, `estado` + paginado (`page`/`limit`). Devuelve `{items, page, limit, total}`. `ubicacion` matchea origen O destino. Implementado en Fase 1.** |
| GET | `/api/movimientos/:id` | **Detalle (cabecera + renglones). 404 si no existe. Implementado en Fase 1.** |
| PUT | `/api/movimientos/:id` | **Editar (reemplazo completo, cualquier rol logueado). Recalcula stock + deja historial. 409 si ANULADO. Implementado en Fase 1.** |
| GET | `/api/movimientos/:id/historial` | **Ediciones del movimiento (auditoría). Requiere login. Implementado en Fase 1.** |
| PUT | `/api/movimientos/:id/confirmar` | BORRADOR → CONFIRMADO. Asigna nro, descuenta stock. **Transaccional.** |
| PUT | `/api/movimientos/:id/anular` | CONFIRMADO → ANULADO. **Flip de estado + sellos (anulado_por/anulado_en), transaccional. Implementado en Fase 1.** No genera contramovimiento. |
| GET | `/api/movimientos/export` | Export Excel (mismos filtros que el listado) |
| GET | `/api/stock` | Stock actual. Params: `ubicacion_id`, `producto_3c` |
| GET | `/api/stock/:producto_3c/kardex` | Kardex: movimientos con saldo running |
| PUT | `/api/movimientos/:id/sincronizar-3c` | Marca `nro_3c` cuando se replicó en 3c |

**Payload ejemplo (crear Rint):**
```json
POST /api/movimientos
{
  "tipo": "RINT",
  "origen_id": 1,
  "destino_id": 47,
  "turno": "TARDE",
  "proyeccion": "MED",
  "detalle": [
    { "producto_3c": "401", "stock_contado": 35, "cantidad_sugerida": 145, "cantidad_real": 150, "unidad": "KG" }
  ]
}
```
(El stock se descuenta por `cantidad_real` = 150, no por sugerida = 145.)

## 10. Plan de implementación por fases

| Fase | Qué | Duración | Entregable |
|---|---|---|---|
| **0** | Diseño técnico: cerrar nombres de tablas/campos, formato de correlativos, tabla de aterrizaje del sugerido | 1-2 días | Setup del repo + schema acordado |
| **1** | Backend de movimientos: migración Drizzle, endpoints, middleware auth, tests (creación, confirmación transaccional, anulación, concurrencia) | 3-5 días | Postman/Insomnia donde se crea/confirma/anula con stock recalculando bien |
| **2** | Recepciones en el modelo nuevo (persisten en `movimientos` tipo RECEPCION) | 2-3 días | Recepciones alimentando la tabla. Stock del depósito ya se calcula. |
| **3** | Modal "Confirmar abastecimiento" en Panadería: grilla editable (contado/sugerido/real), POST + confirmar, genera Rint | 3-4 días | Panadería genera Rint desde la app, con descuento de stock en vivo |
| **4** | Piloto Panadería 2 semanas (paralelo con 3c) | 2 semanas | Validación go/no-go |
| **5** | Rollout 4 áreas restantes + pantalla Stock Depósito + pantalla Movimientos + export Excel + dashboard | 5-7 días | Módulo completo en producción |

**Total realista: 3-4 semanas part-time** (~2 semanas full-time).

## 11. Workflow con Claude Code

Una sesión por fase, una branch por feature:
1. Crear branch (`feat/movimientos-fase1-backend`).
2. Pasar a Claude Code este documento + la sección de la fase.
3. "Implementá la Fase X. Tests primero. Respetá las capas y la regla de los IDs."
4. Revisar diff, ajustar, mergear.

Reglas: una fase / un PR / una revisión; no avanzar sin tests en verde; forzar lectura del código existente antes de proponer estructura; los tests cubren transacción y concurrencia.

## 12-14. Reglas inviolables, stack y activos

- Reglas inviolables: en `CLAUDE.md` (raíz).
- Stack: en `CLAUDE.md`.
- Activos: `docs/demo-movimientos-internos.html` (referencia visual del UX objetivo: dashboard, modal de confirmación con desvío sugerido-vs-real, stock, listado).

## 15. Decisiones (RESUELTAS 10/06/2026)

1. **Nombre del proyecto:** `laceleste-movimientos`. ✅
2. **Cómo entra el abastecimiento:** la **app del compañero empuja por API REST** (POST) el sugerido+real ya cargado por depósito; el backend lo crea como RINT y lo auto-confirma. Sin n8n, sin tabla `sugeridos_dia`. (Reemplaza la decisión original del 10/06.) ✅ (11/06/2026)
3. **Motor de DB del compañero:** ⏳ pendiente de averiguar. No bloquea nada (integración por API REST). Anotar acá cuando se sepa: `____`.
