import type { FastifyInstance } from 'fastify';
import { exigirAutenticacao } from '../../src/middleware/auth.ts';
import { exigirEscritaContabil } from '../../src/middleware/escrita-contabil.ts';

/**
 * Rota-exemplo de escrita contábil para os testes da TASK-012.
 *
 * As rotas reais de lançamento/título vêm nas TASK-014/TASK-016; aqui o que
 * se verifica é o **guard de permissão do produto** — `exigirEscritaContabil`
 * (F13/RF-04/CA-33/35/36/40). A rota-exemplo usa exatamente o mesmo preHandler
 * que as rotas reais usarão, então as recusas auditadas testadas aqui valem
 * para o produto.
 *
 * Registrada APÓS `createTestApp` e ANTES do primeiro `inject` (Fastify ainda
 * não congelou as rotas).
 */
export function registrarRotaEscritaExemplo(app: FastifyInstance): void {
  app.post(
    '/lancamentos-exemplo',
    { preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'lancamento' })] },
    async (request) => ({
      ok: true,
      // O escopo vem do SERVIDOR (decorado pelo guard), nunca do corpo.
      empresa_id: request.escritaContabilEmpresaId,
      historico: (request.body as { historico?: string }).historico ?? null,
    }),
  );
}
