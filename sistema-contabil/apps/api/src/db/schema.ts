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
    // Base da FK composta `apuracao_das_periodo_empresa_fk` (S-T014-6, TASK-017):
    // (id, empresa_id) é único porque id é a PK.
    uniqueIndex('periodo_id_empresa_uk').on(t.id, t.empresaId),
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
 *   (multa/juros — em `multa_centavos`/`juros_centavos`, com
 *   `encargos = multa + juros` no banco) são colunas próprias que entram nos
 *   lançamentos vinculados (CA-47/T017: retenção em lançamento separado;
 *   CA-48/T017: encargos dentro do lançamento da baixa);
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
    /** Retenção na fonte dentro do bruto (D1; CA-47/T017). */
    retencaoCentavos: integer('retencao_centavos').notNull().default(0),
    /** Multa/juros acrescidos ao caixa (D1; CA-48/T017); `encargos = multa + juros`. */
    encargosCentavos: integer('encargos_centavos').notNull().default(0),
    /** Multa de atraso dentro de `encargos_centavos` (T017; ex.: 2% = 20,00). */
    multaCentavos: integer('multa_centavos').notNull().default(0),
    /** Juros de atraso dentro de `encargos_centavos` (T017/H18: mensal/30 pro rata). */
    jurosCentavos: integer('juros_centavos').notNull().default(0),
    /**
     * Lançamento de retenção a recolher gerado pela baixa (RF-22/CA-47/T017):
     * separado do lançamento do pagamento. `NULL` = baixa sem retenção.
     */
    retencaoLancamentoId: integer('retencao_lancamento_id'),
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
    // Mesma garantia S-T014-6 para o lançamento de retenção a recolher (T017).
    foreignKey({
      columns: [t.retencaoLancamentoId, t.empresaId],
      foreignColumns: [lancamento.id, lancamento.empresaId],
      name: 'baixa_retencao_lancamento_empresa_fk',
    }),
    /** Um estorno por baixa (NULLs não colidem no SQLite — RF-24). */
    uniqueIndex('baixa_estorno_lancamento_uk').on(t.estornoLancamentoId),
    uniqueIndex('baixa_retencao_lancamento_uk').on(t.retencaoLancamentoId),
    index('baixa_titulo_idx').on(t.tituloId),
    index('baixa_empresa_idx').on(t.empresaId),
    check('baixa_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('baixa_retencao_nao_negativa', sql`${t.retencaoCentavos} >= 0`),
    check('baixa_encargos_nao_negativos', sql`${t.encargosCentavos} >= 0`),
    // Invariantes de domínio NO BANCO (regra 4): multa/juros não negativos e
    // encargos = multa + juros (CA-48: 20,00 + 10,00 = 30,00); retenção
    // coerente com o bruto abatido do saldo (CA-47: 50,00 de 1.000,00).
    check('baixa_multa_nao_negativa', sql`${t.multaCentavos} >= 0`),
    check('baixa_juros_nao_negativo', sql`${t.jurosCentavos} >= 0`),
    check(
      'baixa_encargos_soma_multa_juros',
      sql`${t.encargosCentavos} = ${t.multaCentavos} + ${t.jurosCentavos}`,
    ),
    check(
      'baixa_retencao_nao_maior_que_bruto',
      sql`${t.retencaoCentavos} <= ${t.valorCentavos}`,
    ),
  ],
);

