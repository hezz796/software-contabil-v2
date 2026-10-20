import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

/**
 * Parâmetros exigidos por toda conexão (ADR-0001): WAL para leitura
 * concorrente, synchronous=FULL para durabilidade das transações contábeis e
 * busy_timeout explícito para falhar com espera em vez de "database is locked".
 */
export const SQLITE_PRAGMAS = {
  journalMode: 'wal',
  synchronous: 'full',
  busyTimeoutMs: 5000,
} as const;

/** Abre (ou cria) o arquivo SQLite e aplica os pragmas do projeto. */
export function openSqlite(filePath: string) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const sqlite = new BetterSqlite3(filePath);
  sqlite.pragma(`journal_mode = ${SQLITE_PRAGMAS.journalMode}`);
  sqlite.pragma(`synchronous = ${SQLITE_PRAGMAS.synchronous}`);
  sqlite.pragma(`busy_timeout = ${SQLITE_PRAGMAS.busyTimeoutMs}`);
  return sqlite;
}

/** Conexão SQLite + instância Drizzle com o schema carregado. */
export function createDb(filePath: string) {
  const sqlite = openSqlite(filePath);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type Sqlite = ReturnType<typeof openSqlite>;
export type AppDb = ReturnType<typeof createDb>['db'];
