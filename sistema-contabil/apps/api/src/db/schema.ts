import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
 * Empresa (cliente do escritório) — RF-01/RF-04, TASK-012.
 *
 * - `cnpj` armazenado normalizado (14 dígitos, sem pontuação), validado na
 *   camada de entrada (CA-15) e único no banco (CA-15: duplicado recusado).
 * - Situação ativa/inativa: **não existe exclusão dura no MVP** (H13) — não há
 *   rota nem trigger de DELETE; inativa bloqueia escrita contábil nova e
 *   mantém leitura/histórico (CA-40/CE-14).
 */
export const empresa = sqliteTable(
  'empresa',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    razaoSocial: text('razao_social').notNull(),
    /** 14 dígitos sem pontuação (ver domínio `cnpj`). */
    cnpj: text('cnpj').notNull(),
    ativo: integer('ativo', { mode: 'boolean' }).notNull().default(true),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
    atualizadoEm: text('atualizado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [uniqueIndex('empresa_cnpj_uk').on(t.cnpj)],
);

export type Empresa = typeof empresa.$inferSelect;
export type NovaEmpresa = typeof empresa.$inferInsert;

/**
 * Atribuição N:N usuário x empresa (RF-04). Remoção de linha tem efeito
 * imediato na requisição seguinte (R10/CA-37) — o escopo é relido do banco
 * a cada requisição.
 */
export const usuarioEmpresa = sqliteTable(
  'usuario_empresa',
  {
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuario.id),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
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

/**
 * Tipos de conta do plano (RF-06, ADR-0001): ativo, passivo, patrimônio
 * líquido, receita e despesa — estrutura aderente ao PCASP (H5) e
 * **configurável pelo escritório** (sem pre-carga obrigatória, H5 aberta).
 */
export const TIPOS_CONTA = ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'despesa'] as const;
export type TipoConta = (typeof TIPOS_CONTA)[number];

/**
 * Conta do plano de contas por empresa (RF-06, TASK-013, CA-17/CA-27).
 *
 * - `codigo` é único POR EMPRESA (`conta_empresa_codigo_uk`): o mesmo código
 *   pode existir em empresas diferentes;
 * - `conta_pai_id` forma a hierarquia pai/filhas (auto-referência; `NULL` =
 *   nível raiz). Pai com filhas ativas não é inativada antes das filhas
 *   (CA-27);
 * - situação ativa/inativa: **não existe exclusão dura** (CA-17/CE-13) — conta
 *   com lançamentos só inativa; inativa sai das escolhas novas e o histórico
 *   permanece. A regra "tem lançamentos" é apurada sobre `partida` (T014);
 *   até lá nenhuma conta pode ter lançamentos.
 */
export const conta = sqliteTable(
  'conta',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** Ex.: `1.1.1`; normalizado (trim) na camada de entrada. */
    codigo: text('codigo').notNull(),
    descricao: text('descricao').notNull(),
    tipo: text('tipo', { enum: TIPOS_CONTA }).notNull(),
    /** Auto-referência para o pai; a validação de escopo (mesma empresa) é de serviço. */
    contaPaiId: integer('conta_pai_id').references((): AnySQLiteColumn => conta.id),
    ativa: integer('ativa', { mode: 'boolean' }).notNull().default(true),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
    atualizadoEm: text('atualizado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('conta_empresa_codigo_uk').on(t.empresaId, t.codigo),
    index('conta_empresa_idx').on(t.empresaId),
    index('conta_pai_idx').on(t.contaPaiId),
  ],
);

export type Conta = typeof conta.$inferSelect;
export type NovaConta = typeof conta.$inferInsert;

/**
 * Período contábil mensal (RF-09, TASK-013, base do CA-24/CA-31/CA-32).
 *
 * - único por (empresa, ano, mês) (`periodo_empresa_ano_mes_uk`);
 * - estado aberto/encerrado expresso por `encerrado_em`: `NULL` = aberto,
 *   ISO-8601 UTC = data/hora do encerramento. As **ações** de encerramento
 *   (zera resultado, estornos, rolagem e exercício — H12) são da TASK-015;
 *   aqui estão apenas a base e o estado.
 */
export const periodoContabil = sqliteTable(
  'periodo_contabil',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    ano: integer('ano').notNull(),
    /** 1..12 (validado na camada de entrada). */
    mes: integer('mes').notNull(),
    /** ISO-8601 UTC; `NULL` = período aberto. */
    encerradoEm: text('encerrado_em'),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('periodo_empresa_ano_mes_uk').on(t.empresaId, t.ano, t.mes),
    index('periodo_empresa_idx').on(t.empresaId),
  ],
);

export type PeriodoContabil = typeof periodoContabil.$inferSelect;
