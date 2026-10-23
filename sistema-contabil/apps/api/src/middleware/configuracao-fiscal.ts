import type { preHandlerHookHandler } from 'fastify';
import { ErroAplicacao } from '../errors.ts';
import { autorizarConfiguracaoFiscal, type ContextoRecusa } from '../services/permissoes.ts';
import { autenticacaoDe } from './auth.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * `empresa_id` resolvido no SERVIDOR para CONFIGURAÇÃO fiscal (TASK-017).
     * Configuração administrativa auditada, não escrita contábil (RF-02/RF-20,
     * CA-54): o valor enviado pelo cliente é só solicitação, como no guard de
     * escrita contábil.
     */
    configuracaoFiscalEmpresaId: number | null;
  }
}

/**
 * Exige autorização de CONFIGURAÇÃO fiscal (RF-02/RF-20, CA-54/CE-21):
 *
 * - administrador ou contador **atribuído** à empresa (CA-54a: contador não
 *   atribuído é recusado auditado; CA-54b: admin é permitido);
 * - `empresa_id` aceito de `body.empresa_id` ou `query.empresa_id` como
 *   **solicitação** — o valor resolvido fica em
 *   `request.configuracaoFiscalEmpresaId`.
 *
 * Uso: `{ preHandler: [exigirAutenticacao, exigirConfiguracaoFiscal({ objeto: 'tabela_imposto' })] }`.
 * A ALTERAÇÃO em si é auditada pelo serviço com valores antigo/novo (CA-54b).
 */
export function exigirConfiguracaoFiscal(contexto: { objeto: string }): preHandlerHookHandler {
  return async (request) => {
    const autenticacao = autenticacaoDe(request);

    const corpo = request.body as { empresa_id?: unknown } | undefined | null;
    const query = request.query as { empresa_id?: unknown } | undefined | null;
    const bruto = corpo?.empresa_id ?? query?.empresa_id;

    const empresaId = Number(bruto);
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      throw new ErroAplicacao(
        400,
        'Informe a empresa (empresa_id) na qual a configuração deve ser gravada.',
        'empresa_id_ausente',
      );
    }

    const recusa: ContextoRecusa = {
      objeto: contexto.objeto,
      rota: `${request.method} ${request.url}`,
    };
    request.configuracaoFiscalEmpresaId = await autorizarConfiguracaoFiscal(
      request.server.db,
      autenticacao,
      empresaId,
      recusa,
    );
  };
}
