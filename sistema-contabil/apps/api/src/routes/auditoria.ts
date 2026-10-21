import { auditoriaQuerySchema, auditoriaResponseSchema } from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { requerPapel } from '../middleware/papel.ts';
import { consultarTrilha, paraEventoDTO } from '../services/auditoria.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';

/**
 * Consulta da trilha de auditoria (RF-05, CA-21, CA-34, CA-39).
 *
 * - Papel **somente administrador**: contador recebe 403 (CA-21).
 * - Filtros por empresa e período; o `empresa_id` da query é apenas uma
 *   solicitação. O administrador tem **leitura global auditada** (F13/CA-34,
 *   TASK-012): pode consultar a trilha de qualquer empresa existente, e o
 *   acesso a empresa fora das atribuições é registrado na trilha
 *   (`escopo.leitura_global`). Antes da T012 a leitura era restrita às
 *   atribuídas; a mudança (global auditada) é comportamento pretendido de F13.
 * - Somente leitura: não existem rotas de UPDATE/DELETE da trilha (CA-38).
 */
export const auditoriaRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/auditoria',
    { preHandler: [exigirAutenticacao, requerPapel('administrador')] },
    async (request) => {
      const autenticacao = autenticacaoDe(request);
      const filtros = auditoriaQuerySchema.parse(request.query);

      await autorizarLeituraEmpresa(app.db, autenticacao, filtros.empresa_id, {
        objeto: 'trilha_auditoria',
        rota: 'GET /auditoria',
      });
      const linhas = await consultarTrilha(app.db, {
        empresaId: filtros.empresa_id,
        de: filtros.de,
        ate: filtros.ate,
      });

      return auditoriaResponseSchema.parse({ eventos: linhas.map(paraEventoDTO) });
    },
  );
};
