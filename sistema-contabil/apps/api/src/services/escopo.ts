import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import { usuarioEmpresa, type Usuario } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';

/**
 * Escopo de tenant (RF-04, R7, ADR-0001 §2).
 *
 * O escopo `{ usuario, empresa_ids }` vem SEMPRE do banco (sessão + tabela
 * `usuario_empresa`, lidos a cada requisição). Um `empresa_id` enviado no
 * corpo/URL da requisição é tratado como **solicitação**: só é aceito se
 * existir atribuição vigente correspondente; caso contrário a tentativa é
 * recusada com resposta genérica (sem expor dados de outra empresa) e pode ser
 * auditada pelo chamador.
 *
 * A leitura global auditada do administrador (F13/CA-34) e as recusas
 * auditadas de escrita contábil estão em `services/permissoes.ts` (TASK-012);
 * `resolverEscopoEmpresa` permanece como utilitário síncrono de escopo puro.
 */

export interface EscopoUsuario {
  usuario: Usuario;
  /** Atribuições vigentes no banco, lidas nesta requisição (sem cache). */
  empresaIds: number[];
}

/** Lê as empresas atribuídas ao usuário no banco. */
export async function carregarAtribuicoes(db: AppDb, usuarioId: number): Promise<number[]> {
  const linhas = await db
    .select({ empresaId: usuarioEmpresa.empresaId })
    .from(usuarioEmpresa)
    .where(eq(usuarioEmpresa.usuarioId, usuarioId));
  return linhas.map((linha) => linha.empresaId);
}

/**
 * Autoriza a empresa solicitada contra as atribuições vigentes e devolve o
 * `empresa_id` que a requisição deve usar (o do servidor, nunca o enviado).
 * Recusa genérica quando o usuário não está atribuído à empresa.
 */
export function resolverEscopoEmpresa(
  escopo: Pick<EscopoUsuario, 'empresaIds'>,
  empresaIdSolicitado: number,
): number {
  if (!escopo.empresaIds.includes(empresaIdSolicitado)) {
    throw new ErroAplicacao(403, 'Acesso negado: usuário sem acesso a esta empresa.');
  }
  return empresaIdSolicitado;
}
