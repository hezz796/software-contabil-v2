import path from 'node:path';
import { z } from 'zod';

/** Raiz do pacote da API (`apps/api`), usada para resolver caminhos relativos. */
const API_ROOT = path.resolve(import.meta.dirname, '..');

/** Aceita `true|false|1|0`; ausente => valor derivado de `NODE_ENV`. */
const booleanEnv = z.enum(['true', 'false', '1', '0']).transform((valor) => valor === 'true' || valor === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_PATH: z.string().min(1).default('data/sistema-contabil.db'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_SECRET: z.string().min(16).default('segredo-de-desenvolvimento-trocar'),
  /** Expiração da sessão por inatividade (H14): ~30 min, configurável. */
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  /** `Secure` no cookie de sessão: padrão ligado só em produção. */
  SESSION_COOKIE_SECURE: booleanEnv.optional(),
  /** Tentativas de login falhas antes do bloqueio (H16). */
  LOGIN_MAX_TENTATIVAS: z.coerce.number().int().positive().default(5),
  /** Duração do bloqueio temporário de login em minutos (H16). */
  LOGIN_BLOQUEIO_MINUTOS: z.coerce.number().int().positive().default(15),
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
  /** Usado para assinar o cookie de sessão (ADR-0001/H14). */
  sessionSecret: string;
  /** Expiração da sessão em minutos (H14: ~30 min de inatividade). */
  sessionTtlMinutes: number;
  /** `Secure` no cookie de sessão (ligado por env; padrão em produção). */
  sessionCookieSecure: boolean;
  /** Tentativas de login falhas antes do bloqueio (H16: 5). */
  loginMaxTentativas: number;
  /** Duração do bloqueio temporário de login, em minutos (H16). */
  loginBloqueioMinutos: number;
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
    sessionCookieSecure: dados.SESSION_COOKIE_SECURE ?? dados.NODE_ENV === 'production',
    loginMaxTentativas: dados.LOGIN_MAX_TENTATIVAS,
    loginBloqueioMinutos: dados.LOGIN_BLOQUEIO_MINUTOS,
  };
}
