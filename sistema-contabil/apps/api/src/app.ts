import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { AppDb } from './db/index.ts';
import { healthRoutes } from './routes/health.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Conexão Drizzle do request (camada de dados injetada; ver `src/db`). */
    db: AppDb;
  }
}

export interface BuildAppOptions {
  db: AppDb;
  logger?: FastifyServerOptions['logger'];
}

/**
 * Monta a instância do Fastify sem escutar porta: usada pelo bootstrap
 * (`src/index.ts`) e pelos testes de integração (via `Fastify.inject`).
 * Só infraestrutura aqui — rotas de domínio entram nas TASK-011+.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(fastifyCookie);
  app.decorate('db', options.db);

  await app.register(healthRoutes);

  return app;
}
