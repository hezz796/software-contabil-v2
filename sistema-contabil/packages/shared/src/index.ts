import { z } from 'zod';
import { normalizarCnpj, validarCnpj } from './cnpj.ts';

export { formatarCnpj, montarCnpj, normalizarCnpj, validarCnpj } from './cnpj.ts';

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

/* -------------------------------------------------------------------------- */
/* Empresas, gestão de usuários e permissões (TASK-012)                        */
/* -------------------------------------------------------------------------- */

/**
 * CNPJ validado na entrada (RF-01, CA-15): aceita com ou sem pontuação e é
 * normalizado para 14 dígitos. As mensagens são específicas por caso — vazio,
 * tamanho errado e dígito verificador não conferem são recusas distintas.
 */
export const cnpjSchema = z
  .string({ error: 'Informe o CNPJ.' })
  .trim()
  .min(1, 'Informe o CNPJ.')
  .transform(normalizarCnpj)
  .refine((valor) => valor.length === 14, 'O CNPJ deve conter 14 dígitos.')
  .refine(validarCnpj, 'CNPJ inválido: os dígitos verificadores não conferem.');

/** Razão social da empresa (RF-01): obrigatória, não pode ser vazia. */
export const razaoSocialSchema = z
  .string({ error: 'Informe a razão social da empresa.' })
  .trim()
  .min(1, 'Informe a razão social da empresa.')
  .max(200, 'A razão social deve ter no máximo 200 caracteres.');

/** Situação da empresa (H13: sem exclusão dura — apenas ativa/inativa). */
export const situacaoEmpresaSchema = z.enum(['ativa', 'inativa']);
export type SituacaoEmpresa = z.infer<typeof situacaoEmpresaSchema>;

/** Empresa devolvida pela API (nunca expõe nada além do cadastro). */
export const empresaSchema = z.object({
  id: z.number().int(),
  razao_social: z.string(),
  /** Normalizado (14 dígitos). */
  cnpj: z.string(),
  situacao: situacaoEmpresaSchema,
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
});

export type EmpresaDTO = z.infer<typeof empresaSchema>;

export const criarEmpresaRequestSchema = z.object({
  razao_social: razaoSocialSchema,
  cnpj: cnpjSchema,
  situacao: situacaoEmpresaSchema.optional(),
});

export type CriarEmpresaRequest = z.infer<typeof criarEmpresaRequestSchema>;

export const atualizarEmpresaRequestSchema = z
  .object({
    razao_social: razaoSocialSchema.optional(),
    cnpj: cnpjSchema.optional(),
    situacao: situacaoEmpresaSchema.optional(),
  })
  .refine(
    (valor) =>
      valor.razao_social !== undefined || valor.cnpj !== undefined || valor.situacao !== undefined,
    'Informe ao menos um campo para atualizar (razão social, CNPJ ou situação).',
  );

export type AtualizarEmpresaRequest = z.infer<typeof atualizarEmpresaRequestSchema>;

export const listaEmpresasResponseSchema = z.object({
  empresas: z.array(empresaSchema),
});

export type ListaEmpresasResponse = z.infer<typeof listaEmpresasResponseSchema>;

/** Criação de usuário pelo administrador (RF-02). Senha segue H15 (>= 8). */
export const criarUsuarioRequestSchema = z.object({
  email: emailSchema,
  senha: senhaSchema,
  papel: papelSchema,
  empresa_ids: z.array(z.number().int().positive()).optional(),
});

export type CriarUsuarioRequest = z.infer<typeof criarUsuarioRequestSchema>;

/** Edição de usuário pelo administrador: ao menos um campo. */
export const atualizarUsuarioRequestSchema = z
  .object({
    email: emailSchema.optional(),
    senha: senhaSchema.optional(),
    papel: papelSchema.optional(),
  })
  .refine(
    (valor) => valor.email !== undefined || valor.senha !== undefined || valor.papel !== undefined,
    'Informe ao menos um campo para atualizar (e-mail, senha ou papel).',
  );

export type AtualizarUsuarioRequest = z.infer<typeof atualizarUsuarioRequestSchema>;

export const situacaoUsuarioRequestSchema = z.object({
  ativo: z.boolean(),
});

export type SituacaoUsuarioRequest = z.infer<typeof situacaoUsuarioRequestSchema>;

export const atribuicaoEmpresaRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
});

export type AtribuicaoEmpresaRequest = z.infer<typeof atribuicaoEmpresaRequestSchema>;

/** Usuário no contexto de gestão do administrador — sem senha, jamais. */
export const usuarioGestaoSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  papel: papelSchema,
  ativo: z.boolean(),
  empresa_ids: z.array(z.number().int()),
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
});

