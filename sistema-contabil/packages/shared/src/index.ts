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

/* -------------------------------------------------------------------------- */
/* Segurança: autenticação, papéis, escopo e trilha de auditoria (TASK-011)     */
/* -------------------------------------------------------------------------- */

/** Papéis do sistema (RF-02). */
export const papelSchema = z.enum(['administrador', 'contador']);
export type PapelDTO = z.infer<typeof papelSchema>;

/**
 * Política de senha (H15): mínimo de 8 caracteres, exigida na criação e na
 * alteração de usuário (RF-19, CA-50). A mensagem cita a política de senha.
 */
export const senhaSchema = z
  .string()
  .min(8, 'A senha deve ter no mínimo 8 caracteres, conforme a política de senha.');

/** E-mail válido (cadastro de usuário e login). */
export const emailSchema = z.email('Informe um e-mail válido.');

/** Credenciais aceitas por `POST /login`. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  senha: z.string().min(1, 'Informe a senha.'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Usuário autenticado devolvido por `GET /me` e pelo login. */
export const usuarioSessaoSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  papel: papelSchema,
  ativo: z.boolean(),
  /** Empresas atribuídas no banco — o escopo nunca vem do cliente (RF-04). */
  empresa_ids: z.array(z.number().int()),
});

export type UsuarioSessao = z.infer<typeof usuarioSessaoSchema>;

export const loginResponseSchema = z.object({
  ok: z.literal(true),
  usuario: usuarioSessaoSchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Resposta padrão de erro da API (`{ erro }`). */
export const erroResponseSchema = z.object({
  erro: z.string(),
});

export type ErroResponse = z.infer<typeof erroResponseSchema>;

export const logoutResponseSchema = z.object({
  ok: z.literal(true),
});

/** Evento da trilha de auditoria (`GET /auditoria`, RF-05/CA-39). */
export const auditEventSchema = z.object({
  id: z.number().int(),
  usuario_id: z.number().int().nullable(),
  empresa_id: z.number().int().nullable(),
  acao: z.string(),
  objeto_tipo: z.string().nullable(),
  objeto_id: z.string().nullable(),
  dados: z.unknown(),
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
});

export type AuditEventDTO = z.infer<typeof auditEventSchema>;

/** `YYYY-MM-DD` vira início do dia (UTC). */
const dataInicioSchema = z
  .union([z.iso.date(), z.iso.datetime()])
  .transform((valor) => (valor.length === 10 ? `${valor}T00:00:00.000Z` : valor));

/** `YYYY-MM-DD` vira fim do dia (UTC). */
const dataFimSchema = z
  .union([z.iso.date(), z.iso.datetime()])
  .transform((valor) => (valor.length === 10 ? `${valor}T23:59:59.999Z` : valor));

/** Filtros de `GET /auditoria`: empresa (obrigatória nesta etapa) e período. */
export const auditoriaQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
  de: dataInicioSchema.optional(),
  ate: dataFimSchema.optional(),
});

export type AuditoriaQuery = z.infer<typeof auditoriaQuerySchema>;

export const auditoriaResponseSchema = z.object({
  eventos: z.array(auditEventSchema),
});

export type AuditoriaResponse = z.infer<typeof auditoriaResponseSchema>;
