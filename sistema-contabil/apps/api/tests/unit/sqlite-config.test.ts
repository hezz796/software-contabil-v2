import { describe, expect, test } from 'vitest';
import { SQLITE_PRAGMAS, type Sqlite } from '../../src/db/index.ts';
import { createTestDatabase } from '../harness.ts';

function pragma(sqlite: Sqlite, nome: string): unknown {
  return sqlite.pragma(nome, { simple: true });
}

/**
 * Critério de aceite da TASK-010: afirmar a configuração REAL do SQLite
 * (consulta no banco aberto pelo harness), não apenas a constante de código.
 *
 * `recursive_triggers` (S-T014-5, TASK-016) é verificado em dois níveis: o
 * PRAGMA lido no banco e o comportamento que ele fecha — o atalho `REPLACE`
 * (que satisfaz o conflito de PK removendo a linha antiga) precisa disparar o
 * `BEFORE DELETE` de `audit_event` (append-only, CA-38) e ser abortado.
 */
describe('configuração real do SQLite', () => {
  test('journal_mode=wal, synchronous=FULL, busy_timeout>0, foreign_keys=ON e recursive_triggers=ON (T012/T016)', () => {
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

      // FK verificada em runtime (T012): usuario_empresa -> empresa.
      expect(Number(pragma(t.sqlite, 'foreign_keys')), 'foreign_keys deve ser 1 (ON)').toBe(1);

      // recursive_triggers verificado em runtime (S-T014-5, T016).
      expect(
        Number(pragma(t.sqlite, 'recursive_triggers')),
        'recursive_triggers deve ser 1 (ON)',
      ).toBe(1);
    } finally {
      t.destroy();
    }
  });

  test('os pragmas vêm da constante única de configuração (src/db/index.ts)', () => {
    expect(SQLITE_PRAGMAS).toEqual({
      journalMode: 'wal',
      synchronous: 'full',
      busyTimeoutMs: 5000,
      foreignKeys: true,
      recursiveTriggers: true,
    });
    expect(SQLITE_PRAGMAS.busyTimeoutMs).toBeGreaterThan(0);
  });

  test('REPLACE INTO em audit_event é abortado pelo banco (recursive_triggers + append-only, S-T014-5)', () => {
    // migrações aplicadas: o trigger audit_event_no_delete (0002) precisa existir
    const t = createTestDatabase();
    try {
      // pré-condição comprovada: LINHA real de auditoria já gravada
      const criadoEm = new Date().toISOString();
      const inserido = t.sqlite
        .prepare(
          `INSERT INTO audit_event (usuario_id, empresa_id, acao, objeto_tipo, objeto_id, dados, criado_em)
           VALUES (NULL, NULL, 'teste.append_only', NULL, NULL, NULL, ?)`,
        )
        .run(criadoEm);
      const id = Number(inserido.lastInsertRowid);
      expect(id).toBeGreaterThan(0);

      // sem recursive_triggers o REPLACE satisfaria o conflito de PK apagando a
      // linha antiga SEM disparar o BEFORE DELETE; com o pragma ON o trigger
      // dispara e aborta — o atalho está fechado NO BANCO
      expect(() =>
        t.sqlite
          .prepare(
            `REPLACE INTO audit_event (id, usuario_id, empresa_id, acao, objeto_tipo, objeto_id, dados, criado_em)
             VALUES (?, NULL, NULL, 'teste.substituido', NULL, NULL, NULL, ?)`,
          )
          .run(id, new Date().toISOString()),
      ).toThrow(/append-only/i);

      // a linha original permanece intacta (a recusa não deixou efeito parcial)
      const linha = t.sqlite.prepare('SELECT acao FROM audit_event WHERE id = ?').get(id) as
        | { acao: string }
        | undefined;
      expect(linha?.acao).toBe('teste.append_only');
      expect(
        t.sqlite.prepare('SELECT count(*) AS total FROM audit_event').get(),
      ).toEqual({ total: 1 });
    } finally {
      t.destroy();
    }
  });
});
