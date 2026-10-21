import { and, asc, eq, sql } from 'drizzle-orm';
import type { SituacaoConta } from '@sistema-contabil/shared';
import type { AppDb } from '../db/index.ts';
import { conta, type Conta, type TipoConta } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';

/**
 * Plano de contas hierárquico por empresa (RF-06, CA-17/CA-27).
 *
 * Regras sustentadas aqui:
 * - código único POR EMPRESA (recusa 409 com mensagem específica — CA-17);
 * - tipo obrigatório (validado na camada de entrada, schema compartilhado);
 * - conta com lançamentos só **inativa**; **não existe exclusão dura**
 *   (CA-17/CE-13/CA-27): `excluirConta` sempre recusa e orienta inativar;
 * - pai com filhas ativas não é inativada antes das filhas (CA-27);
 * - toda escrita grava o evento na MESMA transação (R8), antes/depois.
 */

export interface EntradaConta {
  empresaId: number;
  codigo: string;
  descricao: string;
  tipo: TipoConta;
  /** `undefined`/`null` = nível raiz. */
  contaPaiId?: number | null;
  situacao?: SituacaoConta;
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.startsWith('SQLITE_CONSTRAINT');
}

function paraSituacao(ativo: boolean): SituacaoConta {
  return ativo ? 'ativa' : 'inativa';
}

/* -------------------------------------------------------------------------- */
/* "Tem lançamentos" — dependência da tabela `partida` (TASK-014)              */
/* -------------------------------------------------------------------------- */

/**
 * A tabela `partida` será criada pela TASK-014; até lá nenhuma conta pode ter
 * lançamentos. A checagem consulta `sqlite_master` e só então a `partida` —
 * assim a regra funciona hoje e continua válida quando a T014 entrar, sem que
 * a T013 precise criar tabelas de outra tarefa.
 */
function tabelaPartidaExiste(db: AppDb): boolean {
  const linha = db.get<{ name: string } | undefined>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partida'`,
  );
  return linha !== undefined;
}

/** A conta referencia algum lançamento (partida)? Base da regra "só inativa" (CA-17/CA-27). */
export function contaTemLancamentos(db: AppDb, contaId: number): boolean {
  if (!tabelaPartidaExiste(db)) return false;
  const linha = db.get<{ achou: number } | undefined>(
    sql`SELECT 1 AS achou FROM partida WHERE conta_id = ${contaId} LIMIT 1`,
  );
  return linha !== undefined;
}

/**
 * Conjunto de contas (dentro das informadas) que têm lançamentos — usado na
 * listagem (`tem_lancamentos` do grid do plano de contas). Escala H3: poucas
 * dezenas de contas por empresa, uma consulta por conta é aceitável.
 */
export function contasComLancamentos(db: AppDb, contaIds: number[]): Set<number> {
  const resultado = new Set<number>();
  for (const id of contaIds) {
    if (contaTemLancamentos(db, id)) resultado.add(id);
  }
  return resultado;
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

/** Conta por id DENTRO da empresa (nunca devolve conta alheia — R7). */
export async function buscarContaNaEmpresa(
  db: AppDb,
  contaId: number,
  empresaId: number,
): Promise<Conta | undefined> {
  const linhas = await db
    .select()
    .from(conta)
    .where(and(eq(conta.id, contaId), eq(conta.empresaId, empresaId)));
  return linhas[0];
}

export interface FiltroContas {
  somenteAtivas?: boolean | undefined;
}

/** Plano de contas da empresa em ordem de código (ordem natural do PCASP). */
export async function listarContas(
  db: AppDb,
  empresaId: number,
  filtro: FiltroContas = {},
): Promise<Conta[]> {
  const condicoes = [eq(conta.empresaId, empresaId)];
  if (filtro.somenteAtivas) condicoes.push(eq(conta.ativa, true));
  return db.select().from(conta).where(and(...condicoes)).orderBy(asc(conta.codigo));
}

/** Quantidade de contas filhas ATIVAS (regra CA-27: filhas ativas impedem inativar o pai). */
export function contarFilhasAtivas(db: AppDb, contaId: number): number {
  const linhas = db
    .select({ id: conta.id })
    .from(conta)
    .where(and(eq(conta.contaPaiId, contaId), eq(conta.ativa, true)))
    .all();
  return linhas.length;
}

/* -------------------------------------------------------------------------- */
/* Escritas                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cria uma conta no plano da empresa (CA-17).
 *
 * Recusas: código já usado na mesma empresa (409, mensagem específica); conta
 * pai inexistente ou de outra empresa (404 — nunca expõe conta alheia). Em
 * qualquer recusa nada é persistido (a escrita e a trilha compartilham a
 * transação e as validações vêm antes dela).
 */
export async function criarConta(db: AppDb, entrada: EntradaConta, atorId: number): Promise<Conta> {
  if (entrada.contaPaiId !== undefined && entrada.contaPaiId !== null) {
    const pai = await buscarContaNaEmpresa(db, entrada.contaPaiId, entrada.empresaId);
    if (!pai) {
      throw new ErroAplicacao(404, 'Conta pai não encontrada nesta empresa.', 'conta_pai_nao_encontrada');
    }
  }

  const ativa = (entrada.situacao ?? 'ativa') === 'ativa';
  const contaPaiId = entrada.contaPaiId ?? null;

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const inserida = tx
        .insert(conta)
        .values({
          empresaId: entrada.empresaId,
          codigo: entrada.codigo,
          descricao: entrada.descricao,
          tipo: entrada.tipo,
          contaPaiId,
          ativa,
        })
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'conta.criacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conta',
        objetoId: String(inserida.id),
        dados: {
          codigo: inserida.codigo,
          descricao: inserida.descricao,
          tipo: inserida.tipo,
          conta_pai_id: inserida.contaPaiId,
          situacao: paraSituacao(inserida.ativa),
        },
      });

      return inserida;
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(
        409,
        `Já existe uma conta com o código ${entrada.codigo} nesta empresa.`,
        'codigo_conta_duplicado',
      );
    }
    throw erro;
  }
}

