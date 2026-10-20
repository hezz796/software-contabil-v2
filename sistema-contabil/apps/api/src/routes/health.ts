import { healthResponseSchema } from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { appMeta } from '../db/schema.ts';

/**
 * Única rota da fundação (sem regra de negócio): confirma que a API está no ar
 * e que o banco responde. O corpo é validado pelo schema compartilhado (Zod)
 * que também é consumido pelo web.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    const metadados = await app.db.select().from(appMeta);
    app.log.debug({ metadados: metadados.length }, 'health check');
    return healthResponseSchema.parse({ status: 'ok', database: 'ok' });
  });
};
