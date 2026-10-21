import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Bootstrap de metadados (não é regra de negócio): pares chave/valor usados
 * para identificar o schema aplicado.
 */
export const appMeta = sqliteTable('app_meta', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
});

export type AppMeta = typeof appMeta;

/**
 * Papéis do sistema (RF-02): administrador tem gestão e leitura global
 * auditada, sem escrita contábil; contador escreve nas empresas atribuídas.
 */
export const PAPEIS = ['administrador', 'contador'] as const;
export type Papel = (typeof PAPEIS)[number];

/**
 * Convenção de datas/horas de todo o schema de segurança: texto ISO-8601 em
 * UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`). Ordenação lexicográfica == ordem
 * cronológica, o que simplifica o filtro de período da trilha (CA-39).
 */
const agora = (): string => new Date().toISOString();

/**
 * Usuário do sistema (RF-02/RF-03/RF-19).
 *
 * `failed_logins` e `locked_until` são o contador e o bloqueio de tentativas
 * (H16): persistidos no próprio usuário, zerados no login com sucesso.
 * `ativo = false` revoga o acesso já na requisição seguinte (R10/CA-22),
 * inclusive para sessão já aberta — a validação acontece a cada requisição.
 */
export const usuario = sqliteTable(
  'usuario',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    senhaHash: text('senha_hash').notNull(),
    papel: text('papel', { enum: PAPEIS }).notNull(),
    ativo: integer('ativo', { mode: 'boolean' }).notNull().default(true),
    failedLogins: integer('failed_logins').notNull().default(0),
    /** ISO-8601 UTC; `NULL` = usuário não bloqueado. */
    lockedUntil: text('locked_until'),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [uniqueIndex('usuario_email_uk').on(t.email)],
);

export type Usuario = typeof usuario.$inferSelect;
export type NovoUsuario = typeof usuario.$inferInsert;

/**
 * Sessão persistida no banco (ADR-0001): validada a cada requisição junto com
 * `usuario.ativo` — sem cache — para garantir revogação imediata (CA-22,
 * R10) e expiração por inatividade (H14).
 */
export const sessao = sqliteTable(
  'sessao',
  {
    /** Token opaco de 32 bytes (base64url) entregue no cookie. */
    id: text('id').primaryKey(),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.id),
    criadaEm: text('criada_em').notNull(),
    /** ISO-8601 UTC calculada a partir de `SESSION_TTL_MINUTES` (H14). */
    expiraEm: text('expira_em').notNull(),
  },
  (t) => [index('sessao_usuario_idx').on(t.usuarioId), index('sessao_expira_em_idx').on(t.expiraEm)],
);

export type Sessao = typeof sessao.$inferSelect;

/**
 * Atribuição N:N usuário x empresa (RF-04). Sem FK para `empresa`: a tabela
 * de empresas é criada na TASK-012 (fora do escopo desta tarefa).
 * Remoção de linha tem efeito imediato na requisição seguinte (R10/CA-37).
 */
export const usuarioEmpresa = sqliteTable(
  'usuario_empresa',
  {
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.id),
    empresaId: integer('empresa_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.usuarioId, t.empresaId] }),
    index('usuario_empresa_empresa_idx').on(t.empresaId),
  ],
);

export type UsuarioEmpresa = typeof usuarioEmpresa.$inferSelect;

/**
 * Trilha de auditoria append-only (RF-05, ADR-0001).
 *
 * A imutabilidade é garantida NO BANCO por triggers `BEFORE UPDATE` e
 * `BEFORE DELETE` que fazem `RAISE(ABORT)` (migração `audit_event_append_only`,
 * CA-38) — o produto não expõe nenhuma rota de edição/remoção (R11).
 * Sem FK para `usuario`: é uma tabela de log e precisa sobreviver a
 * qualquer mudança de cadastro.
 */
export const auditEvent = sqliteTable(
  'audit_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    usuarioId: integer('usuario_id'),
    empresaId: integer('empresa_id'),
    acao: text('acao').notNull(),
    objetoTipo: text('objeto_tipo'),
    objetoId: text('objeto_id'),
    /** JSON livre: dados anteriores/novos, motivo da recusa, contexto. */
    dados: text('dados', { mode: 'json' }),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    index('audit_event_empresa_criado_idx').on(t.empresaId, t.criadoEm),
    index('audit_event_usuario_criado_idx').on(t.usuarioId, t.criadoEm),
  ],
);

export type AuditEvent = typeof auditEvent.$inferSelect;
export type NovoAuditEvent = typeof auditEvent.$inferInsert;
