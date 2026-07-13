import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

const { Pool } = pg;

// En tests (NODE_ENV=test) apuntamos a la DB de test aislada; en runtime normal,
// a la principal. Así repositories y services usan la base correcta sin saberlo.
const connectionString =
  env.NODE_ENV === 'test' && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL;

// Pool de conexiones único de la app. Las migraciones, el seed y los repositories
// comparten esta instancia.
export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type DB = typeof db;

// Tipo de la transacción (lo que recibe el callback de db.transaction). Los
// repositories que escriben reciben esto para correr dentro de la tx de confirmación.
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