export type Baixa = typeof baixa.$inferSelect;
export type NovaBaixa = typeof baixa.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Fiscal configurável: tabelas, retenções, multa/juros e DAS (RF-20..23,      */
/* H17/H18/H19, CA-45..49/54; TASK-017)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Alíquota percentual em **centésimos de percentual** (ex.: 4% = `400`,
 * 6% = `600`) — inteiro, nunca float (ADR-0001). O valor em dinheiro é
 * `valor_centavos = round(base_centavos * aliquota_centavos / 10000)`.
 */

/**
 * Tabela de imposto/retenção configurável por empresa (RF-20, CA-45).
 *
 * - `aliquota_centavos >= 0` garantido NO BANCO (CHECK) e na camada de
 *   entrada (Zod, mensagem específica — CA-45/CE-19);
 * - `conta_retencao_id` é a conta (passivo "impostos a recolher") creditada
 *   pelo lançamento de retenção da baixa (RF-22/H19). `NULL` = tabela ainda
 *   sem conta: pode ser cadastrada/associada (CA-45 é nome + alíquota), mas a
 *   baixa que a aplique é recusada com mensagem (T017);
 * - sem exclusão dura (mesmo padrão de conta/título): `ativa` tira a tabela
 *   das aplicações novas sem perder histórico;
 * - `tabela_imposto_id + empresa_id` é único (`tabela_imposto_id_empresa_uk`)
 *   porque é a referência alvo da FK composta de `titulo_tabela_imposto`.
 */
export const tabelaImposto = sqliteTable(
  'tabela_imposto',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** Ex.: "ISS", "IRRF" — trim na camada de entrada. */
    nome: text('nome').notNull(),
    /** Percentual em centésimos (4% = 400). */
    aliquotaCentavos: integer('aliquota_centavos').notNull(),
    /** Conta de "retenções a recolher" creditada na baixa (RF-22); NULL = sem conta. */
    contaRetencaoId: integer('conta_retencao_id'),
    ativa: integer('ativa', { mode: 'boolean' }).notNull().default(true),
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
    uniqueIndex('tabela_imposto_id_empresa_uk').on(t.id, t.empresaId),
    // Base das FKs compostas de `titulo_tabela_imposto` (S-T014-6): qualquer
    // vínculo título↔tabela é obrigado a compartilhar `empresa_id` NO BANCO.
    index('tabela_imposto_empresa_idx').on(t.empresaId),
    foreignKey({
      columns: [t.contaRetencaoId, t.empresaId],
      foreignColumns: [conta.id, conta.empresaId],
      name: 'tabela_imposto_conta_empresa_fk',
    }),
    check('tabela_imposto_aliquota_nao_negativa', sql`${t.aliquotaCentavos} >= 0`),
    check('tabela_imposto_nome_nao_vazio', sql`length(trim(${t.nome})) > 0`),
  ],
);

export type TabelaImposto = typeof tabelaImposto.$inferSelect;
export type NovaTabelaImposto = typeof tabelaImposto.$inferInsert;

/**
 * Associação tabela de imposto ↔ título (RF-13/RF-20, CA-45; TASK-017).
 *
 * PK `(titulo_id, tabela_imposto_id)` — uma tabela por título uma única vez.
 * As duas FKs compostas `(…, empresa_id) → pai(id, empresa_id)` garantem NO
 * BANCO que título e tabela pertencem à MESMA empresa (S-T014-6).
 */
export const tituloTabelaImposto = sqliteTable(
  'titulo_tabela_imposto',
  {
    tituloId: integer('titulo_id').notNull(),
    tabelaImpostoId: integer('tabela_imposto_id').notNull(),
    empresaId: integer('empresa_id').notNull(),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    primaryKey({ columns: [t.tituloId, t.tabelaImpostoId] }),
    index('titulo_tabela_imposto_tabela_idx').on(t.tabelaImpostoId),
    index('titulo_tabela_imposto_empresa_idx').on(t.empresaId),
    foreignKey({
      columns: [t.tituloId, t.empresaId],
      foreignColumns: [titulo.id, titulo.empresaId],
      name: 'titulo_tabela_titulo_empresa_fk',
    }),
    foreignKey({
      columns: [t.tabelaImpostoId, t.empresaId],
      foreignColumns: [tabelaImposto.id, tabelaImposto.empresaId],
      name: 'titulo_tabela_tabela_empresa_fk',
    }),
  ],
);

export type TituloTabelaImposto = typeof tituloTabelaImposto.$inferSelect;
export type NovoTituloTabelaImposto = typeof tituloTabelaImposto.$inferInsert;

