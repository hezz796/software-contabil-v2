import type { preHandlerHookHandler } from 'fastify';
import { ErroAplicacao } from '../errors.ts';
import { autorizarEscritaContabil, type ContextoRecusa } from '../services/permissoes.ts';
import { autenticacaoDe } from './auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * `empresa_id` resolvido no SERVIDOR para escrita contábil (TASK-012).
     * O valor enviado pelo cliente é só solicitação; as rotas de escrita
     * contábil (lançamentos, títulos, baixas — TASK-014+) devem usar
     * **este** valor, nunca o do corpo/URL (RF-04/ADR-0001 §isolamento).
     */
    escritaContabilEmpresaId: number | null;
  }
}

/**
 * Exige autorização de ESCRITA contábil (F13/RF-04, CA-33/35/36/40):
 *
 * - papel contador **atribuído** à empresa (admin é recusado auditado);
 * - empresa existente e **ativa** (CA-40; inativa mantém só leitura);
 * - `empresa_id` aceito de `body.empresa_id` ou `query.empresa_id` como
 *   **solicitação** — recusado com 403 auditado se não houver atribuição
 *   vigente (CA-35: corpo adulterado; CA-36: requisição direta com ID alheio).
 *
 * Em sucesso decora `request.escritaContabilEmpresaId` com o id resolvido.
 * Uso: `{ preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'lancamento' })] }`.
 */
export function exigirEscritaContabil(contexto: { objeto: string }): preHandlerHookHandler {
  return async (request) => {
    const autenticacao = autenticacaoDe(request);

    const corpo = request.body as { empresa_id?: unknown } | undefined | null;
    const query = request.query as { empresa_id?: unknown } | undefined | null;
    const bruto = corpo?.empresa_id ?? query?.empresa_id;

    const empresaId = Number(bruto);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      throw new ErroAplicacao(
        400,
        'Informe a empresa (empresa_id) na qual a operação deve ser gravada.',
        'empresa_id_ausente',
      );
    }

    const recusa: ContextoRecusa = {
      objeto: contexto.objeto,
      rota: `${request.method} ${request.url}`,
    };
    request.escritaContabilEmpresaId = await autorizarEscritaContabil(
      request.server.db,
      autenticacao,
      empresaId,
      recusa,
    );
  };
}
