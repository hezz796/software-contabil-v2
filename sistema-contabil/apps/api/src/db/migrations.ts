import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDb } from './index.ts';

/** Pasta com as migrações geradas pelo drizzle-kit (`apps/api/drizzle`). */
export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

/**
 * Aplica as migrações pendentes. Idempotente: o drizzle registra em
 * `__drizzle_migrations` o que já foi aplicado e pula o restante.
 */
export function applyMigrations(db: AppDb): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
