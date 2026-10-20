import path from 'node:path';
import { z } from 'zod';

/** Raiz do pacote da API (`apps/api`), usada para resolver caminhos relativos. */
const API_ROOT = path.resolve(import.meta.dirname, '..');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_PATH: z.string().min(1).default('data/sistema-contabil.db'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_SECRET: z.string().min(16).default('segredo-de-desenvolvimento-trocar'),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(720),
});

export type NodeEnv = z.infer<typeof envSchema>['NODE_ENV'];
export type LogLevel = z.infer<typeof envSchema>['LOG_LEVEL'];

export interface AppConfig {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  /** Caminho absoluto do arquivo SQLite. Relativos são resolvidos a partir de `apps/api`. */
  databasePath: string;
  logLevel: LogLevel;
  /** Usado na autenticação por sessão em cookie assinado (H14) — vem na TASK-011. */
  sessionSecret: string;
  /** Expiração da sessão em minutos (H14) — usado na TASK-011. */
  sessionTtlMinutes: number;
}

/**
 * Lê e valida as variáveis de ambiente. Lança `Error` com o detalhe de cada
 * variável inválida (não imprime valores, para não vazar segredos).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variáveis de ambiente inválidas: ${detalhes}`);
  }

  const dados = parsed.data;
  return {
    nodeEnv: dados.NODE_ENV,
    host: dados.HOST,
    port: dados.PORT,
    databasePath: path.isAbsolute(dados.DATABASE_PATH)
      ? dados.DATABASE_PATH
      : path.resolve(API_ROOT, dados.DATABASE_PATH),
    logLevel: dados.LOG_LEVEL,
    sessionSecret: dados.SESSION_SECRET,
    sessionTtlMinutes: dados.SESSION_TTL_MINUTES,
  };
}