export type UsuarioGestao = z.infer<typeof usuarioGestaoSchema>;

export const listaUsuariosResponseSchema = z.object({
  usuarios: z.array(usuarioGestaoSchema),
});

export type ListaUsuariosResponse = z.infer<typeof listaUsuariosResponseSchema>;

export const atribuicoesResponseSchema = z.object({
  empresa_ids: z.array(z.number().int()),
});

export type AtribuicoesResponse = z.infer<typeof atribuicoesResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Plano de contas e períodos contábeis (TASK-013, RF-06/RF-09)                */
/* -------------------------------------------------------------------------- */

/**
 * Tipos de conta do plano (RF-06, ADR-0001): ativo, passivo, patrimônio
 * líquido, receita e despesa. Obrigatório na criação — CA-17 recusa tipo
 * ausente com mensagem específica citando as opções.
 */
export const tipoContaSchema = z.enum(
  ['ativo', 'passivo', 'patrimonio_liquido', 'receita', 'despesa'],
  { error: 'Selecione o tipo da conta (ativo, passivo, patrimônio líquido, receita ou despesa).' },
);
export type TipoContaDTO = z.infer<typeof tipoContaSchema>;

/** Situação da conta (RF-06): ativa/inativa — sem exclusão dura (CA-17/CE-13). */
export const situacaoContaSchema = z.enum(['ativa', 'inativa']);
export type SituacaoConta = z.infer<typeof situacaoContaSchema>;

/**
 * Código da conta (RF-06): obrigatório e único POR EMPRESA (não global) — o
 * mesmo código pode existir em empresas diferentes (CA-17).
 */
export const codigoContaSchema = z
  .string({ error: 'Informe o código da conta.' })
  .trim()
  .min(1, 'Informe o código da conta.')
  .max(30, 'O código da conta deve ter no máximo 30 caracteres.');

/** Descrição da conta (RF-06): obrigatória. */
export const descricaoContaSchema = z
  .string({ error: 'Informe a descrição da conta.' })
  .trim()
  .min(1, 'Informe a descrição da conta.')
  .max(200, 'A descrição da conta deve ter no máximo 200 caracteres.');

/** Conta do plano devolvida pela API. */
export const contaSchema = z.object({
  id: z.number().int(),
  empresa_id: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: tipoContaSchema,
  /** `null` = conta de nível raiz. */
  conta_pai_id: z.number().int().nullable(),
  situacao: situacaoContaSchema,
  /** Contas com lançamentos só inativam, nunca excluem (CA-17/CA-27/CE-13). */
  tem_lancamentos: z.boolean(),
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
  atualizado_em: z.iso.datetime(),
});

export type ContaDTO = z.infer<typeof contaSchema>;

/** Criação de conta (RF-06): `empresa_id` é obrigatório e validado pelo guard de escrita. */
export const criarContaRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
  codigo: codigoContaSchema,
  descricao: descricaoContaSchema,
  tipo: tipoContaSchema,
  conta_pai_id: z.number().int().positive().nullish(),
  situacao: situacaoContaSchema.optional(),
});

export type CriarContaRequest = z.infer<typeof criarContaRequestSchema>;

/** Edição de conta: descrição, tipo e/ou situação. Código e pai são imutáveis (decisão T013). */
export const atualizarContaRequestSchema = z
  .object({
    descricao: descricaoContaSchema.optional(),
    tipo: tipoContaSchema.optional(),
    situacao: situacaoContaSchema.optional(),
  })
  .refine(
    (valor) =>
      valor.descricao !== undefined || valor.tipo !== undefined || valor.situacao !== undefined,
    'Informe ao menos um campo para atualizar (descrição, tipo ou situação).',
  );

export type AtualizarContaRequest = z.infer<typeof atualizarContaRequestSchema>;

/** Filtros de `GET /contas`: empresa obrigatória; `somente_ativas` tira as inativas das escolhas novas. */
export const contasQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
  somente_ativas: z.enum(['true', 'false']).optional(),
});

export type ContasQuery = z.infer<typeof contasQuerySchema>;

export const listaContasResponseSchema = z.object({
  contas: z.array(contaSchema),
});

export type ListaContasResponse = z.infer<typeof listaContasResponseSchema>;

/** Ano do período contábil (RF-09): inteiro em faixa plausível. */
export const anoPeriodoSchema = z
  .coerce.number({ error: 'Informe o ano do período contábil (ex.: 2026).' })
  .int('O ano do período contábil deve ser um número inteiro (ex.: 2026).')
  .min(1900, 'O ano do período contábil deve estar entre 1900 e 9999.')
  .max(9999, 'O ano do período contábil deve estar entre 1900 e 9999.');

