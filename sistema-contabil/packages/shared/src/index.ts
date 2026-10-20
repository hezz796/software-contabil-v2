import { z } from 'zod';

/**
 * Base de tipos e validações compartilhados entre `apps/api` e `apps/web`.
 *
 * Esta tarefa só cria a fundação: nenhum tipo de domínio aqui (plano de contas,
 * lançamentos etc. vêm nas TASK-011+).
 *
 * Convenções do projeto (ADR-0001):
 * - valores em dinheiro são inteiros em **centavos** (`*_centavos`), nunca float;
 * - interface em pt-BR.
 */

/** Resposta de `GET /health` da API. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
