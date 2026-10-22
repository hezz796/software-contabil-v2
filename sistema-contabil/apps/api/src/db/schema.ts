import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
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
    // Base da FK composta `titulo_conta_empresa_fk` (S-T014-6, TASK-016):
    // (id, empresa_id) é único porque id já é a PK — garante no banco que a
    // conta referenciada pertence à mesma empresa do referenciador.
    uniqueIndex('conta_id_empresa_uk').on(t.id, t.empresaId),
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

/**
 * Naturezas da partida (RF-07, H7): débito (`D`) ou crédito (`C`). O valor é
 * sempre positivo; a natureza é dada pela coluna D/C.
 */
export const NATUREZAS = ['D', 'C'] as const;
export type Natureza = (typeof NATUREZAS)[number];

/**
 * Lançamento contábil em partidas dobradas (RF-07, ADR-0001, TASK-014).
 *
 * - `periodo_id` é resolvido NO SERVIDOR a partir da `data` (nunca vem do
 *   cliente); lançamento/estorno só são aceitos em período **aberto**
 *   (CA-24/CE-3) — validação de serviço;
 * - `estorno_de_id`: `NULL` = lançamento original; id do original quando este
 *   lançamento É um estorno (RF-08). O índice único `lancamento_estorno_de_uk`
 *   garante no banco o "estornado uma única vez" (CA-26/CE-5);
 * - **Imutabilidade** (RF-08/R9/CA-25): o produto não expõe edição/exclusão e
 *   triggers `BEFORE UPDATE/DELETE` com `RAISE(ABORT)` (migração 0005) abortam
 *   qualquer alteração/remoção direta — mesmo caminho provado em
 *   `audit_event_append_only` (CA-38).
 */
export const lancamento = sqliteTable(
  'lancamento',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** Período de `data` (resolvido no servidor). */
    periodoId: integer('periodo_id')
      .notNull()
      .references(() => periodoContabil.id),
    /** `YYYY-MM-DD` (validado na camada de entrada). */
    data: text('data').notNull(),
    historico: text('historico').notNull(),
    /** `NULL` = original; id do original quando este lançamento é um estorno. */
    estornoDeId: integer('estorno_de_id').references((): AnySQLiteColumn => lancamento.id),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    /** Uma origem só pode ter UM estorno (CA-26; NULLs não colidem no SQLite). */
    uniqueIndex('lancamento_estorno_de_uk').on(t.estornoDeId),
    // Base das FKs compostas de `baixa` (S-T014-6, TASK-016): o par
    // (id, empresa_id) é único porque id é a PK — qualquer vínculo
    // baixa↔lançamento é obrigado a compartilhar `empresa_id` NO BANCO.
    uniqueIndex('lancamento_id_empresa_uk').on(t.id, t.empresaId),
    index('lancamento_empresa_data_idx').on(t.empresaId, t.data),
    index('lancamento_periodo_idx').on(t.periodoId),
  ],
);

export type Lancamento = typeof lancamento.$inferSelect;
export type NovoLancamento = typeof lancamento.$inferInsert;

/**
 * Partida de um lançamento (RF-07, ADR-0001).
 *
 * - colunas com os MESMOS nomes consumidos pelos clientes da T013
 *   (`fixtures/contas.ts:simularLancamentoEmConta` e
 *   `services/contas.ts:contaTemLancamentos`) — decisão T014: manter os nomes
 *   para não churnar a T013;
 * - FK `lancamento_id -> lancamento.id` (achado T014-F-1): partida sem
 *   lançamento é dado corrompido — a referência é garantida NO BANCO, na mesma
 *   filosofia dos triggers de imutabilidade (a fixture da T013 foi atualizada
 *   para criar um lançamento real antes da partida);
 * - `conta_id` tem FK real e os CHECKs reforçam H7 no banco: valor > 0 e
 *   natureza em ('D','C').
 */
export const partida = sqliteTable(
  'partida',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lancamentoId: integer('lancamento_id')
      .notNull()
      .references(() => lancamento.id),
    contaId: integer('conta_id')
      .notNull()
      .references(() => conta.id),
    natureza: text('natureza', { enum: NATUREZAS }).notNull(),
    /** Sempre positivo em centavos (H7); a natureza dá o sentido. */
    valorCentavos: integer('valor_centavos').notNull(),
  },
  (t) => [
    index('partida_lancamento_idx').on(t.lancamentoId),
    index('partida_conta_idx').on(t.contaId),
    check('partida_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('partida_natureza_valida', sql`${t.natureza} IN ('D', 'C')`),
  ],
);

