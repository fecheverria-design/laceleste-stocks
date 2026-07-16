# DEPLOY — la app en el servidor (LXC del Proxmox)

Estado: **el empaquetado está hecho y probado; el LXC todavía no existe.**

La app corre en un LXC del Proxmox propio, publicada como `stocks.plataformaceleste.com`.
El camino a internet ya existía y no lo tocamos:

```
stocks.plataformaceleste.com → Cloudflare Tunnel → Traefik (10.10.10.10:80) → IP_DEL_LXC:8080
                               [ya andaba]          [un .yml, lo hace manejar_links]
```

Los scripts de infra (`deploy_lxc`, `manejar_links`, `abrir_proxmox`) viven **fuera de este
repo**, en `scripts_servidor`. Ahí hay apps y servicios productivos de la empresa: **se miran,
no se tocan**, y los corre J.

## Qué se construye

| Servicio | Imagen | Puerto | Publicado |
|---|---|---|---|
| `web` | nginx con el build de Vite + proxy `/api` | 80 | **Sí** → `WEB_PORT` (8080) |
| `backend` | Node 20 + Express compilado | 3000 | No (red interna) |
| `db` | postgres:16 | 5432 | No (red interna) |

**Un solo puerto sale del LXC.** nginx sirve el front y proxea `/api` al backend en el mismo
origen → un solo link en Traefik y cero CORS. El TLS lo termina Cloudflare (el entrypoint de
Traefik es `web`, plano `:80`), así que acá no se manejan certificados.

## Pasos

### 1. Crear el LXC — lo corre J

Con el menú de `scripts_servidor` (`python menu.py` → *Deploy LXC*). Pide:

- **CT ID**: un número libre (el script frena solo si está ocupado).
- **CT IP**: una IP libre de `10.10.10.0/24` (Traefik es la `.10`). **Anotala**: es la que
  se carga después en el link.
- Recursos: los defaults (2 cores / 2 GB / 20 GB) alcanzan para Postgres + Node.

Deja Debian 12 con Docker y el Portainer Agent. Los dos datos se sacan de la web de Proxmox
(*Abrir Proxmox* en el menú) o con `pct list` en su consola.

### 2. Traer el repo y configurar

Adentro del LXC:

```bash
apt-get update && apt-get install -y git
git clone <url-del-repo> /opt/laceleste
cd /opt/laceleste

cp .env.prod.example .env
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 24   # → POSTGRES_PASSWORD
openssl rand -hex 24   # → M2M_API_KEY
nano .env              # completar, incluido COMPANERO_API_PASS
```

**No copiar el `.env` de desarrollo**: sus contraseñas están en el repo.

### 3. Levantar

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend
```

Las migraciones corren solas al arrancar el backend (entrypoint), después de que el
healthcheck de Postgres pasa. Verificar:

```bash
curl localhost:8080/api/health     # → {"status":"ok","db":"up",…}
```

### 4. Traer los datos ⚠ el paso que no es obvio

El LXC arranca con **la base vacía**: las migraciones crean el esquema, no los datos. Todo lo
cargado (productos, precios, inventario, movimientos, usuarios) está en la Postgres de la PC de
J. Hay que mudarlo:

```powershell
# En la PC de J — mismo dump que hace scripts\backup-db.ps1
docker exec laceleste_movimientos_db pg_dump -U laceleste -Fc -f /tmp/mudanza.dump laceleste_movimientos
docker cp laceleste_movimientos_db:/tmp/mudanza.dump .\mudanza.dump
scp .\mudanza.dump root@IP_DEL_LXC:/tmp/
```

```bash
# En el LXC
cd /opt/laceleste
docker compose -f docker-compose.prod.yml cp /tmp/mudanza.dump db:/tmp/
docker compose -f docker-compose.prod.yml exec db \
  pg_restore -U laceleste -d laceleste_movimientos --clean --if-exists /tmp/mudanza.dump
docker compose -f docker-compose.prod.yml exec db \
  psql -U laceleste -d laceleste_movimientos -c "REFRESH MATERIALIZED VIEW stock_actual;"
