import { auditoriaQuerySchema, auditoriaResponseSchema } from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { requerPapel } from '../middleware/papel.ts';
import { consultarTrilha, paraEventoDTO } from '../services/auditoria.ts';
import { resolverEscopoEmpresa } from '../services/escopo.ts';

/**
 * Consulta da trilha de auditoria (RF-05, CA-21, CA-39).
 *
 * - Papel **somente administrador**: contador recebe 403 (CA-21).
 * - Filtros por empresa e período; o `empresa_id` da query é apenas uma
 *   solicitação — o servidor autoriza contra `usuario_empresa` (RF-04) e usa o
 *   valor resolvido daqui. Período sem eventos devolve lista vazia (200).
 * - Somente leitura: não existem rotas de UPDATE/DELETE da trilha (CA-38).
 *   A leitura global do administrador (sem empresa atribuída) vem na TASK-012.
 */
export const auditoriaRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/auditoria',
    { preHandler: [exigirAutenticacao, requerPapel('administrador')] },
    async (request) => {
      const autenticacao = autenticacaoDe(request);
      const filtros = auditoriaQuerySchema.parse(request.query);

      const empresaId = resolverEscopoEmpresa(autenticacao, filtros.empresa_id);
      const linhas = await consultarTrilha(app.db, {
        empresaId,
        de: filtros.de,
        ate: filtros.ate,
      });

      return auditoriaResponseSchema.parse({ eventos: linhas.map(paraEventoDTO) });
    },
  );
};
