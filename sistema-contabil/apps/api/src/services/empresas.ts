import { asc, eq } from 'drizzle-orm';
import type { SituacaoEmpresa } from '@sistema-contabil/shared';
import type { AppDb } from '../db/index.ts';
import { empresa, type Empresa } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { transacaoComAuditoria } from './auditoria.ts';

/**
 * Cadastro de empresas (RF-01, RF-05, H13, CA-15/CA-40).
 *
 * - CNPJ validado na entrada (schema compartilhado) e **único** no banco;
 * - situação ativa/inativa — **sem exclusão dura** no MVP (H13): não existe
 *   `excluirEmpresa`; inativar é o caminho de "remoção" e preserva histórico;
 * - toda escrita grava o evento na MESMA transação (R8), com antes/depois.
 */

export interface EntradaEmpresa {
  razaoSocial: string;
  /** 14 dígitos normalizados (já validados pelo schema da requisição). */
  cnpj: string;
  situacao?: SituacaoEmpresa;
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.startsWith('SQLITE_CONSTRAINT');
}

function paraSituacao(ativo: boolean): SituacaoEmpresa {
  return ativo ? 'ativa' : 'inativa';
}

/**
 * Cria uma empresa. CNPJ duplicado é recusado com 409 e mensagem específica
 * (CA-15); nada é persistido (a escrita e a trilha compartilham a transação).
 */
export async function criarEmpresa(db: AppDb, entrada: EntradaEmpresa, atorId: number): Promise<Empresa> {
  const ativo = (entrada.situacao ?? 'ativa') === 'ativa';
  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const inserida = tx
        .insert(empresa)
        .values({ razaoSocial: entrada.razaoSocial, cnpj: entrada.cnpj, ativo })
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'empresa.criacao',
        usuarioId: atorId,
        empresaId: inserida.id,
        objetoTipo: 'empresa',
        objetoId: String(inserida.id),
        dados: { razao_social: inserida.razaoSocial, cnpj: inserida.cnpj, situacao: paraSituacao(ativo) },
      });

      return inserida;
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(409, 'Já existe uma empresa cadastrada com este CNPJ.', 'cnpj_duplicado');
    }
    throw erro;
  }
}

export interface EntradaAtualizacaoEmpresa {
  razaoSocial?: string;
  cnpj?: string;
  situacao?: SituacaoEmpresa;
}

/**
 * Altera razão social, CNPJ e/ou situação (H13: ativa/inativa, sem exclusão).
 * Grava `empresa.alteracao` com os campos antes/depois na mesma transação.
 */
export async function atualizarEmpresa(
  db: AppDb,
  empresaId: number,
  entrada: EntradaAtualizacaoEmpresa,
  atorId: number,
): Promise<Empresa> {
  const atual = await buscarEmpresaPorId(db, empresaId);
  if (!atual) {
    throw new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada');
  }

  const mudancas: Record<string, unknown> = {};
  if (entrada.razaoSocial !== undefined && entrada.razaoSocial !== atual.razaoSocial) {
    mudancas['razao_social'] = { de: atual.razaoSocial, para: entrada.razaoSocial };
  }
  if (entrada.cnpj !== undefined && entrada.cnpj !== atual.cnpj) {
    mudancas['cnpj'] = { de: atual.cnpj, para: entrada.cnpj };
  }
  if (entrada.situacao !== undefined && paraSituacao(atual.ativo) !== entrada.situacao) {
    mudancas['situacao'] = { de: paraSituacao(atual.ativo), para: entrada.situacao };
  }

  if (Object.keys(mudancas).length === 0) return atual;

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const alterada = tx
        .update(empresa)
        .set({
          ...(entrada.razaoSocial !== undefined ? { razaoSocial: entrada.razaoSocial } : {}),
          ...(entrada.cnpj !== undefined ? { cnpj: entrada.cnpj } : {}),
          ...(entrada.situacao !== undefined ? { ativo: entrada.situacao === 'ativa' } : {}),
          atualizadoEm: new Date().toISOString(),
        })
        .where(eq(empresa.id, empresaId))
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'empresa.alteracao',
        usuarioId: atorId,
        empresaId,
        objetoTipo: 'empresa',
        objetoId: String(empresaId),
        dados: mudancas,
      });

      return alterada;
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(409, 'Já existe uma empresa cadastrada com este CNPJ.', 'cnpj_duplicado');
    }
    throw erro;
  }
}

/** Busca por id; `undefined` quando não existe. */
export async function buscarEmpresaPorId(db: AppDb, empresaId: number): Promise<Empresa | undefined> {
  const linhas = await db.select().from(empresa).where(eq(empresa.id, empresaId));
  return linhas[0];
}

/** Lista todas as empresas em ordem de id (visão global do administrador). */
export async function listarTodasEmpresas(db: AppDb): Promise<Empresa[]> {
  return db.select().from(empresa).orderBy(asc(empresa.id));
}

/** Lista somente as empresas informadas (visão do contador: só atribuídas). */
export async function listarEmpresasAtribuidas(db: AppDb, empresaIds: number[]): Promise<Empresa[]> {
  if (empresaIds.length === 0) return [];
  const linhas = await db.select().from(empresa).orderBy(asc(empresa.id));
  const conjunto = new Set(empresaIds);
  return linhas.filter((linha) => conjunto.has(linha.id));
}