/**
 * Configuração de multa/juros de atraso (RF-23, CA-48; TASK-017).
 *
 * - escopo por `titulo_id`: `NULL` = configuração PADRÃO da empresa;
 *   preenchido = **override por título** (prioridade: título > empresa —
 *   "por título e/ou contrato" de RF-23; não existe entidade "contrato" no
 *   MVP, hipótese registrada em `TASK-017.json`);
 * - percentuais em centésimos (2% = `200`; 1% a.m. = `100`); juros são
 *   pro rata diária = mensal ÷ 30 (H18);
 * - `conta_encargos_id` é a conta (despesa) debitada pelos encargos gerados
 *   na baixa; `NULL` = sem conta: a config vale, mas a baixa que gerar
 *   encargos é recusada com mensagem (T017);
 * - unicidades NO BANCO: uma configuração padrão por empresa (índice único
 *   parcial) e um override por título (`config_multa_juros_titulo_uk`).
 */
export const configMultaJuros = sqliteTable(
  'config_multa_juros',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** `NULL` = configuração padrão da empresa; id = override por título. */
    tituloId: integer('titulo_id'),
    /** Percentual da multa em centésimos (ex.: 2% = 200). */
    multaCentavos: integer('multa_centavos').notNull().default(0),
    /** Percentual de juros MENAL em centésimos (ex.: 1% a.m. = 100 — H18). */
    jurosMensalCentavos: integer('juros_mensal_centavos').notNull().default(0),
    /** Conta (despesa) debitada pelos encargos da baixa; NULL = sem conta. */
    contaEncargosId: integer('conta_encargos_id'),
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
    // Um override por título (NULLs não colidem no SQLite — RF-23).
    uniqueIndex('config_multa_juros_titulo_uk').on(t.tituloId),
    // Uma configuração padrão por empresa (índice parcial).
    uniqueIndex('config_multa_juros_empresa_default_uk')
      .on(t.empresaId)
      .where(sql`${t.tituloId} IS NULL`),
    index('config_multa_juros_empresa_idx').on(t.empresaId),
    // Base da FK composta `config_multa_juros_titulo_empresa_fk` (S-T014-6).
    uniqueIndex('config_multa_juros_id_empresa_uk').on(t.id, t.empresaId),
    foreignKey({
      columns: [t.tituloId, t.empresaId],
      foreignColumns: [titulo.id, titulo.empresaId],
      name: 'config_multa_juros_titulo_empresa_fk',
    }),
    foreignKey({
      columns: [t.contaEncargosId, t.empresaId],
      foreignColumns: [conta.id, conta.empresaId],
      name: 'config_multa_juros_conta_empresa_fk',
    }),
    check('config_multa_juros_multa_nao_negativa', sql`${t.multaCentavos} >= 0`),
    check('config_multa_juros_juros_nao_negativo', sql`${t.jurosMensalCentavos} >= 0`),
  ],
);

export type ConfigMultaJuros = typeof configMultaJuros.$inferSelect;
export type NovoConfigMultaJuros = typeof configMultaJuros.$inferInsert;

/**
 * Regimes fiscais suportados (RF-21): por enquanto só o Simples Nacional
 * (escopo do MVP — PB-4/RF-21); enum pronto para extensão sem hardcode de
 * cálculo (RK-8: tudo configurável).
 */
export const REGIMES_FISCAIS = ['simples_nacional'] as const;
export type RegimeFiscal = (typeof REGIMES_FISCAIS)[number];

/**
 * Regime fiscal da empresa (RF-21, CA-46/CA-49; TASK-017).
 *
 * - **UM registro por empresa** (`regime_fiscal_empresa_uk`): reconfigurar é
 *   UPDATE do mesmo registro (o valor novo vale para as apurações seguintes —
 *   CA-54b para tabelas, mesmo espírito aqui);
 * - `ativa = false` equivale a "sem regime configurado" para a apuração
 *   (CA-49: recusa sem lançamento) sem perder o histórico;
 * - a base do DAS (H17) é a soma das **receitas lançadas no período**;
 * - as duas contas do lançamento de apuração: `conta_despesa_id` (D — "DAS a
 *   pagar/despesa") e `conta_passivo_id` (C — "DAS a recolher"), ambas com
 *   FK composta com `empresa_id` (S-T014-6).
 */
