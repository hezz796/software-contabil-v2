import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import { sessao, usuario, type Usuario } from '../db/schema.ts';
import { carregarAtribuicoes } from './escopo.ts';
import { transacaoComAuditoria, type DbTransacao } from './auditoria.ts';

/** Nome do cookie de sessão (HttpOnly, assinado com `SESSION_SECRET`). */
export const COOKIE_SESSAO = 'sessao';

/**
 * Sessão autenticada resolvida para a requisição corrente (ADR-0001).
 * `empresaIds` vem da `usuario_empresa` lida AGORA — nunca do cliente.
 */
export interface Autenticacao {
  sessaoId: string;
  usuario: Usuario;
  empresaIds: number[];
}

/**
 * Cria a linha de sessão dentro da transação recebida (token opaco de 32 bytes
 * em base64url; a expiração segue `SESSION_TTL_MINUTES`, H14).
 */
export function inserirSessao(
  tx: DbTransacao,
  usuarioId: number,
  ttlMinutos: number,
): { sessaoId: string; expiraEm: string } {
  const sessaoId = randomBytes(32).toString('base64url');
  const criadaEm = new Date();
  const expiraEm = new Date(criadaEm.getTime() + ttlMinutos * 60_000);

  tx.insert(sessao)
    .values({
      id: sessaoId,
      usuarioId,
      criadaEm: criadaEm.toISOString(),
      expiraEm: expiraEm.toISOString(),
    })
    .prepare()
    .run();

  return { sessaoId, expiraEm: expiraEm.toISOString() };
}

/**
 * Valida a sessão **a cada requisição** (sem cache): token existe, não expirou
 * e o usuário continua ativo (R10/CA-22/CA-37). As atribuições também são
 * relidas aqui, então remoção de empresa vale imediatamente (CA-37).
 */
export async function carregarAutenticacao(
  db: AppDb,
  sessaoId: string,
): Promise<Autenticacao | null> {
  const agora = new Date().toISOString();

  const linhas = await db
    .select()
    .from(sessao)
    .innerJoin(usuario, eq(sessao.usuarioId, usuario.id))
    .where(and(eq(sessao.id, sessaoId), gt(sessao.expiraEm, agora), eq(usuario.ativo, true)));

  const linha = linhas[0];
  if (!linha) return null;

  const empresaIds = await carregarAtribuicoes(db, linha.usuario.id);
  return { sessaoId, usuario: linha.usuario, empresaIds };
}

/** Encerra a sessão (logout), gravando o evento na mesma transação do delete. */
export function encerrarSessao(db: AppDb, autenticacao: Autenticacao): void {
  transacaoComAuditoria(db, (tx, auditoria) => {
    tx.delete(sessao)
      .where(eq(sessao.id, autenticacao.sessaoId))
      .prepare()
      .run();
    auditoria.registrar({
      acao: 'logout',
      usuarioId: autenticacao.usuario.id,
      dados: { email: autenticacao.usuario.email },
    });
  });
}
