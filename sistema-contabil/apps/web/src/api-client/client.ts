import type { HealthResponse } from '@sistema-contabil/shared';

export type { HealthResponse };

/**
 * Base do cliente HTTP tipado da API (estrutura do ADR-0001).
 *
 * Ainda não há chamada de domínio nem proxy configurado no dev: autenticação,
 * endpoints e integração UI→API vêm nas próximas tarefas (TASK-011+), com o
 * proxy/CORS devidamente documentado em `sistema-contabil/README.md`.
 */
export async function fetchHealth(baseUrl = ''): Promise<HealthResponse> {
  const resposta = await fetch(`${baseUrl}/health`);
  if (!resposta.ok) {
    throw new Error(`Health check falhou com status ${resposta.status}`);
  }
  return (await resposta.json()) as HealthResponse;
}
