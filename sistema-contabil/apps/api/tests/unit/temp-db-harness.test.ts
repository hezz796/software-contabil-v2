import fs from 'node:fs';
import { describe, expect, test } from 'vitest';
import { activeTestDatabaseCount, createTestDatabase } from '../harness.ts';

describe('harness de banco temporário', () => {
  test('cada teste recebe arquivo e diretório próprios (nada compartilhado)', () => {
    const a = createTestDatabase({ migrate: false });
    const b = createTestDatabase({ migrate: false });
    try {
      expect(a.filePath).not.toBe(b.filePath);
      expect(a.dir).not.toBe(b.dir);
      expect(fs.existsSync(a.filePath)).toBe(true);
      expect(fs.existsSync(b.filePath)).toBe(true);
      expect(activeTestDatabaseCount()).toBeGreaterThanOrEqual(2);
    } finally {
      a.destroy();
      b.destroy();
    }
    expect(activeTestDatabaseCount()).toBe(0);
  });

  test('destroy() fecha a conexão e apaga banco, -wal e -shm', () => {
    const t = createTestDatabase();
    const { filePath } = t;
    t.sqlite.prepare('insert into app_meta (chave, valor) values (?, ?)').run('teste', '1');
    expect(fs.existsSync(filePath)).toBe(true);

    t.destroy();

    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(`${filePath}-wal`)).toBe(false);
    expect(fs.existsSync(`${filePath}-shm`)).toBe(false);
    expect(activeTestDatabaseCount()).toBe(0);
  });
});
