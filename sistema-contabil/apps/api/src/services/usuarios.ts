import { and, asc, eq } from 'drizzle-orm';
import { emailSchema, papelSchema, senhaSchema } from '@sistema-contabil/shared';
import type { AppDb } from '../db/index.ts';
import { empresa, usuario, usuarioEmpresa, type Papel } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { transacaoComAuditoria } from './auditoria.ts';
import { gerarHashSenha } from './senha.ts';

/**
 * Cadastro de usuário (RF-02/RF-19/RF-03).
 *
 * As funções de CRUD/situação são usadas pela rota de gestão do
 * administrador (`routes/gestao-usuarios.ts`, TASK-012) e pelos testes.
 *
 * Política de senha (H15/CA-50) aplicada em toda criação/alteração, e toda
 * escrita grava o evento correspondente na MESMA transação (R8).
 */

export interface EntradaNovoUsuario {
  email: string;
  senha: string;
  papel: Papel;
  /** Quem executou a criação (gestão do admin); ausente = auto-criação (fixtures). */
  atorId?: number;
  /** Atribuições iniciais (validadas contra a tabela `empresa`). */
  empresaIds?: number[];
}

export interface UsuarioCriado {
  id: number;
  email: string;
  papel: Papel;
  ativo: boolean;
}

/** Normaliza o e-mail para comparações estáveis (minúsculas, sem espaços). */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ehViolacaoDeUnicidade(erro: unknown): boolean {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === 'string' && codigo.startsWith('SQLITE_CONSTRAINT');
}

/**
 * Cria um usuário: valida e-mail/papel e aplica a política de senha (>= 8
 * caracteres, H15), com hash Argon2id. Recusa e-mail já cadastrado (409).
 */
export async function criarUsuario(db: AppDb, entrada: EntradaNovoUsuario): Promise<UsuarioCriado> {
  const email = emailSchema.parse(normalizarEmail(entrada.email));
  // CA-50: senha < 8 caracteres recusada com mensagem citando a política (H15).
  const senha = senhaSchema.parse(entrada.senha);
  const papel = papelSchema.parse(entrada.papel);
  const senhaHash = await gerarHashSenha(senha);

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const inserido = tx
        .insert(usuario)
        .values({ email, senhaHash, papel, ativo: true, failedLogins: 0, lockedUntil: null })
        .prepare()
        .run();

      const id = Number(inserido.lastInsertRowid);

      // Atribuições iniciais (RF-02): empresa inexistente aborta a transação
      // inteira (nada persistido, nem o usuário).
      for (const empresaId of entrada.empresaIds ?? []) {
        const existe = tx.select({ id: empresa.id }).from(empresa).where(eq(empresa.id, empresaId)).all();
        if (existe.length === 0) {
          throw new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada');
        }
        tx.insert(usuarioEmpresa)
          .values({ usuarioId: id, empresaId })
          .prepare()
          .run();
        auditoria.registrar({
          acao: 'usuario.atribuicao_empresa',
          usuarioId: entrada.atorId ?? id,
          empresaId,
          objetoTipo: 'usuario',
          objetoId: String(id),
          dados: { atribuida_por: entrada.atorId ?? null },
        });
      }

      auditoria.registrar({
        acao: 'usuario.criacao',
        usuarioId: entrada.atorId ?? id,
        objetoTipo: 'usuario',
        objetoId: String(id),
        dados: { email, papel, empresa_ids: entrada.empresaIds ?? [] },
      });

      return { id, email, papel, ativo: true };
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(409, 'Já existe um usuário com este e-mail.', 'email_duplicado');
    }
    throw erro;
  }
}

/** Busca por e-mail normalizado; `undefined` quando não existe. */
export async function buscarUsuarioPorEmail(
  db: AppDb,
  email: string,
): Promise<(typeof usuario.$inferSelect) | undefined> {
  const linhas = await db
    .select()
    .from(usuario)
    .where(eq(usuario.email, normalizarEmail(email)));
  return linhas[0];
}