export const regimeFiscalTabela = sqliteTable(
  'regime_fiscal',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    regime: text('regime', { enum: REGIMES_FISCAIS }).notNull().default('simples_nacional'),
    /** Percentual em centésimos (6% = 600). */
    aliquotaCentavos: integer('aliquota_centavos').notNull(),
    /** Conta DEBITADA no lançamento de apuração do DAS (tipo despesa). */
    contaDespesaId: integer('conta_despesa_id').notNull(),
    /** Conta CREDITADA no lançamento de apuração do DAS (tipo passivo). */
    contaPassivoId: integer('conta_passivo_id').notNull(),
    ativa: integer('ativa', { mode: 'boolean' }).notNull().default(true),
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
    /** Um regime por empresa (RF-21: "regime configurado" é único). */
    uniqueIndex('regime_fiscal_empresa_uk').on(t.empresaId),
    // Base da FK composta `apuracao_das_regime_empresa_fk` (S-T014-6).
    uniqueIndex('regime_fiscal_id_empresa_uk').on(t.id, t.empresaId),
    foreignKey({
      columns: [t.contaDespesaId, t.empresaId],
      foreignColumns: [conta.id, conta.empresaId],
      name: 'regime_fiscal_despesa_empresa_fk',
    }),
    foreignKey({
      columns: [t.contaPassivoId, t.empresaId],
      foreignColumns: [conta.id, conta.empresaId],
      name: 'regime_fiscal_passivo_empresa_fk',
    }),
    check('regime_fiscal_aliquota_nao_negativa', sql`${t.aliquotaCentavos} >= 0`),
    check('regime_fiscal_regime_valido', sql`${t.regime} IN ('simples_nacional')`),
  ],
);

export type RegimeFiscalTabela = typeof regimeFiscalTabela.$inferSelect;
export type NovoRegimeFiscal = typeof regimeFiscalTabela.$inferInsert;

/**
 * Apuração do DAS (RF-21/RF-15, H17, CA-46/CA-49; TASK-017).
 *
 * - **Uma apuração por período** (`apuracao_das_periodo_uk`): o DAS de um
 *   mês é apurado uma vez; correção é estornar o lançamento vinculado
 *   (imutabilidade R9), não gerar outro;
 * - `base_centavos` = soma das receitas lançadas no período (H17);
 *   `aliquota_centavos` é **snapshot** do regime no ato da apuração;
 * - `das_centavos` é derivado NO BANCO por CHECK:
 *   `das = (base * aliquota + 5000) / 10000` (arredondamento meio-em-cima,
 *   inteiro — regra 4: o valor apurado não pode divergir do cálculo);
 * - `lancamento_id` é o vínculo contábil da apuração (RF-15), com FK
 *   composta `(…, empresa_id)`.
 */