/** Mês do período contábil (RF-09): 1 a 12. */
export const mesPeriodoSchema = z
  .coerce.number({ error: 'Informe o mês do período contábil (1 a 12).' })
  .int('O mês do período contábil deve ser um número inteiro de 1 a 12.')
  .min(1, 'O mês do período contábil deve estar entre 1 e 12.')
  .max(12, 'O mês do período contábil deve estar entre 1 e 12.');

/** Situação do período (RF-09): aberto/encerrado (o encerramento em si é T015). */
export const situacaoPeriodoSchema = z.enum(['aberto', 'encerrado']);
export type SituacaoPeriodo = z.infer<typeof situacaoPeriodoSchema>;

/** Período contábil devolvido pela API. */
export const periodoContabilSchema = z.object({
  id: z.number().int(),
  empresa_id: z.number().int(),
  ano: z.number().int(),
  mes: z.number().int(),
  situacao: situacaoPeriodoSchema,
  /** ISO-8601 UTC; `null` enquanto aberto. */
  encerrado_em: z.iso.datetime().nullable(),
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
});

export type PeriodoContabilDTO = z.infer<typeof periodoContabilSchema>;

/** Criação de período contábil mensal (RF-09): único por (empresa, ano, mês). */
export const criarPeriodoRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
  ano: anoPeriodoSchema,
  mes: mesPeriodoSchema,
});

export type CriarPeriodoRequest = z.infer<typeof criarPeriodoRequestSchema>;

/** Filtros de `GET /periodos`: empresa obrigatória. */
export const periodosQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
});

export type PeriodosQuery = z.infer<typeof periodosQuerySchema>;

export const listaPeriodosResponseSchema = z.object({
  periodos: z.array(periodoContabilSchema),
});

export type ListaPeriodosResponse = z.infer<typeof listaPeriodosResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Lançamentos em partidas dobradas, imutabilidade e estorno (TASK-014)        */
/* -------------------------------------------------------------------------- */

/**
 * Natureza da partida (RF-07, H7): débito (`D`) ou crédito (`C`). Valores são
 * sempre positivos; o sentido vem da natureza.
 */
export const naturezaSchema = z.enum(['D', 'C'], {
  error: 'A natureza da partida deve ser débito (D) ou crédito (C).',
});
export type NaturezaDTO = z.infer<typeof naturezaSchema>;

/**
 * Valor da partida em centavos (inteiros, nunca float — ADR-0001): obrigatório
 * e **maior que zero** (CA-14b/c: zero e negativo são recusados com mensagem).
 */
export const valorPartidaSchema = z
  .number({ error: 'Informe o valor da partida em centavos.' })
  .int('O valor da partida deve ser um número inteiro de centavos.')
  .positive('O valor da partida deve ser maior que zero (em centavos).');

/** Partida enviada na gravação (RF-07): conta, natureza e valor. */
export const partidaRequestSchema = z.object({
  conta_id: z
    .number({ error: 'Informe a conta de cada partida.' })
    .int('O id da conta da partida deve ser um número inteiro.')
    .positive('Informe a conta de cada partida.'),
  natureza: naturezaSchema,
  valor_centavos: valorPartidaSchema,
});

export type PartidaRequest = z.infer<typeof partidaRequestSchema>;

/** Data de lançamento/estorno: `AAAA-MM-DD` real (CA-14e: formato inválido recusado). */
export const dataLancamentoSchema = z.iso.date({
  error: 'Informe a data no formato AAAA-MM-DD.',
});

/** Histórico do lançamento (RF-07): obrigatório. */
export const historicoSchema = z
  .string({ error: 'Informe o histórico do lançamento.' })
  .trim()
  .min(1, 'Informe o histórico do lançamento.')
  .max(200, 'O histórico do lançamento deve ter no máximo 200 caracteres.');

/**
 * Gravação de lançamento (RF-07): `partidas` com no mínimo DUAS (CA-14a) e o
 * servidor ainda exige Σ débitos = Σ créditos (CA-13), contas da empresa e
 * data em período contábil aberto (CA-24).
 */
export const criarLancamentoRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
  data: dataLancamentoSchema,
  historico: historicoSchema,
  partidas: z
    .array(partidaRequestSchema)
    .min(2, 'O lançamento deve ter ao menos duas partidas (uma de débito e outra de crédito).'),
});

export type CriarLancamentoRequest = z.infer<typeof criarLancamentoRequestSchema>;