export interface EntradaAtualizacaoConta {
  descricao?: string;
  tipo?: TipoConta;
  situacao?: SituacaoConta;
}

/**
 * Altera descrição, tipo e/ou situação (ativa/inativa) da conta (CA-27).
 *
 * Inativar uma conta com lançamentos é ACEITO (ela sai das escolhas novas);
 * inativar conta pai com filhas ativas é RECUSADO antes das filhas. Código e
 * conta pai são imutáveis nesta etapa (decisão T013: recodificar ou reparentar
 * mudaria o sentido histórico do plano).
 */
export async function atualizarConta(
  db: AppDb,
  alvo: { contaId: number; empresaId: number },
  entrada: EntradaAtualizacaoConta,
  atorId: number,
): Promise<Conta> {
  const atual = await buscarContaNaEmpresa(db, alvo.contaId, alvo.empresaId);
  if (!atual) {
    throw new ErroAplicacao(404, 'Conta não encontrada nesta empresa.', 'conta_nao_encontrada');
  }

  const inativando = entrada.situacao === 'inativa' && atual.ativa;
  if (inativando && contarFilhasAtivas(db, atual.id) > 0) {
    throw new ErroAplicacao(
      409,
      'Conta pai com contas filhas ativas não pode ser inativada antes das filhas.',
      'conta_pai_com_filhas_ativas',
    );
  }

  const mudancas: Record<string, unknown> = {};
  if (entrada.descricao !== undefined && entrada.descricao !== atual.descricao) {
    mudancas['descricao'] = { de: atual.descricao, para: entrada.descricao };
  }
  if (entrada.tipo !== undefined && entrada.tipo !== atual.tipo) {
    mudancas['tipo'] = { de: atual.tipo, para: entrada.tipo };
  }
  if (entrada.situacao !== undefined && paraSituacao(atual.ativa) !== entrada.situacao) {
    mudancas['situacao'] = { de: paraSituacao(atual.ativa), para: entrada.situacao };
  }

  if (Object.keys(mudancas).length === 0) return atual;

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const alterada = tx
      .update(conta)
      .set({
        ...(entrada.descricao !== undefined ? { descricao: entrada.descricao } : {}),
        ...(entrada.tipo !== undefined ? { tipo: entrada.tipo } : {}),
        ...(entrada.situacao !== undefined ? { ativa: entrada.situacao === 'ativa' } : {}),
        atualizadoEm: new Date().toISOString(),
      })
      .where(eq(conta.id, atual.id))
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'conta.alteracao',
      usuarioId: atorId,
      empresaId: alvo.empresaId,
      objetoTipo: 'conta',
      objetoId: String(alterada.id),
      dados: mudancas,
    });

    return alterada;
  });
}

/**
 * Exclusão de conta: **sempre recusada** (CA-17/CA-27/CE-13).
 *
 * Não existe exclusão dura no MVP (H13): o caminho permitido é inativar, que
 * tira a conta das escolhas novas e preserva o histórico. A tentativa fica
 * registrada na trilha como recusa e nada é persistido.
 */
export async function excluirConta(
  db: AppDb,
  alvo: { contaId: number; empresaId: number },
  atorId: number,
): Promise<never> {
  const atual = await buscarContaNaEmpresa(db, alvo.contaId, alvo.empresaId);
  if (!atual) {
    throw new ErroAplicacao(404, 'Conta não encontrada nesta empresa.', 'conta_nao_encontrada');
  }

  const temLancamentos = contaTemLancamentos(db, atual.id);

  // Recusa auditada: usuário, empresa, objeto e motivo (RF-05/CE-13).
  registrarEvento(db, {
    acao: 'conta.exclusao_recusada',
    usuarioId: atorId,
    empresaId: alvo.empresaId,
    objetoTipo: 'conta',
    objetoId: String(atual.id),
    dados: { codigo: atual.codigo, motivo: 'exclusao_dura_nao_permitida', tem_lancamentos: temLancamentos },
  });

  throw new ErroAplicacao(
    405,
    temLancamentos
      ? 'Contas com lançamentos não podem ser excluídas: o caminho permitido é inativar a conta.'
      : 'Contas não podem ser excluídas: o caminho permitido é inativar a conta.',
    'exclusao_nao_permitida',
  );
}
