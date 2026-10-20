import { describe, expect, test } from 'vitest';
import { SQLITE_PRAGMAS, type Sqlite } from '../../src/db/index.ts';
import { createTestDatabase } from '../harness.ts';

function pragma(sqlite: Sqlite, nome: string): unknown {
  return sqlite.pragma(nome, { simple: true });
}

/**
 * Critério de aceite da TASK-010: afirmar a configuração REAL do SQLite
 * (consulta no banco aberto pelo harness), não apenas a constante de código.
 */
describe('configuração real do SQLite', () => {
  test('journal_mode=wal, synchronous=FULL e busy_timeout>0', () => {
    const t = createTestDatabase({ migrate: false });
    try {
      const journal = String(pragma(t.sqlite, 'journal_mode')).toLowerCase();
      expect(journal, 'journal_mode deve ser wal').toBe('wal');

      // O SQLite devolve synchronous como inteiro: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA.
      const synchronous = String(pragma(t.sqlite, 'synchronous')).toLowerCase();
      expect(
        ['2', 'full'],
        `synchronous inesperado (2 = FULL): ${synchronous}`,
      ).toContain(synchronous);

      const busyTimeout = Number(pragma(t.sqlite, 'busy_timeout'));
      expect(Number.isFinite(busyTimeout), 'busy_timeout deve ser numérico').toBe(true);
      expect(busyTimeout, 'busy_timeout deve ser > 0').toBeGreaterThan(0);
      expect(busyTimeout).toBe(SQLITE_PRAGMAS.busyTimeoutMs);
    } finally {
      t.destroy();
    }
  });

  test('os pragmas vêm da constante única de configuração (src/db/index.ts)', () => {
    expect(SQLITE_PRAGMAS).toEqual({
      journalMode: 'wal',
      synchronous: 'full',
      busyTimeoutMs: 5000,
    });
    expect(SQLITE_PRAGMAS.busyTimeoutMs).toBeGreaterThan(0);
  });
});