/** Partida devolvida pela API. */
export const partidaSchema = z.object({
  conta_id: z.number().int(),
  natureza: naturezaSchema,
  valor_centavos: z.number().int(),
});

export type PartidaDTO = z.infer<typeof partidaSchema>;

/**
 * Lançamento devolvido pela API (imutável após gravação — RF-08/R9).
 * `estorno_de_id` nulo = original; id do original quando este É um estorno.
 */
export const lancamentoSchema = z.object({
  id: z.number().int(),
  empresa_id: z.number().int(),
  /** Período contábil resolvido no SERVIDOR a partir da data. */
  periodo_id: z.number().int(),
  data: dataLancamentoSchema,
  historico: z.string(),
  estorno_de_id: z.number().int().nullable(),
  partidas: z.array(partidaSchema),
  criado_por: z.number().int(),
  /** ISO-8601 UTC. */
  criado_em: z.iso.datetime(),
});

export type LancamentoDTO = z.infer<typeof lancamentoSchema>;

/**
 * Estorno (RF-08): gera novo lançamento INVERSO vinculado ao original. `data`
 * opcional (padrão do servidor: hoje) e deve cair em período **aberto**
 * (CA-24); um lançamento só é estornado uma vez (CA-26).
 */
export const estornarLancamentoRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
  data: dataLancamentoSchema.optional(),
});

export type EstornarLancamentoRequest = z.infer<typeof estornarLancamentoRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Relatórios contábeis: balancete, razão e balanço (TASK-015, RF-10..RF-12)   */
/* -------------------------------------------------------------------------- */

/**
 * Convenção de sinal de todo relatório (decisão T015): saldos são inteiros em
 * centavos **assinados** — positivo = saldo devedor na perspectiva da seção
 * (ativo: débito − crédito; passivo/PL: crédito − débito). Negativo = credor.
 * Os campos `*_centavos` seguem o ADR-0001 (nunca float).
 */

/** `empresa_id` + `periodo_id` do balancete (RF-10). */
export const balanceteQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
  periodo_id: z.coerce.number().int().positive('periodo_id é obrigatório.'),
});

export type BalanceteQuery = z.infer<typeof balanceteQuerySchema>;

/** Conta no balancete (RF-10): movimento do período + acumulado até ele. */
export const linhaBalanceteSchema = z.object({
  conta_id: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: tipoContaSchema,
  debitos_centavos: z.number().int(),
  creditos_centavos: z.number().int(),
  /** Débitos − créditos do período (positivo = devedor). */
  saldo_periodo_centavos: z.number().int(),
  /** Débitos − créditos acumulados até o fim do período (positivo = devedor). */
  acumulado_centavos: z.number().int(),
});

export type LinhaBalanceteDTO = z.infer<typeof linhaBalanceteSchema>;

export const balanceteResponseSchema = z.object({
  empresa_id: z.number().int(),
  periodo: periodoContabilSchema,
  /** Apenas contas com movimento no período ou acumulado até ele. */
  linhas: z.array(linhaBalanceteSchema),
  /** Garantia RF-10: débitos = créditos em qualquer momento. */
  totais: z.object({
    debitos_centavos: z.number().int(),
    creditos_centavos: z.number().int(),
  }),
});

export type BalanceteResponse = z.infer<typeof balanceteResponseSchema>;

/** Filtros do razão (RF-11): conta obrigatória; intervalo de datas opcional. */
export const razaoQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
  conta_id: z.coerce.number().int().positive('conta_id é obrigatório.'),
  de: dataLancamentoSchema.optional(),
  ate: dataLancamentoSchema.optional(),
});

export type RazaoQuery = z.infer<typeof razaoQuerySchema>;

/** Partida de outra conta no mesmo lançamento (contraparte listada no razão). */
export const contraparteRazaoSchema = z.object({
  conta_id: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  natureza: naturezaSchema,
  valor_centavos: z.number().int(),
});

export type ContraparteRazaoDTO = z.infer<typeof contraparteRazaoSchema>;

/** Lançamento no razão (RF-11): data, histórico, débito/crédito, saldo corrente. */
export const linhaRazaoSchema = z.object({
  lancamento_id: z.number().int(),
  data: dataLancamentoSchema,
  historico: z.string(),
  /** Somas das partidas DESTA conta no lançamento (0 quando não há). */
  debito_centavos: z.number().int(),
  credito_centavos: z.number().int(),
  /** Débito − crédito acumulados da conta desde o início até esta linha. */
  saldo_corrente_centavos: z.number().int(),
  contrapartes: z.array(contraparteRazaoSchema),
});

export type LinhaRazaoDTO = z.infer<typeof linhaRazaoSchema>;

