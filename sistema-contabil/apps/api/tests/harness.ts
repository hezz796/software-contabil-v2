import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { AppConfig } from '../src/config.ts';
import { createDb, type AppDb, type Sqlite } from '../src/db/index.ts';
import { applyMigrations } from '../src/db/migrations.ts';

/**
 * Harness de teste: banco SQLite temporário por teste.
 *
 * Cada chamada cria um diretório próprio em `%TEMP%`/`os.tmpdir()` e o banco
 * dentro dele — nenhum arquivo é compartilhado entre testes. `destroy()` fecha
 * a conexão e apaga o diretório (banco, `-wal` e `-shm`).
 *
 * `tests/setup.ts` falha a suíte se algum teste terminar com banco ativo.
 */
export interface TestDatabase {
  readonly dir: string;
  readonly filePath: string;
  readonly db: AppDb;
  readonly sqlite: Sqlite;
  destroy(): void;
}

const ativos = new Set<TestDatabase>();

/** Quantidade de bancos temporários criados e ainda não destruídos neste worker. */
export function activeTestDatabaseCount(): number {
  return ativos.size;
}

export interface CreateTestDatabaseOptions {
  /** Aplica as migrações no banco recém-criado. Padrão: `true`. */
  migrate?: boolean;
}

export function createTestDatabase(options: CreateTestDatabaseOptions = {}): TestDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sistema-contabil-'));
  const filePath = path.join(dir, 'test.db');
  const { db, sqlite } = createDb(filePath);

  if (options.migrate !== false) {
    applyMigrations(db);
  }

  let destruido = false;
  const handle: TestDatabase = {
    dir,
    filePath,
    db,
    sqlite,
    destroy(): void {
      if (destruido) return;
      destruido = true;
      ativos.delete(handle);
      try {
        sqlite.close();
      } catch {
        // conexão já fechada — seguir para a limpeza do arquivo
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };

  ativos.add(handle);
  return handle;
}

/** App Fastify montado sobre um banco temporário próprio (libera tudo em `close`). */
export interface TestApp {
  readonly app: FastifyInstance;
  readonly database: TestDatabase;
  close(): Promise<void>;
}

export interface CreateTestAppOptions {
  /**
   * Configuração da API para o app de teste (TTL de sessão, `Secure` do
   * cookie, limite de tentativas...). Quando omitida, `buildApp` carrega
   * `loadConfig()` do ambiente — mesmos defaults de produção/dev.
   */
  config?: AppConfig;
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const database = createTestDatabase();
  const app = await buildApp({ db: database.db, logger: false, config: options.config });

  return {
    app,
    database,
    async close(): Promise<void> {
      try {
        await app.close();
      } finally {
        database.destroy();
      }
    },
  };
}