export interface EntradaSituacaoUsuario {
  usuarioId: number;
  ativo: boolean;
  /** Quem executou a alteração (para a trilha); quando ausente, o próprio usuário. */
  atorId?: number | null;
}

/**
 * Ativa/desativa um usuário (RF-03/R10). A desativação tem efeito já na
 * requisição seguinte porque toda sessão confere `usuario.ativo` — ver CA-22.
 */
export async function definirUsuarioAtivo(
  db: AppDb,
  entrada: EntradaSituacaoUsuario,
): Promise<void> {
  transacaoComAuditoria(db, (tx, auditoria) => {
    const atualizado = tx
      .update(usuario)
      .set({ ativo: entrada.ativo })
      .where(eq(usuario.id, entrada.usuarioId))
      .prepare()
      .run();

    if (atualizado.changes === 0) {
      throw new ErroAplicacao(404, 'Usuário não encontrado.', 'usuario_nao_encontrado');
    }

    auditoria.registrar({
      acao: entrada.ativo ? 'usuario.ativacao' : 'usuario.desativacao',
      usuarioId: entrada.atorId ?? entrada.usuarioId,
      objetoTipo: 'usuario',
      objetoId: String(entrada.usuarioId),
      dados: { ativo: entrada.ativo },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Gestão de usuários pelo administrador (RF-02, TASK-012)                     */
/* -------------------------------------------------------------------------- */

/** Linha de usuário por id (gestão); `undefined` quando não existe. */
export async function buscarUsuarioPorId(db: AppDb, usuarioId: number): Promise<(typeof usuario.$inferSelect) | undefined> {
  const linhas = await db.select().from(usuario).where(eq(usuario.id, usuarioId));
  return linhas[0];
}

/** Atribuições vigentes de um usuário (ordem estável por empresa). */
export async function listarAtribuicoes(db: AppDb, usuarioId: number): Promise<number[]> {
  const linhas = await db
    .select({ empresaId: usuarioEmpresa.empresaId })
    .from(usuarioEmpresa)
    .where(eq(usuarioEmpresa.usuarioId, usuarioId))
    .orderBy(asc(usuarioEmpresa.empresaId));
  return linhas.map((linha) => linha.empresaId);
}

/** Lista de usuários com as atribuições (visão de gestão; sem senha). */
export async function listarUsuarios(db: AppDb): Promise<
  Array<(typeof usuario.$inferSelect) & { empresaIds: number[] }>
> {
  const todos = await db.select().from(usuario).orderBy(asc(usuario.id));
  const atribuicoes = await db.select().from(usuarioEmpresa).orderBy(asc(usuarioEmpresa.empresaId));
  return todos.map((linha) => ({
    ...linha,
    empresaIds: atribuicoes
      .filter((atribuicao) => atribuicao.usuarioId === linha.id)
      .map((atribuicao) => atribuicao.empresaId),
  }));
}

export interface EntradaAtualizacaoUsuario {
  email?: string;
  senha?: string;
  papel?: Papel;
  atorId: number;
}

/**
 * Altera e-mail, senha e/ou papel (RF-02). Senha nova passa pela política H15
 * e pelo hash Argon2id; a trilha registra os campos alterados **nunca** a
 * senha (nem hash).
 */
export async function atualizarUsuario(
  db: AppDb,
  usuarioId: number,
  entrada: EntradaAtualizacaoUsuario,
): Promise<void> {
  const atual = await buscarUsuarioPorId(db, usuarioId);
  if (!atual) {
    throw new ErroAplicacao(404, 'Usuário não encontrado.', 'usuario_nao_encontrado');
  }

  const mudancas: Record<string, unknown> = {};
  let novoEmail = atual.email;
  if (entrada.email !== undefined) {
    novoEmail = emailSchema.parse(normalizarEmail(entrada.email));
    if (novoEmail !== atual.email) mudancas['email'] = { de: atual.email, para: novoEmail };
  }
  let novoPapel = atual.papel;
  if (entrada.papel !== undefined) {
    novoPapel = papelSchema.parse(entrada.papel);
    if (novoPapel !== atual.papel) mudancas['papel'] = { de: atual.papel, para: novoPapel };
  }
  let novaSenhaHash: string | null = null;
  if (entrada.senha !== undefined) {
    senhaSchema.parse(entrada.senha);
    novaSenhaHash = await gerarHashSenha(entrada.senha);
    mudancas['senha'] = 'alterada';
  }

  if (Object.keys(mudancas).length === 0) return;

  try {
    transacaoComAuditoria(db, (tx, auditoria) => {
      tx.update(usuario)
        .set({
          email: novoEmail,
          papel: novoPapel,
          ...(novaSenhaHash !== null ? { senhaHash: novaSenhaHash } : {}),
        })
        .where(eq(usuario.id, usuarioId))
        .prepare()
        .run();

      auditoria.registrar({
        acao: 'usuario.alteracao',
        usuarioId: entrada.atorId,
        objetoTipo: 'usuario',
        objetoId: String(usuarioId),
        dados: mudancas,
      });
    });
  } catch (erro) {
    if (ehViolacaoDeUnicidade(erro)) {
      throw new ErroAplicacao(409, 'Já existe um usuário com este e-mail.', 'email_duplicado');
    }
    throw erro;
  }
}

/**
 * Atribui uma empresa ao usuário (RF-02). Empresa inexistente => 404; já
 * atribuída => no-op auditado apenas se houver mudança real (idempotente).
 */
export async function atribuirEmpresa(
  db: AppDb,
  usuarioId: number,
  empresaId: number,
  atorId: number,
): Promise<void> {
  transacaoComAuditoria(db, (tx, auditoria) => {
    const conta = tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.id, usuarioId)).all();
    if (conta.length === 0) {
      throw new ErroAplicacao(404, 'Usuário não encontrado.', 'usuario_nao_encontrado');
    }
    const empresaExiste = tx.select({ id: empresa.id }).from(empresa).where(eq(empresa.id, empresaId)).all();
    if (empresaExiste.length === 0) {
      throw new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada');
    }

    const existente = tx
      .select()
      .from(usuarioEmpresa)
      .where(eq(usuarioEmpresa.usuarioId, usuarioId))
      .all()
      .some((linha) => linha.empresaId === empresaId);
    if (existente) return;

    tx.insert(usuarioEmpresa).values({ usuarioId, empresaId }).prepare().run();
    auditoria.registrar({
      acao: 'usuario.atribuicao_empresa',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'usuario',
      objetoId: String(usuarioId),
      dados: { atribuida_por: atorId },
    });
  });
}

/**
 * Remove a atribuição de uma empresa (RF-02/R10). A remoção tem efeito
 * IMEDIATO na tentativa seguinte (CA-37) porque o escopo é relido do banco a
 * cada requisição — sem novo login.
 */
export async function removerAtribuicao(
  db: AppDb,
  usuarioId: number,
  empresaId: number,
  atorId: number,
): Promise<void> {
  transacaoComAuditoria(db, (tx, auditoria) => {
    const removido = tx
      .delete(usuarioEmpresa)
      .where(and(eq(usuarioEmpresa.usuarioId, usuarioId), eq(usuarioEmpresa.empresaId, empresaId)))
      .prepare()
      .run();

    if (removido.changes === 0) {
      throw new ErroAplicacao(404, 'Atribuição não encontrada.', 'atribuicao_nao_encontrada');
    }

    auditoria.registrar({
      acao: 'usuario.remocao_atribuicao',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'usuario',
      objetoId: String(usuarioId),
      dados: { removida_por: atorId, efeito: 'imediato' },
    });
  });
}