export const razaoResponseSchema = z.object({
  empresa_id: z.number().int(),
  conta: z.object({
    id: z.number().int(),
    codigo: z.string(),
    descricao: z.string(),
    tipo: tipoContaSchema,
  }),
  /** `null` = sem limite inferior/superior. */
  de: dataLancamentoSchema.nullable(),
  ate: dataLancamentoSchema.nullable(),
  linhas: z.array(linhaRazaoSchema),
  total_debitos_centavos: z.number().int(),
  total_creditos_centavos: z.number().int(),
  /** Saldo da última linha (ou 0 sem movimento no intervalo). */
  saldo_final_centavos: z.number().int(),
});

export type RazaoResponse = z.infer<typeof razaoResponseSchema>;

/** Filtros do balanço patrimonial (RF-12): empresa + data de corte. */
export const balancoQuerySchema = z.object({
  empresa_id: z.coerce.number().int().positive('empresa_id é obrigatório.'),
  data: dataLancamentoSchema,
});

export type BalancoQuery = z.infer<typeof balancoQuerySchema>;

export const linhaBalancoSchema = z.object({
  conta_id: z.number().int(),
  codigo: z.string(),
  descricao: z.string(),
  tipo: tipoContaSchema,
  /** Convênção da seção: ativo = D − C; passivo/PL = C − D (positivo = saldo). */
  saldo_centavos: z.number().int(),
});

export type LinhaBalancoDTO = z.infer<typeof linhaBalancoSchema>;

export const secaoBalancoSchema = z.object({
  linhas: z.array(linhaBalancoSchema),
  total_centavos: z.number().int(),
});

export type SecaoBalancoDTO = z.infer<typeof secaoBalancoSchema>;

export const balancoResponseSchema = z.object({
  empresa_id: z.number().int(),
  data: dataLancamentoSchema,
  ativo: secaoBalancoSchema,
  passivo: secaoBalancoSchema,
  /** Contas de PL permanentes + resultado do período (receita − despesa). */
  patrimonio_liquido: secaoBalancoSchema,
  /** Igualdade patrimonial visível (RF-12/CA-05): ativo − passivo − PL = 0. */
  totais: z.object({
    ativo_centavos: z.number().int(),
    passivo_centavos: z.number().int(),
    patrimonio_liquido_centavos: z.number().int(),
    confere: z.boolean(),
  }),
});

export type BalancoResponse = z.infer<typeof balancoResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Encerramento de período e exercício (TASK-015, RF-09/H12, CA-31/CA-32)      */
/* -------------------------------------------------------------------------- */

/**
 * Encerramento (RF-09): ação do contador com escrita ativa (F13). Semântica
 * única desde a decisão humana de 2026-10-21, corrigida em 2026-10-22
 * (CA-31 literal; TASK-015): **todo** encerramento (mês comum ou 12º do
 * ano-calendário) gera o lançamento que zera as contas de resultado sempre
 * que ALGUMA delas tem acumulado não nulo (mesmo com líquido zero — nesse
 * caso só as inversões, sem linha de PL); o resultado líquido vai à conta
 * `conta_resultado_id` (tipo patrimônio líquido) quando difere de zero,
 * datado no último dia do período — exigida nesse caso; período sem
 * movimento de resultado fecha sem lançamento. O **exercício** (12º período
 * — H12) é o fechamento que, além disso, exige os 11 períodos anteriores
 * encerrados e é auditado como `exercicio.encerramento`.
 */
export const encerrarPeriodoRequestSchema = z.object({
  empresa_id: z.number().int().positive('empresa_id é obrigatório.'),
  conta_resultado_id: z.number().int().positive().nullish(),
});

export type EncerrarPeriodoRequest = z.infer<typeof encerrarPeriodoRequestSchema>;

export const encerramentoPeriodoResponseSchema = z.object({
  periodo: periodoContabilSchema,
  /** true quando o período encerrado era o 12º do ano-calendário (encerramento do exercício — H12). */
  exercicio_encerrado: z.boolean(),
  /** Σ (débito − crédito) das contas de resultado até o período; negativo = lucro. */
  resultado_centavos: z.number().int(),
  /**
   * Lançamento gerado pelo encerramento para zerar as contas de resultado
   * (inversões + linha de PL quando o líquido difere de zero); **null quando
   * nenhuma conta de resultado tem acumulado** (nada a zerar — em qualquer
   * mês).
   */
  lancamento_encerramento_id: z.number().int().nullable(),
});

export type EncerramentoPeriodoResponse = z.infer<typeof encerramentoPeriodoResponseSchema>;
