import {
  loginResponseSchema,
  logoutResponseSchema,
  usuarioSessaoSchema,
  type LoginRequest,
  type UsuarioSessao,
} from '@sistema-contabil/shared';
import { ErroApi, solicitar } from './client.ts';

/**
 * Rotas de autenticação (RF-03): `POST /login`, `POST /logout`, `GET /me`.
 *
 * A sessão é exclusivamente do cookie HttpOnly assinado pela API — aqui não
 * há token a guardar: "autenticado" é o que `GET /me` devolve.
 */

/**
 * `POST /login`. Em sucesso devolve o usuário da sessão (o cookie já foi
 * gravado pelo servidor). Em falha lança `ErroApi` com a mensagem da API:
 *
 * - 401 → credencial recusada (resposta genérica do servidor, CA-19);
 * - 403 → conta bloqueada por tentativas → `CE-17` (CA-51);
 * - 400 → dados inválidos segundo `loginRequestSchema`.
 */
export async function login(credenciais: LoginRequest): Promise<UsuarioSessao> {
  try {
    const resposta = await solicitar('/login', loginResponseSchema, {
      method: 'POST',
      body: JSON.stringify(credenciais),
    });
    return resposta.usuario;
  } catch (erro) {
    if (erro instanceof ErroApi && erro.status === 403) {
      // Bloqueio de login: recusa ativa com contagem → CE-17 (§5.2).
      throw new ErroApi(403, erro.message, 'CE-17');
    }
    if (erro instanceof ErroApi && erro.status === 401) {
      // Falha de credencial NÃO é sessão expirada: nenhuma recusa de tela.
      throw new ErroApi(401, erro.message, null);
    }
    throw erro;
  }
}

/** `POST /logout` — apaga a sessão no servidor e limpa o cookie. */
export async function logout(): Promise<void> {
  await solicitar('/logout', logoutResponseSchema, { method: 'POST' });
}

/** `GET /me` — usuário autenticado segundo o servidor (fonte da verdade). */
export async function me(): Promise<UsuarioSessao> {
  return solicitar('/me', usuarioSessaoSchema);
}
