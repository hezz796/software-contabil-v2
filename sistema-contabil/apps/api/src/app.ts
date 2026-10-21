import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';
import { erroResponseSchema } from '@sistema-contabil/shared';
import { loadConfig, type AppConfig } from './config.ts';
import type { AppDb } from './db/index.ts';
import { ErroAplicacao } from './errors.ts';
import { registrarAutenticacao } from './middleware/auth.ts';
import { auditoriaRoutes } from './routes/auditoria.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoutes } from './routes/health.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Conexão Drizzle do request (camada de dados injetada; ver `src/db`). */
    db: AppDb;
    /** Configuração validada (env) — TTL de sessão, bloqueio de login, etc. */
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  db: AppDb;
  logger?: FastifyServerOptions['logger'];
  /** Usa `loadConfig()` (process.env) quando omitido. */
  config?: AppConfig;
}

/**
 * Monta a instância do Fastify sem escutar porta: usada pelo bootstrap
 * (`src/index.ts`) e pelos testes de integração (via `Fastify.inject`).
 *
 * Infraestrutura + rotas de segurança da TASK-011 (login/logout/me,
 * trilha de auditoria); demais rotas de domínio entram nas TASK-012+.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(fastifyCookie, { secret: config.sessionSecret });
  app.decorate('db', options.db);
  app.decorate('config', config);
  registrarAutenticacao(app);

  // Resposta de erro padrão `{ erro }`; detalhes internos só no log.
  app.setErrorHandler((erro: unknown, request, reply) => {
    if (erro instanceof ErroAplicacao) {
      return reply.status(erro.statusCode).send({ erro: erro.message });
    }
    if (ehZodError(erro)) {
      const detalhes = erro.issues.map((issue) => issue.message).join('; ');
      return reply.status(400).send({ erro: `Dados inválidos: ${detalhes}` });
    }
    if (ehErroDeRequisicao(erro)) {
      return reply.status(erro.statusCode).send({ erro: erro.message });
    }
    request.log.error({ erro }, 'erro não tratado');
    return reply.status(500).send({ erro: 'Erro interno do servidor.' });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(erroResponseSchema.parse({ erro: 'Rota não encontrada.' })),
  );

  await app.register(authRoutes);
  await app.register(auditoriaRoutes);
  await app.register(healthRoutes);

  return app;
}

function ehZodError(erro: unknown): erro is ZodError {
  return erro instanceof ZodError;
}

/** Erro já mapeado para um status 4xx pela própria infraestrutura (Fastify). */
function ehErroDeRequisicao(
  erro: unknown,
): erro is { statusCode: number; message: string } {
  if (typeof erro !== 'object' || erro === null) return false;
  const candidato = erro as { statusCode?: unknown; message?: unknown };
  return (
    typeof candidato.statusCode === 'number' &&
    candidato.statusCode >= 400 &&
    candidato.statusCode < 500 &&
    typeof candidato.message === 'string'
  );
}
