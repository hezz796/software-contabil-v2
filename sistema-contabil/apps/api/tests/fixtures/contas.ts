import { sql } from 'drizzle-orm';
import type { AppDb } from '../../src/db/index.ts';
import {
  conta,
  periodoContabil,
  type Conta,
  type PeriodoContabil,
  type TipoConta,
} from '../../src/db/schema.ts';

/**
 * Fixtures de plano de contas e períodos contábeis para os testes (TASK-013).
 *
 * As fixtures criam as linhas direto no banco temporário do teste (mesmo
 * padrão das fixtures de empresa/segurança) — FKs são verificadas em runtime,
 * então a empresa pai é sempre informada/criada antes.
 */

export interface OpcoesContaTeste {
  empresaId: number;
  codigo: string;
  descricao?: string;
  tipo?: TipoConta;
  contaPaiId?: number;
  ativa?: boolean;
}

/** Cria uma conta direto no banco temporário do teste. */
export function criarContaTeste(db: AppDb, opcoes: OpcoesContaTeste): Conta {
  return db
    .insert(conta)
    .values({
      empresaId: opcoes.empresaId,
      codigo: opcoes.codigo,
      descricao: opcoes.descricao ?? `Conta ${opcoes.codigo}`,
      tipo: opcoes.tipo ?? 'ativo',
      ...(opcoes.contaPaiId !== undefined ? { contaPaiId: opcoes.contaPaiId } : {}),
      ativa: opcoes.ativa ?? true,
    })
    .returning()
    .all()[0]!;
}

export interface OpcoesPeriodoTeste {
  empresaId: number;
  ano: number;
  mes: number;
  /** ISO-8601 UTC; presente = período já encerrado. */
  encerradoEm?: string;
}

/** Cria um período contábil direto no banco temporário do teste. */
export function criarPeriodoTeste(db: AppDb, opcoes: OpcoesPeriodoTeste): PeriodoContabil {
  return db
    .insert(periodoContabil)
    .values({
      empresaId: opcoes.empresaId,
      ano: opcoes.ano,
      mes: opcoes.mes,
      encerradoEm: opcoes.encerradoEm ?? null,
    })
    .returning()
    .all()[0]!;
}

/**
 * Simula um lançamento lançado na conta (CA-17/CA-27: "conta com lançamentos").
 *
 * A tabela `partida` será criada pela TASK-014; até lá esta fixture cria uma
 * versão MÍNIMA com as mesmas colunas do ADR-0001 (`lancamento_id`,
 * `conta_id`, `natureza`, `valor_centavos`) e insere uma partida — permite
 * exercitar as regras de "tem lançamentos" já na T013. Quando a T014 existir,
 * `CREATE TABLE IF NOT EXISTS` vira no-op e a fixture passa a usar a tabela
 * real.
 */
export function simularLancamentoEmConta(db: AppDb, contaId: number): void {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS partida (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      lancamento_id integer NOT NULL,
      conta_id integer NOT NULL,
      natureza text NOT NULL,
      valor_centavos integer NOT NULL
    )
  `);
  db.run(sql`
    INSERT INTO partida (lancamento_id, conta_id, natureza, valor_centavos)
    VALUES (1, ${contaId}, 'D', 100000)
  `);
}