export const apuracaoDas = sqliteTable(
  'apuracao_das',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    regimeId: integer('regime_id').notNull(),
    /** Período apurado (FK composta com `empresa_id`). */
    periodoId: integer('periodo_id').notNull(),
    /** Lançamento contábil da apuração (RF-15). */
    lancamentoId: integer('lancamento_id').notNull(),
    /** Base: receitas lançadas no período (H17), em centavos. */
    baseCentavos: integer('base_centavos').notNull(),
    /** Snapshot da alíquota do regime no ato da apuração (centésimos). */
    aliquotaCentavos: integer('aliquota_centavos').notNull(),
    /** Valor do DAS em centavos (derivado por CHECK da base × alíquota). */
    dasCentavos: integer('das_centavos').notNull(),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    /** Uma apuração por período (RF-21). */
    uniqueIndex('apuracao_das_periodo_uk').on(t.periodoId),
    index('apuracao_das_empresa_idx').on(t.empresaId),
    foreignKey({
      columns: [t.regimeId, t.empresaId],
      foreignColumns: [regimeFiscalTabela.id, regimeFiscalTabela.empresaId],
      name: 'apuracao_das_regime_empresa_fk',
    }),
    foreignKey({
      columns: [t.periodoId, t.empresaId],
      foreignColumns: [periodoContabil.id, periodoContabil.empresaId],
      name: 'apuracao_das_periodo_empresa_fk',
    }),
    foreignKey({
      columns: [t.lancamentoId, t.empresaId],
      foreignColumns: [lancamento.id, lancamento.empresaId],
      name: 'apuracao_das_lancamento_empresa_fk',
    }),
    check('apuracao_das_base_nao_negativa', sql`${t.baseCentavos} >= 0`),
    check('apuracao_das_aliquota_nao_negativa', sql`${t.aliquotaCentavos} >= 0`),
    check('apuracao_das_valor_nao_negativo', sql`${t.dasCentavos} >= 0`),
    // DAS = base × alíquota (arredondamento meio-em-cima em inteiro; H17).
    check(
      'apuracao_das_valor_derivado',
      sql`${t.dasCentavos} = (${t.baseCentavos} * ${t.aliquotaCentavos} + 5000) / 10000`,
    ),
  ],
);

export type ApuracaoDas = typeof apuracaoDas.$inferSelect;
export type NovaApuracaoDas = typeof apuracaoDas.$inferInsert;

/* -------------------------------------------------------------------------- */
/* Conciliação bancária e importação de extrato (RF-16, CA-08/28/44/53, F10;   */
/* TASK-018)                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Conta bancária da empresa (RF-16/Q-UI-2): cadastro MÍNIMO — nome, saldo
 * inicial e data do saldo inicial. É a pré-condição do extrato: sem conta não
 * há onde registrar item de extrato, manual ou importado (ADR-0004/Q-UI-2).
 *
 * - `nome` único POR EMPRESA (`conta_bancaria_empresa_nome_uk`);
 * - `saldo_inicial_centavos` aceita negativo (limite/cheque especial);
 * - `conta_bancaria_id_empresa_uk` é o alvo das FKs compostas de
 *   `importacao_extrato`/`item_extrato` (padrão S-T014-6).
 */
export const contaBancaria = sqliteTable(
  'conta_bancaria',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    nome: text('nome').notNull(),
    saldoInicialCentavos: integer('saldo_inicial_centavos').notNull().default(0),
    /** `YYYY-MM-DD` (validado na camada de entrada). */
    dataSaldoInicial: text('data_saldo_inicial').notNull(),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('conta_bancaria_empresa_nome_uk').on(t.empresaId, t.nome),
    uniqueIndex('conta_bancaria_id_empresa_uk').on(t.id, t.empresaId),
    index('conta_bancaria_empresa_idx').on(t.empresaId),
  ],
);

export type ContaBancaria = typeof contaBancaria.$inferSelect;
export type NovaContaBancaria = typeof contaBancaria.$inferInsert;

/**
 * Registro de importação de arquivo de extrato (CA-53/RF-16).
 *
 * - `arquivo_hash` = sha256 dos **bytes** enviados; UNIQUE por CONTA
 *   (`importacao_conta_hash_uk`): reimportar o mesmo arquivo na mesma conta é
 *   recusada como duplicata idêntica (T018-F-2), enquanto o mesmo arquivo em
 *   OUTRA conta continua permitido;
 * - `quantidade_itens` registra o resultado do parse (3 no exemplo do CA-53).
 */
export const importacaoExtrato = sqliteTable(
  'importacao_extrato',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contaBancariaId: integer('conta_bancaria_id').notNull(),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** Nome original enviado pelo cliente; `NULL` quando não informado. */
    nomeArquivo: text('nome_arquivo'),
    arquivoHash: text('arquivo_hash').notNull(),
    quantidadeItens: integer('quantidade_itens').notNull(),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('importacao_conta_hash_uk').on(t.contaBancariaId, t.arquivoHash),
    uniqueIndex('importacao_extrato_id_empresa_uk').on(t.id, t.empresaId),
    index('importacao_extrato_conta_idx').on(t.contaBancariaId),
    foreignKey({
      columns: [t.contaBancariaId, t.empresaId],
      foreignColumns: [contaBancaria.id, contaBancaria.empresaId],
      name: 'importacao_extrato_conta_empresa_fk',
    }),
    check('importacao_quantidade_nao_negativa', sql`${t.quantidadeItens} >= 0`),
  ],
);

