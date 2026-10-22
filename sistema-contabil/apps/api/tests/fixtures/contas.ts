import { and, eq } from 'drizzle-orm';
import type { AppDb } from '../../src/db/index.ts';
import {
  conta,
  lancamento,
  partida,
  periodoContabil,
  usuario,
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
 * Encerra um período ABERTO direto no banco (fixture: transição de estado,
 * como o produto faz no serviço de encerramento — TASK-015).
 *
 * Preparação legítima de teste: grava lançamentos enquanto aberto e então
 * fecha. Depois disso o trigger `lancamento_no_periodo_encerrado` (migração
 * 0006) aborta QUALQUER INSERT novo em `lancamento` no período — é o que o
 * teste CA-24 (banco) prova. O UPDATE da marca passa porque o período ainda
 * está aberto; uma segunda chamada é abortada por `periodo_encerramento_unico`.
 */
export function encerrarPeriodoTeste(db: AppDb, periodoId: number): void {
  db.update(periodoContabil)
    .set({ encerradoEm: new Date().toISOString() })
    .where(eq(periodoContabil.id, periodoId))
    .prepare()
    .run();
}

/**
 * Simula um lançamento lançado na conta (CA-17/CA-27: "conta com lançamentos").
 *
 * Usa as tabelas REAIS da T014: cria um lançamento (com período aberto de
 * referência 01/2026 e o primeiro usuário do banco de teste como autor) e uma
 * partida D na conta informada — FK `partida.lancamento_id` é satisfeita por
 * construção (achado T014-F-1: partida sem lançamento é recusada pelo banco).
 * Exige que exista ao menos um usuário no banco de teste (as fixtures de
 * segurança sempre criam antes dos call sites).
 */
export function simularLancamentoEmConta(db: AppDb, contaId: number, empresaId: number): void {
  const autor = db.select().from(usuario).orderBy(usuario.id).limit(1).all()[0];
  if (!autor) {
    throw new Error('simularLancamentoEmConta: crie um usuário de teste antes de usar a fixture.');
  }

  const periodoExistente = db
    .select()
    .from(periodoContabil)
    .where(
      and(
        eq(periodoContabil.empresaId, empresaId),
        eq(periodoContabil.ano, 2026),
        eq(periodoContabil.mes, 1),
      ),
    )
    .limit(1)
    .all()[0];
  const periodo =
    periodoExistente ??
    db
      .insert(periodoContabil)
      .values({ empresaId, ano: 2026, mes: 1 })
      .returning()
      .all()[0]!;

  const criado = db
    .insert(lancamento)
    .values({
      empresaId,
      periodoId: periodo.id,
      data: '2026-01-15',
      historico: 'Simulação de lançamento (fixture de teste)',
      estornoDeId: null,
      criadoPor: autor.id,
    })
    .returning()
    .all()[0]!;

  db.insert(partida)
    .values({
      lancamentoId: criado.id,
      contaId,
      natureza: 'D',
      valorCentavos: 100_000,
    })
    .run();
}
