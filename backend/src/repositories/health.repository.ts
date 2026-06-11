import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// Capa repository: única que habla con la DB. Verifica conectividad real.
export async function ping(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
