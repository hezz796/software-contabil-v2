import { and, asc, eq } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import { periodoContabil, type PeriodoContabil } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { transacaoComAuditoria } from './auditoria.ts';

/**
 * Períodos contábeis mensais (RF-09, TASK-013).
 *
 * - criados pelo contador com escrita contábil ativa (o guard de escrita rota
 *   antes; F13/CA-33 recusa admin e contador não atribuído, auditado);
 * - (empresa, ano, mês) é **único** (recusa 409 com mensagem específica);
 * - nasce **aberto** (`encerrado_em = NULL`). As ações de encerramento —
 *   zera resultado, estornos, rolagem e encerramento do exercício (H12) —
 *   são da TASK-015; aqui estão apenas a base e o estado.
 * - toda escrita grava o evento na MESMA transação (R8).
 */

export interface EntradaPeriodo {
  empresaId: number;
  ano: number;
  /** 1..12 (validado na camada de entrada). */
  mes: number;
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.startsWith('SQLITE_CONSTRAINT');
}

function rotuloDoPeriodo(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/**
 * Cria o período (empresa, ano, mês) em estado aberto. Duplicado exato é
 * recusado com 409 e mensagem específica; nada é persistido (CA / RF-09:
 * períodos são únicos por empresa+ano+mês).
 */
export async function criarPeriodo(
  db: AppDb,
  entrada: EntradaPeriodo,
  atorId: number,
): Promise<PeriodoContabil> {
  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const inserido = tx
        .insert(periodoContabil)
        .values({ empresaId: entrada.empresaId, ano: entrada.ano, mes: entrada.mes })
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'periodo.criacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'periodo_contabil',
        objetoId: String(inserido.id),
        dados: { ano: inserido.ano, mes: inserido.mes, situacao: 'aberto' },
      });

      return inserido;
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(
        409,
        `Já existe um período contábil ${rotuloDoPeriodo(entrada.ano, entrada.mes)} para esta empresa.`,
        'periodo_duplicado',
      );
    }
    throw erro;
  }
}

/** Períodos da empresa em ordem cronológica (ano, mês). */
export async function listarPeriodos(db: AppDb, empresaId: number): Promise<PeriodoContabil[]> {
  return db
    .select()
    .from(periodoContabil)
    .where(eq(periodoContabil.empresaId, empresaId))
    .orderBy(asc(periodoContabil.ano), asc(periodoContabil.mes));
}

/**
 * Período de uma data (YYYY-MM-DD) na empresa — base para a regra "nada em
 * período encerrado" (CA-24, T014/T015). `undefined` quando não existe.
 */
export async function periodoDeData(
  db: AppDb,
  empresaId: number,
  data: string,
): Promise<PeriodoContabil | undefined> {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  const linhas = await db
    .select()
    .from(periodoContabil)
    .where(
      and(
        eq(periodoContabil.empresaId, empresaId),
        eq(periodoContabil.ano, ano),
        eq(periodoContabil.mes, mes),
      ),
    );
  return linhas[0];
}