```

Hacerlo con los syncs de la PC **ya apagados**, si no los dos escriben lo mismo en bases
distintas y hay que rehacerlo. Después chequear que el stock cuadre contra la app vieja.

### 5. Seguridad — antes de publicar el link, no después

Hasta hoy era todo localhost y las claves de demo no eran riesgo real. Con el link publicado
la app está en internet:

```bash
docker compose -f docker-compose.prod.yml exec backend \
  npm run usuarios -- pass --email admin@laceleste.local --pass '<nueva>'
docker compose -f docker-compose.prod.yml exec backend \
  npm run usuarios -- pass --email deposito@laceleste.local --pass '<nueva>'
```

`laceleste123` está escrita en `seed-dev.ts`, o sea en el repo. El `JWT_SECRET` nuevo ya salió
del paso 2.

### 6. Publicar el link — lo corre J

`python menu.py` → *Manejar links* → agregar:

- subdominio: `stocks`
- IP interna: la del LXC (o el CT ID, que la resuelve solo)
- puerto: `8080` (el `WEB_PORT` del `.env`)

Traefik lo toma solo (`--providers.file.watch=true`), sin reiniciar nada. No se toca ni
Cloudflare ni el túnel.

### 7. Mover los automatismos al LXC

Es el objetivo de todo esto: que dejen de depender de la PC de J prendida. Los syncs
corren hoy por Tarea Programada de Windows (`scripts\sync-live.cmd`, cada 1h) y el backup
también (`scripts\backup-db.ps1`, a Dropbox).

En el LXC no hace falta el wrapper que espera a Docker: acá Docker es systemd y ya está
arriba. `crontab -e`:

```cron
# Syncs con la app de Tincho, cada hora (reconciliar + ventana móvil son el default)
0 * * * * cd /opt/laceleste && docker compose -f docker-compose.prod.yml exec -T backend npm -w backend run sync:abastecimientos >> /var/log/laceleste-sync.log 2>&1
5 * * * * cd /opt/laceleste && docker compose -f docker-compose.prod.yml exec -T backend npm -w backend run sync:recepciones   >> /var/log/laceleste-sync.log 2>&1
```

El LXC sale a internet (NAT + DNS los deja el `deploy_lxc`), así que le llega a
`produccion.laceleste.com.ar` sin problema.

**El backup queda pendiente de decidir**: `backup-db.ps1` copia a la carpeta de Dropbox y el
cliente la sube. En el LXC no hay Dropbox. Opciones: `rclone` a Dropbox desde el LXC, o dejar
el backup corriendo desde la PC de J apuntando al LXC. **Hasta que esto esté resuelto, no
apagar el backup viejo.**

Recién cuando los syncs y el backup corran acá se apagan las tareas de Windows:

```powershell
Disable-ScheduledTask -TaskName "LaCeleste Sync en vivo"
```

## Operación

```bash
cd /opt/laceleste

# Actualizar a la última versión
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Logs
docker compose -f docker-compose.prod.yml logs -f backend

# Cualquier script de consola (usuarios, import:*, sync:*) anda igual que en dev
docker compose -f docker-compose.prod.yml exec backend npm run usuarios -- listar
```

Los scripts de operación andan adentro del contenedor porque la imagen del backend conserva
`src/` y las devDependencies (`tsx`) **a propósito** — está comentado en `backend/Dockerfile`.
Sacarlas para achicar la imagen rompe los syncs y el ABM de usuarios.

## Qué se probó (2026-07-16, en la PC de J)

Las dos imágenes se buildearon y el stack completo se levantó con volumen y nombres propios,
sin tocar la DB de desarrollo:

- migraciones aplicadas solas al arrancar, backend en `NODE_ENV=production`;
- `/api/health` → `{"status":"ok","db":"up"}` **a través de nginx** (el proxy `/api` anda);
- `/movimientos` → 200 (el fallback SPA anda: un F5 no da 404);
- `npm run usuarios -- listar` adentro del contenedor;
- zona horaria `-03` (sin `tzdata` el contenedor corre en UTC y un movimiento de la noche
  cae en el día siguiente — la app razona por día).

Lo que **no** se probó y solo se puede probar en el server: el LXC, el link de Traefik, la
mudanza de datos y el cron.
