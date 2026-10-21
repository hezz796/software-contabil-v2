import {
  loginRequestSchema,
  loginResponseSchema,
  logoutResponseSchema,
  usuarioSessaoSchema,
  type UsuarioSessao,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppConfig } from '../config.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { autenticar } from '../services/autenticacao.ts';
import { COOKIE_SESSAO, encerrarSessao, type Autenticacao } from '../services/sessao.ts';

/**
 * Autenticação HTTP (RF-03, RF-19, H14/H16):
 *
 * - `POST /login` — credenciais validadas no banco; em sucesso emite cookie de
 *   sessão **HttpOnly + SameSite=Lax + assinado**, `Secure` quando configurado
 *   por env, com `Max-Age` igual ao TTL (H14). Falha não cria sessão (CA-19).
 * - `POST /logout` — apaga a sessão no banco (efeito imediato) e limpa o cookie.
 * - `GET /me` — devolve o usuário autenticado e o escopo vindo do banco.
 */

function opcoesCookie(config: AppConfig) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.sessionCookieSecure,
    signed: true,
    maxAge: config.sessionTtlMinutes * 60,
  };
}

function paraSessao(autenticacao: Autenticacao): UsuarioSessao {
  return {
    id: autenticacao.usuario.id,
    email: autenticacao.usuario.email,
    papel: autenticacao.usuario.papel,
    ativo: autenticacao.usuario.ativo,
    empresa_ids: autenticacao.empresaIds,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (request, reply) => {
    const dados = loginRequestSchema.parse(request.body);
    const autenticacao = await autenticar(app.db, app.config, dados);

    reply.setCookie(COOKIE_SESSAO, autenticacao.sessaoId, opcoesCookie(app.config));
    return loginResponseSchema.parse({ ok: true, usuario: paraSessao(autenticacao) });
  });

  app.post('/logout', { preHandler: [exigirAutenticacao] }, async (request, reply) => {
    encerrarSessao(app.db, autenticacaoDe(request));
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return logoutResponseSchema.parse({ ok: true });
  });

  app.get('/me', { preHandler: [exigirAutenticacao] }, async (request) =>
    usuarioSessaoSchema.parse(paraSessao(autenticacaoDe(request))),
  );
};
