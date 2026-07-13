import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { usuarios } from '../db/schema.js';

// Fila completa de `usuarios` (incluye pass_hash). Derivada del schema: si la tabla
// cambia de columnas/tipos, este tipo la sigue solo. El hash nunca sale de auth.
export type UsuarioConHash = typeof usuarios.$inferSelect;

// Busca un usuario por email (case-insensitive: el email se guarda y consulta en minúsculas).
// Devuelve el pass_hash para que el service compare; nunca sale de la capa de auth.
export async function buscarUsuarioPorEmail(email: string): Promise<UsuarioConHash | undefined> {
  const [row] = await db
    .select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      email: usuarios.email,
      passHash: usuarios.passHash,
      rol: usuarios.rol,
      activo: usuarios.activo,
    })
    .from(usuarios)
    .where(eq(usuarios.email, email))
    .limit(1);
  return row;
}
