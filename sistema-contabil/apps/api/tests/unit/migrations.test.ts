import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, applyMigrations } from '../../src/db/migrations.ts';
import { createTestDatabase, type TestDatabase } from '../harness.ts';

/** Quantidade de entradas do journal do drizzle (uma por migração gerada). */
function contarMigrationsNoJournal(): number {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  return journal.entries.length;
}

function contarTabela(t: TestDatabase, nome: string): number {
  const linha = t.sqlite
    .prepare(`select count(*) as total from sqlite_master where type = 'table' and name = ?`)
    .get(nome) as { total: number };
  return linha.total;
}

function contarMigrationsAplicadas(t: TestDatabase): number {
  const linha = t.sqlite.prepare('select count(*) as total from __drizzle_migrations').get() as {
    total: number;
  };
  return linha.total;
}

describe('migrações', () => {
  test('existe migração gerada pelo drizzle-kit em drizzle/', () => {
    expect(fs.existsSync(MIGRATIONS_FOLDER)).toBe(true);
    const sqls = fs.readdirSync(MIGRATIONS_FOLDER).filter((arquivo) => arquivo.endsWith('.sql'));
    expect(sqls.length).toBeGreaterThan(0);
  });

  test('aplicação idempotente em banco limpo', () => {
    const t = createTestDatabase({ migrate: false });
    try {
      // banco limpo: nenhuma tabela ainda
      expect(contarTabela(t, 'app_meta')).toBe(0);
      expect(contarTabela(t, '__drizzle_migrations')).toBe(0);

      applyMigrations(t.db);
      expect(contarTabela(t, 'app_meta')).toBe(1);
      const aplicadas = contarMigrationsAplicadas(t);
      // uma linha por migração do journal (conta cresce conforme o domínio)
      expect(aplicadas).toBe(contarMigrationsNoJournal());
      expect(aplicadas).toBeGreaterThan(0);

      // segunda execução no mesmo banco: no-op, sem duplicar nem falhar
      applyMigrations(t.db);
      expect(contarMigrationsAplicadas(t)).toBe(aplicadas);
      expect(contarTabela(t, 'app_meta')).toBe(1);
    } finally {
      t.destroy();
    }
  });
});
