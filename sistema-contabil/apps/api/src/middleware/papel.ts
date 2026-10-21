import type { preHandlerHookHandler } from 'fastify';
import type { Papel } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe } from './auth.ts';

/**
 * Verificação de papel reutilizável (RF-02): use depois de `exigirAutenticacao`
 * no `preHandler` da rota.
 *
 * ```ts
 * { preHandler: [exigirAutenticacao, requerPapel('administrador')] }
 * ```
 *
 * Recusa com 403 genérica quando o papel não está entre os aceitos (ex.:
 * contador tentando consultar a trilha, CA-21).
 */
export function requerPapel(...papeis: Papel[]): preHandlerHookHandler {
  return async (request) => {
    const { usuario } = autenticacaoDe(request);
    if (!papeis.includes(usuario.papel)) {
      throw new ErroAplicacao(403, 'Permissão negada para este recurso.', 'papel_insuficiente');
    }
  };
}