export type ImportacaoExtrato = typeof importacaoExtrato.$inferSelect;
export type NovaImportacaoExtrato = typeof importacaoExtrato.$inferInsert;

/** Origem do item de extrato (RF-16): lançamento manual ou importação de arquivo. */
export const ORIGENS_ITEM_EXTRATO = ['manual', 'importacao'] as const;
export type OrigemItemExtratoBanco = (typeof ORIGENS_ITEM_EXTRATO)[number];

/**
 * Item de extrato conciliável (RF-16): manual (data, descrição, valor) ou
 * importado de arquivo OFX/CSV (CA-53 — conciliáveis "como os manuais").
 *
 * - `valor_centavos` ASSINADO: positivo = entrada, negativo = saída (a
 *   entrada/saída do RF-16 é o sinal);
 * - `identificador` é o FITID do OFX quando o arquivo traz; `NULL` no manual;
 * - o estado conciliado NÃO é coluna aqui: deriva de `conciliacao` vigente —
 *   desconciliação devolve o item a pendente (CA-28);
 * - CHECK no banco: `origem = 'importacao'` ⇔ `importacao_id` preenchido
 *   (invariante de domínio NO BANCO — regra 4 do AGENTS.md).
 */
export const itemExtrato = sqliteTable(
  'item_extrato',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    contaBancariaId: integer('conta_bancaria_id').notNull(),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    /** `YYYY-MM-DD` (validado na entrada; parser valida datas reais). */
    data: text('data').notNull(),
    descricao: text('descricao').notNull(),
    /** Centavos com sinal: + entrada, − saída. */
    valorCentavos: integer('valor_centavos').notNull(),
    origem: text('origem', { enum: ORIGENS_ITEM_EXTRATO }).notNull(),
    /** `NULL` para item manual; FK composta para `importacao_extrato`. */
    importacaoId: integer('importacao_id'),
    /** FITID do banco no arquivo; `NULL` quando não há (manual/CSV sem FITID). */
    identificador: text('identificador'),
    criadoPor: integer('criado_por')
      .notNull()
      .references(() => usuario.id),
    criadoEm: text('criado_em')
      .notNull()
      .$defaultFn(agora),
  },
  (t) => [
    uniqueIndex('item_extrato_id_empresa_uk').on(t.id, t.empresaId),
    index('item_extrato_conta_idx').on(t.contaBancariaId),
    index('item_extrato_empresa_idx').on(t.empresaId),
    foreignKey({
      columns: [t.contaBancariaId, t.empresaId],
      foreignColumns: [contaBancaria.id, contaBancaria.empresaId],
      name: 'item_extrato_conta_empresa_fk',
    }),
    // Nullable: com `importacao_id` NULL a FK não é avaliada (padrão da 0008).
    foreignKey({
      columns: [t.importacaoId, t.empresaId],
      foreignColumns: [importacaoExtrato.id, importacaoExtrato.empresaId],
      name: 'item_extrato_importacao_empresa_fk',
    }),
    check(
      'item_extrato_origem_coerente',
      sql`(${t.origem} = 'manual' AND ${t.importacaoId} IS NULL) OR (${t.origem} = 'importacao' AND ${t.importacaoId} IS NOT NULL)`,
    ),
  ],
);

export type ItemExtrato = typeof itemExtrato.$inferSelect;
export type NovoItemExtrato = typeof itemExtrato.$inferInsert;

/** Objeto de uma conciliação (RF-16): um TÍTULO **ou** um LANÇAMENTO por vez. */
export const OBJETOS_CONCILIACAO = ['titulo', 'lancamento'] as const;
export type ObjetoConciliacaoBanco = (typeof OBJETOS_CONCILIACAO)[number];

