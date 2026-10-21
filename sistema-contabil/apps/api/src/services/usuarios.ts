import { eq } from 'drizzle-orm';
import { emailSchema, papelSchema, senhaSchema } from '@sistema-contabil/shared';
import type { AppDb } from '../db/index.ts';
import { usuario, type Papel } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { transacaoComAuditoria } from './auditoria.ts';
import { gerarHashSenha } from './senha.ts';

/**
 * Cadastro de usuário (RF-02/RF-19/RF-03).
 *
 * As funções desta etapa são **internas de serviço**: o CRUD exposto por HTTP
 * (criar/editar/desativar usuários, atribuir empresas) vem na TASK-012. Os
 * testes da TASK-011 as usam como fixtures.
 *
 * Política de senha (H15/CA-50) aplicada em toda criação/alteração, e toda
 * escrita grava o evento correspondente na MESMA transação (R8).
 */

export interface EntradaNovoUsuario {
  email: string;
  senha: string;
  papel: Papel;
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
      auditoria.registrar({
        acao: 'usuario.criacao',
        usuarioId: id,
        objetoTipo: 'usuario',
        objetoId: String(id),
        dados: { email, papel },
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
