# CLAUDE.md — laceleste-movimientos

Módulo de **Movimientos Internos** de La Celeste (panadería/producción de alimentos, Argentina). Registra recepciones de mercadería, remitos internos a áreas (Rint) y ajustes de stock, reemplazando gradualmente la carga en el ERP 3c. Proyecto independiente: repo propio, DB propia, backend propio, frontend propio. La integración futura con la app de producción existente será **vía API REST**, nunca compartiendo base de datos.

Contexto completo en `docs/ARCHITECTURE.md`. **Leelo antes de proponer estructura o tocar el modelo de datos.**

## Stack

```
Backend:   Node 20 LTS · Express 5 · TypeScript estricto · Drizzle ORM · Zod · PostgreSQL 16
Frontend:  React 19 · Vite · Tailwind · TypeScript · TanStack Query · React Hook Form · Zod · React Router
Infra:     Docker (Postgres local) · monorepo · GitHub Actions
Testing:   Vitest (unit + integración) · Playwright (E2E mínimo)
Auth:      JWT propio (Bearer + localStorage) · roles v1: ADMIN, DEPOSITO
Ingreso:   la app del compañero manda sugerido+real por API REST (POST) → se materializa como RINT auto-confirmado (sin n8n)
```

## Estructura del repo

```
backend/src/
├── routes/          → definen endpoints
├── controllers/     → reciben request, validan, llaman al service
├── services/        → lógica de negocio (confirmar movimiento descuenta stock)
├── repositories/    → hablan con la DB (queries)
├── domain/          → tipos, schemas Zod, errores tipados
├── middleware/      → auth, error handling, logging
├── db/              → schema Drizzle, conexión, migraciones
├── config/          → carga y valida .env con Zod
└── app.ts

frontend/src/
├── features/        → movimientos/ stock/ recepciones/ reportes/
├── shared/          → components/ api/ auth/
├── App.tsx
└── main.tsx
```

## REGLAS INVIOLABLES

Estas reglas no se negocian. Si una tarea las contradice, frenar y avisar.

1. **IDs de 3c = fuente de verdad.** Nunca inventar códigos de productos ni de depósitos. `productos.codigo_3c` y `ubicaciones.dep_id_3c` vienen del ERP 3c. Lo único con numeración propia es `movimientos.nro` (formato `RINT-2026-00452`), a propósito, con campo `nro_3c` nullable para mapear al sincronizar.
2. **El stock se descuenta SIEMPRE por `cantidad_real`, nunca por `cantidad_sugerida`.** El egreso físico es la verdad; el sugerido es solo referencia. La diferencia se registra, no se juzga.
3. **Las capas solo hablan hacia abajo.** routes → controllers → services → repositories. Nunca al revés. Un repository nunca llama a un service.
4. **Los movimientos CONFIRMADOS son inmutables** en cantidad/producto: nunca se edita el detalle del original. La **anulación v1 es flip de estado** (CONFIRMADO→ANULADO + sellos `anulado_por`/`anulado_en`, transaccional), NO contramovimiento — porque `stock_actual` filtra por estado y un contramovimiento duplicaría la reversión (decisión 2026-06-19, ver `ARCHITECTURE.md` §8/§9).
5. **La lógica de stock y las transiciones de estado SIEMPRE van con test.** Sin excepción. Incluye transaccionalidad y concurrencia, no solo happy path.
6. **El endpoint `confirmar` es transaccional.** Cambio de estado + asignación de correlativo + refresh de stock, todo en una transacción de DB.
7. **Todo movimiento registra auditoría:** `usuario_id`, `creado_en`, `confirmado_en`. Toda anulación registra `anulado_por` y `anulado_en`.
8. **Validación con Zod, un solo schema** compartido entre backend y frontend.
9. **TypeScript estricto.** Nada de `any` sin justificación escrita en comentario.
10. **Conventional commits:** `feat:`, `fix:`, `refactor:`, `test:`, `chore:`.

## Modelo de datos — notas clave

- Concepto genérico de **`ubicaciones`** (DEPOSITO | AREA | SUCURSAL). El multi-depósito sale gratis: el stock se indexa por `(producto_3c, ubicacion_id)` desde el día uno.
- **`tipos_movimiento` es tabla catálogo** con `signo_stock` (RECEPCION +1, RINT −1, AJUSTE 0 con signo en el renglón). Tipos nuevos = insertar fila, cero migración.
- Puertas abiertas (estructura lista, lógica NO implementada en v1): `lotes`, `proveedores`, `presentacion` JSONB para conversión de unidades. **No implementar su lógica salvo pedido explícito.**
- NO modelar recetas/BOM/productos compuestos. Fuera de alcance.
- `stock_actual` es vista materializada con `REFRESH ... CONCURRENTLY` dentro de la transacción de confirmación.

DDL completo de referencia en `docs/ARCHITECTURE.md` §8. Al implementar, traducir a schema Drizzle manteniendo nombres y tipos.

## Workflow

- Una fase, una branch (`feat/movimientos-faseN-...`), un PR, una revisión. No avanzar de fase sin revisión humana y tests en verde.
- Tests primero en lógica de stock y estados.
- Branching: `main` (desplegable) / `dev` (activo) / `feat/*`.
- Secrets en `.env` por entorno; `.env.example` versionado; los reales jamás se commitean.
- Todo corre local: Postgres en Docker, backend y frontend en localhost.

## Estilo de trabajo con J

J habla español argentino informal y mezcla términos técnicos en inglés. Prefiere entregables concretos sobre explicaciones largas, itera feature por feature y pushea contra la sobre-ingeniería. No irse por las ramas.