/**
 * Conciliação item ↔ objeto (RF-16, CA-08/CA-28/CA-44).
 *
 * - **UM objeto por vez:** `objeto_tipo` define qual FK é preenchida (CHECK
 *   `conciliacao_objeto_coerente`); o "e/ou" do RF-16 é lido como alternativo
 *   (T018-F-2);
 * - **UMA linha por item** (`conciliacao_item_uk` total): desconciliar é
 *   UPDATE que preenche `desconciliado_em` — nunca DELETE (a história fica na
 *   própria linha e na trilha, CA-28); reconciliar REATIVA a mesma linha;
 * - **unicidade do objeto entre conciliações VIGENTES** via índices únicos
 *   PARCIAIS `WHERE desconciliado_em IS NULL` (`conciliacao_titulo_uk`,
 *   `conciliacao_lancamento_uk`): dois itens não conciliam o mesmo
 *   título/lançamento até o primeiro ser desconciliado (T018-F-2);
 * - FKs compostas `(…, empresa_id)` → o banco recusa vínculo cross-tenant
 *   mesmo com bug de aplicação (S-T014-6).
 */
export const conciliacao = sqliteTable(
  'conciliacao',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    empresaId: integer('empresa_id')
      .notNull()
      .references(() => empresa.id),
    itemExtratoId: integer('item_extrato_id').notNull(),
    objetoTipo: text('objeto_tipo', { enum: OBJETOS_CONCILIACAO }).notNull(),
    tituloId: integer('titulo_id'),
    lancamentoId: integer('lancamento_id'),
    conciliadoPor: integer('conciliado_por')
      .notNull()
      .references(() => usuario.id),
    conciliadoEm: text('conciliado_em')
      .notNull()
      .$defaultFn(agora),
    /** `NULL` = conciliação vigente; preenchido = desfeita (histórico, CA-28). */
    desconciliadoPor: integer('desconciliado_por').references(() => usuario.id),
    desconciliadoEm: text('desconciliado_em'),
  },
  (t) => [
    uniqueIndex('conciliacao_item_uk').on(t.itemExtratoId),
    // Parciais: só as VIGENTES disputam o objeto (desfeitas não bloqueiam).
    uniqueIndex('conciliacao_titulo_uk')
      .on(t.tituloId)
      .where(sql`${t.desconciliadoEm} IS NULL AND ${t.tituloId} IS NOT NULL`),
    uniqueIndex('conciliacao_lancamento_uk')
      .on(t.lancamentoId)
      .where(sql`${t.desconciliadoEm} IS NULL AND ${t.lancamentoId} IS NOT NULL`),
    index('conciliacao_empresa_idx').on(t.empresaId),
    foreignKey({
      columns: [t.itemExtratoId, t.empresaId],
      foreignColumns: [itemExtrato.id, itemExtrato.empresaId],
      name: 'conciliacao_item_empresa_fk',
    }),
    // Nullable: com `titulo_id`/`lancamento_id` NULL a FK não é avaliada.
    foreignKey({
      columns: [t.tituloId, t.empresaId],
      foreignColumns: [titulo.id, titulo.empresaId],
      name: 'conciliacao_titulo_empresa_fk',
    }),
    foreignKey({
      columns: [t.lancamentoId, t.empresaId],
      foreignColumns: [lancamento.id, lancamento.empresaId],
      name: 'conciliacao_lancamento_empresa_fk',
    }),
    check(
      'conciliacao_objeto_coerente',
      sql`(${t.objetoTipo} = 'titulo' AND ${t.tituloId} IS NOT NULL AND ${t.lancamentoId} IS NULL) OR (${t.objetoTipo} = 'lancamento' AND ${t.lancamentoId} IS NOT NULL AND ${t.tituloId} IS NULL)`,
    ),
  ],
);

export type Conciliacao = typeof conciliacao.$inferSelect;
export type NovaConciliacao = typeof conciliacao.$inferInsert;