export type Partida = typeof partida.$inferSelect;
export type NovaPartida = typeof partida.$inferInsert;

/**
 * Tipos de título (RF-13/RF-14, TASK-016): a pagar e a receber. O mesmo
 * fluxo de baixa/cancelamento/estorno serve as duas perspectivas.
 */
export const TIPOS_TITULO = ['pagar', 'receber'] as const;
export type TipoTitulo = (typeof TIPOS_TITULO)[number];

/**
 * Situações do título (RF-13, TASK-016): `aberto`, `parcial`, `pago`,
 * `cancelado` — enum exatamente como definido em
 * `TASK-016.json:scope.include` (o JSON governa; CA-07 "recebido" é o estado
 * quitado, representado por `pago` — ver `TASK-016.json:assumptions`).
 * A situação é DERIVADA das baixas/cancelamento, nunca enviada pelo cliente.
 */
export const SITUACOES_TITULO = ['aberto', 'parcial', 'pago', 'cancelado'] as const;
export type SituacaoTitulo = (typeof SITUACOES_TITULO)[number];

/**
 * Título a pagar/receber (RF-13/RF-14, TASK-016, CA-06/07/16/41).
 *
 * - `valor_centavos` é o valor TOTAL do título; `saldo_centavos` é o saldo
 *   residual abatido pelas baixas (H8: baixa total/parcial). CHECK no banco
 *   garante `0 <= saldo <= valor` (invariante de domínio no BANCO — regra 4
 *   do AGENTS.md);
 * - `situacao` nasce `aberto` e só muda por escuta de serviço (baixa,
 *   estorno de baixa, cancelamento); `cancelado` zera o saldo residual e
 *   **não gera lançamento** (hipótese registrada em `TASK-016.json`);
 * - `conta_id` + `empresa_id` formam FK COMPOSTA com `conta(id, empresa_id)`
 *   (S-T014-6): o banco recusa vínculo com conta de OUTRA empresa — não só o
 *   serviço;
 * - `titulo_id + empresa_id` é único (`titulo_id_empresa_uk`) porque é a
 *   referência alvo das FKs compostas de `baixa`.
 */
