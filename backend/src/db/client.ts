import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

const { Pool } = pg;

// Pool de conexiones único de la app. Las migraciones, el seed y los repositories
// comparten esta instancia.
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type DB = typeof db;
