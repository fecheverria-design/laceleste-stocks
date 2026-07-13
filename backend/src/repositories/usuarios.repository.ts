import { asc, eq } from 'drizzle-orm';
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

// Datos públicos de un usuario: TODO menos el pass_hash (que nunca sale de auth).
export interface UsuarioPublico {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

const COLUMNAS_PUBLICAS = {
  id: usuarios.id,
  nombre: usuarios.nombre,
  email: usuarios.email,
  rol: usuarios.rol,
  activo: usuarios.activo,
} as const;

export async function listarUsuarios(): Promise<UsuarioPublico[]> {
  return db.select(COLUMNAS_PUBLICAS).from(usuarios).orderBy(asc(usuarios.id));
}

export async function insertarUsuario(datos: {
  nombre: string;
  email: string;
  passHash: string;
  rol: string;
}): Promise<UsuarioPublico> {
  const [row] = await db.insert(usuarios).values(datos).returning(COLUMNAS_PUBLICAS);
  if (!row) throw new Error('No se pudo crear el usuario');
  return row;
}

export async function actualizarPassHash(email: string, passHash: string): Promise<UsuarioPublico | undefined> {
  const [row] = await db
    .update(usuarios)
    .set({ passHash })
    .where(eq(usuarios.email, email))
    .returning(COLUMNAS_PUBLICAS);
  return row;
}

export async function actualizarActivo(email: string, activo: boolean): Promise<UsuarioPublico | undefined> {
  const [row] = await db
    .update(usuarios)
    .set({ activo })
    .where(eq(usuarios.email, email))
    .returning(COLUMNAS_PUBLICAS);
  return row;
}
