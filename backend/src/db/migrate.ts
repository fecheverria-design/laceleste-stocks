import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function main(): Promise<void> {
  console.log('▶ Aplicando migraciones…');
  await migrate(db, { migrationsFolder });
  console.log('✔ Migraciones aplicadas.');
  await pool.end();
}

main().catch((err: unknown) => {
  console.error('❌ Error aplicando migraciones:', err);
  process.exit(1);
});