export const titulo = sqliteTable(
  'titulo',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    tipo: text('tipo', { enum: TIPOS_TITULO }).notNull(),
    /** Fornecedor/cliente (RF-13: "fornecedor/descrição"). */
    contraparte: text('contraparte').notNull(),
    /** Observação livre; `NULL` = sem observação. */
    descricao: text('descricao'),
    /** `YYYY-MM-DD` (validado na camada de entrada). */
    vencimento: text('vencimento').notNull(),
    /** Total do título em centavos (ADR-0001, nunca float). */
    valorCentavos: integer('valor_centavos').notNull(),
    /** Conta contábil do título (razão em que a baixa impacta — RF-15). */
    contaId: integer('conta_id').notNull(),
    situacao: text('situacao', { enum: SITUACOES_TITULO }).notNull().default('aberto'),
    /** Saldo residual em centavos; `0` quando quitado/cancelado. */
    saldoCentavos: integer('saldo_centavos').notNull(),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
    atualizadoEm: text('atualizado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('titulo_id_empresa_uk').on(t.id, t.empresaId),
    index('titulo_empresa_idx').on(t.empresaId),
    index('titulo_empresa_situacao_idx').on(t.empresaId, t.situacao),
    foreignKey({
      columns: [t.contaId, t.empresaId],
      foreignColumns: [conta.id, conta.empresaId],
      name: 'titulo_conta_empresa_fk',
    }),
    check('titulo_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('titulo_saldo_na_faixa', sql`${t.saldoCentavos} >= 0 AND ${t.saldoCentavos} <= ${t.valorCentavos}`),
    check(
      'titulo_situacao_valida',
      sql`${t.situacao} IN ('aberto', 'parcial', 'pago', 'cancelado')`,
    ),
    check('titulo_tipo_valido', sql`${t.tipo} IN ('pagar', 'receber')`),
  ],
);

export type Titulo = typeof titulo.$inferSelect;
export type NovoTitulo = typeof titulo.$inferInsert;

/**
 * Baixa de título (RF-13/RF-14/RF-15, TASK-016, CA-06/16/41/42/43/55).
 *
 * - **Decisão D1 (2026-10-22):** `valor_centavos` é o **bruto abatido do
 *   saldo** do título — a recusa "valor maior que o saldo" do CA-16 é
 *   literalmente sobre o bruto; `retencao_centavos` e `encargos_centavos`
 *   (multa/juros) são colunas próprias que entram no lançamento vinculado
 *   (CA-47/CA-48 — entrada/cálculo são da T017; nesta tarefa nascem em 0);
 * - `lancamento_id` é o vínculo contábil da baixa (RF-15); a correção é o
 *   **estorno de baixa** (RF-24), que preenche `estorno_lancamento_id` —
 *   coluna ÚNICA (`baixa_estorno_lancamento_uk`), portanto um estorno por
 *   baixa (RF-24: "só pode ser aplicado uma vez por baixa");
 * - **S-T014-6 (invariante NO BANCO):** as três FKs são COMPOSTAS
 *   `(…, empresa_id) -> pai(id, empresa_id)`: baixa ↔ título ↔ lançamento só
 *   existem se compartilharem `empresa_id`. O banco recusa vínculo
 *   cross-tenant mesmo com bug de aplicação;
 * - `data` é a data da baixa; o período contábil dela é resolvido do servidor
 *   (o lançamento vinculado carrega `periodo_id` derivado da mesma data, e o
 *   trigger `lancamento_no_periodo_encerrado` da 0006 aborta baixa em período
 *   encerrado como retrocesso no banco).
 */
export const baixa = sqliteTable(
  'baixa',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    tituloId: integer('titulo_id').notNull(),
    /** Lançamento contábil vinculado à baixa (RF-15). */
    lancamentoId: integer('lancamento_id').notNull(),
    /** Lançamento de estorno gerado pelo estorno de baixa; `NULL` = vigente. */
    estornoLancamentoId: integer('estorno_lancamento_id'),
    /** `YYYY-MM-DD` da baixa (validado na camada de entrada). */
    data: text('data').notNull(),
    /** Bruto abatido do saldo do título (D1). */
    valorCentavos: integer('valor_centavos').notNull(),
    /** Retenção na fonte dentro do bruto (D1; CA-47 é T017 — aqui 0). */
    retencaoCentavos: integer('retencao_centavos').notNull().default(0),
    /** Multa/juros acrescidos ao caixa (D1; CA-48 é T017 — aqui 0). */
    encargosCentavos: integer('encargos_centavos').notNull().default(0),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    foreignKey({
      columns: [t.tituloId, t.empresaId],
      foreignColumns: [titulo.id, titulo.empresaId],
      name: 'baixa_titulo_empresa_fk',
    }),
    foreignKey({
      columns: [t.lancamentoId, t.empresaId],
      foreignColumns: [lancamento.id, lancamento.empresaId],
      name: 'baixa_lancamento_empresa_fk',
    }),
    // Nullable: enquanto `estorno_lancamento_id` é NULL o SQLite não avalia a
    // FK; preenchido, exige lançamento DA MESMA empresa.
    foreignKey({
      columns: [t.estornoLancamentoId, t.empresaId],
      foreignColumns: [lancamento.id, lancamento.empresaId],
      name: 'baixa_estorno_lancamento_empresa_fk',
    }),
    /** Um estorno por baixa (NULLs não colidem no SQLite — RF-24). */
    uniqueIndex('baixa_estorno_lancamento_uk').on(t.estornoLancamentoId),
    index('baixa_titulo_idx').on(t.tituloId),
    index('baixa_empresa_idx').on(t.empresaId),
    check('baixa_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('baixa_retencao_nao_negativa', sql`${t.retencaoCentavos} >= 0`),
    check('baixa_encargos_nao_negativos', sql`${t.encargosCentavos} >= 0`),
  ],
);

export type Baixa = typeof baixa.$inferSelect;
export type NovaBaixa = typeof baixa.$inferInsert;
