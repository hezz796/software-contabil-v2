import { erroResponseSchema, healthResponseSchema, type HealthResponse } from '@sistema-contabil/shared';

export type { HealthResponse };

/**
 * Cliente HTTP tipado mínimo (estrutura do ADR-0001).
 *
 * Convenções:
 * - mesmo origem: em produção API e web são o mesmo origin (ADR-0003) e em
 *   dev o Vite encaminha as rotas da API (proxy documentado em `../README.md`);
 * - a sessão vive no **cookie HttpOnly** assinado pela API — o JS não guarda
 *   nem lê token algum (não existe localStorage nesta aplicação);
 * - respostas de sucesso são validadas pelos esquemas Zod de
 *   `packages/shared` (contrato compartilhado api↔web, sem tipos duplicados);
 * - corpo de erro segue o padrão do projeto `{ erro: string }` (TASK-011).
 */

/**
 * Recusas (CE-01..CE-22) que a UI sabe classificar pelo status HTTP.
 *
 * - `CE-11` sessão ausente/expirada (401) → estado `neutro` no login (§5.2);
 * - `CE-12` sem permissão (403) → estado `neutro`, sem exposição de dados;
 * - `CE-17` login bloqueado por tentativas (403 de `POST /login`) → `erro`.
 */
export type Recusa = 'CE-11' | 'CE-12' | 'CE-17';

/** Erro de chamada à API com status HTTP e recusa correspondente. */
export class ErroApi extends Error {
  readonly status: number;
  readonly recusa: Recusa | null;

  constructor(status: number, mensagem: string, recusa: Recusa | null = null) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.recusa = recusa;
  }
}

/** Forma estrutural de um esquema Zod (`parse`), sem importar `zod` aqui. */
export interface Esquema<T> {
  parse(valor: unknown): T;
}

/** Falha de rede/origem: status 0 (não houve resposta HTTP). */
function falhaDeConexao(): ErroApi {
  return new ErroApi(
    0,
    'Não foi possível falar com o servidor. Verifique se a API local está em execução.',
  );
}

function recusaDe(status: number): Recusa | null {
  if (status === 401) return 'CE-11';
  if (status === 403) return 'CE-12';
  return null;
}

/**
 * Faz uma chamada à API e valida a resposta com `esquema`.
 *
 * Qualquer status fora de 2xx vira `ErroApi` com a mensagem `{ erro }` da API
 * (quando o corpo for válido) — é essa mensagem que a UI exibe, sem inventar
 * texto do cliente sobre recusa do servidor.
 */
export async function solicitar<T>(
  caminho: string,
  esquema: Esquema<T>,
  opcoes: RequestInit = {},
): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, {
      credentials: 'same-origin',
      ...opcoes,
      headers: {
        ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}),
        ...opcoes.headers,
      },
    });
  } catch {
    // Sem resposta (rede, API fora do ar, CORS): não confundir com recusa.
    throw falhaDeConexao();
  }

  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }

  if (!resposta.ok) {
    const tentativa = erroResponseSchema.safeParse(corpo);
    const mensagem = tentativa.success
      ? tentativa.data.erro
      : `Falha na chamada ${caminho} (HTTP ${resposta.status}).`;
    throw new ErroApi(resposta.status, mensagem, recusaDe(resposta.status));
  }

  try {
    return esquema.parse(corpo);
  } catch {
    // Contrato divergente: falha explícita em vez de dado silenciosamente errado.
    throw new ErroApi(
      resposta.status,
      'Resposta inesperada da API: o formato não corresponde ao contrato compartilhado.',
      null,
    );
  }
}

/** `GET /health` — verificação simples de que a API está de pé. */
export async function fetchHealth(baseUrl = ''): Promise<HealthResponse> {
  return solicitar(`${baseUrl}/health`, healthResponseSchema);
}
