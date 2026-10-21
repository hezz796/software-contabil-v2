import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ErroAplicacao } from '../errors.ts';
import { COOKIE_SESSAO, carregarAutenticacao, type Autenticacao } from '../services/sessao.ts';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Sessão resolvida para a requisição corrente. Preenchida pelo
     * `preHandler` `exigirAutenticacao`; `null` quando ainda não validada.
     * O escopo (`empresaIds`) é relido do banco a cada requisição — sem cache.
     */
    autenticacao: Autenticacao | null;
  }
}

/**
 * Registra o decorator de request (chamado por `buildApp` antes das rotas).
 * Sem isso, `request.autenticacao` não existiria na primeira requisição.
 */
export function registrarAutenticacao(app: FastifyInstance): void {
  app.decorateRequest('autenticacao', null);
}

/** Lê e valida a assinatura do cookie de sessão; inválido => `null`. */
function lerTokenSessao(request: FastifyRequest): string | null {
  const bruto = request.cookies[COOKIE_SESSAO];
  if (!bruto) return null;

  const assinatura = request.unsignCookie(bruto);
  if (!assinatura.valid || !assinatura.value) return null;
  return assinatura.value;
}

/**
 * Exige sessão válida: token assinado existe, sessão não expirou (H14) e o
 * usuário está ativo — consultado **nesta requisição** (R10/CA-22).
 * Sem sessão, toda rota de dados é negada (CA-18).
 */
export const exigirAutenticacao: preHandlerHookHandler = async (request) => {
  if (request.autenticacao) return;

  const sessaoId = lerTokenSessao(request);
  if (!sessaoId) {
    throw new ErroAplicacao(401, 'Sessão ausente ou inválida.', 'sessao_ausente');
  }

  const autenticacao = await carregarAutenticacao(request.server.db, sessaoId);
  if (!autenticacao) {
    throw new ErroAplicacao(401, 'Sessão expirada ou usuário sem acesso ativo.', 'sessao_invalida');
  }

  request.autenticacao = autenticacao;
};

/** Recupera a autenticação garantindo que `exigirAutenticacao` já executou. */
export function autenticacaoDe(request: FastifyRequest): Autenticacao {
  const autenticacao = request.autenticacao;
  if (!autenticacao) {
    throw new ErroAplicacao(401, 'Sessão ausente ou inválida.', 'sessao_ausente');
  }
  return autenticacao;
}
