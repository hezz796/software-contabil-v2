import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  baixa,
  conta,
  contaBancaria,
  lancamento,
  partida,
  periodoContabil,
  titulo,
  SITUACOES_TITULO,
  type Conta,
  type PeriodoContabil,
  type TipoConta,
} from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { buscarContaNaEmpresa } from './contas.ts';

/**
 * Relatórios contábeis derivados (RF-10 balancete, RF-11 razão, RF-12 balanço;
 * TASK-015). **Não existe coluna de saldo**: todo saldo é apurado por consulta
 * agregada sobre `partida` + `lancamento` (e o estado dos períodos em
 * `periodo_contabil`). Saldos são centavos **assinados** — positivo = devedor
 * na perspectiva da seção (convenção documentada no schema compartilhado).
 *
 * Leitura é liberada para contador atribuído e para o administrador com
 * leitura global auditada (CA-34) — a autorização acontece na camada de rota
 * (`autorizarLeituraEmpresa`), como nos relatórios/plano já existentes.
 */

const TIPOS_RESULTADO: readonly TipoConta[] = ['receita', 'despesa'];

/** Período por id DENTRO da empresa (nunca devolve período alheio — R7). */
export async function buscarPeriodoNaEmpresa(
  db: AppDb,
  periodoId: number,
  empresaId: number,
): Promise<PeriodoContabil | undefined> {
  const linhas = await db
    .select()
    .from(periodoContabil)
    .where(and(eq(periodoContabil.id, periodoId), eq(periodoContabil.empresaId, empresaId)))
    .limit(2);
  return linhas[0];
}

interface AgregadoConta {
  contaId: number;
  debitos: number;
  creditos: number;
}

/**
 * Débitos e créditos por conta somando os lançamentos dos períodos informados
 * (uma linha por conta com movimento). A soma é feita no banco (SQLite devolve
 * inteiro para SUM sobre inteiros).
 */
function agregarPorConta(
  db: AppDb,
  empresaId: number,
  periodoIds: number[],
): AgregadoConta[] {
  if (periodoIds.length === 0) return [];
  return db
    .select({
      contaId: partida.contaId,
      debitos: sql<number>`coalesce(sum(case when ${partida.natureza} = 'D' then ${partida.valorCentavos} else 0 end), 0)`,
      creditos: sql<number>`coalesce(sum(case when ${partida.natureza} = 'C' then ${partida.valorCentavos} else 0 end), 0)`,
    })
    .from(partida)
    .innerJoin(lancamento, eq(partida.lancamentoId, lancamento.id))
    .where(and(eq(lancamento.empresaId, empresaId), inArray(lancamento.periodoId, periodoIds)))
    .groupBy(partida.contaId)
    .all();
}

/**
 * Ids dos períodos da empresa até (e incluindo) o informado, em ordem
 * cronológica — base do "acumulado até o período" do balancete (RF-10) e do
 * resultado acumulado do encerramento (RF-09).
 */
export function periodosAte(db: AppDb, empresaId: number, periodo: PeriodoContabil): number[] {
  const linhas = db
    .select({ id: periodoContabil.id })
    .from(periodoContabil)
    .where(and(eq(periodoContabil.empresaId, empresaId), periodoDoMesmoOuAnterior(periodo)))
    .orderBy(asc(periodoContabil.ano), asc(periodoContabil.mes))
    .all();
  return linhas.map((linha) => linha.id);
}

/** `(ano, mes) <= (periodo.ano, periodo.mes)` na mesma empresa. */
function periodoDoMesmoOuAnterior(periodo: PeriodoContabil) {
  return sql`(${periodoContabil.ano} < ${periodo.ano} OR (${periodoContabil.ano} = ${periodo.ano} AND ${periodoContabil.mes} <= ${periodo.mes}))`;
}

/* -------------------------------------------------------------------------- */
/* Balancete (RF-10)                                                           */
/* -------------------------------------------------------------------------- */

export interface LinhaBalancete {
  contaId: number;
  codigo: string;
  descricao: string;
  tipo: TipoConta;
  debitosCentavos: number;
  creditosCentavos: number;
  saldoPeriodoCentavos: number;
  acumuladoCentavos: number;
}

export interface Balancete {
  empresaId: number;
  periodo: PeriodoContabil;
  linhas: LinhaBalancete[];
  totais: { debitosCentavos: number; creditosCentavos: number };
}

/**
 * Balancete por empresa e período (RF-10/CA-03/CA-04): por conta, débitos e
 * créditos do período, saldo do período e acumulado até o período, com totais
 * gerais (Σ débitos = Σ créditos — invariante do partida dobrado, CA-13).
 * Lista apenas contas com movimento no período ou acumulado até ele.
 */
export async function gerarBalancete(
  db: AppDb,
  entrada: { empresaId: number; periodoId: number },
): Promise<Balancete> {
  const periodo = await buscarPeriodoNaEmpresa(db, entrada.periodoId, entrada.empresaId);
  if (!periodo) {
    throw new ErroAplicacao(404, 'Período contábil não encontrado nesta empresa.', 'periodo_nao_encontrado');
  }

  const contas = db
    .select()
    .from(conta)
    .where(eq(conta.empresaId, entrada.empresaId))
    .orderBy(asc(conta.codigo))
    .all();

  const movimentoPeriodo = new Map(
    agregarPorConta(db, entrada.empresaId, [periodo.id]).map((linha) => [linha.contaId, linha]),
  );
  const movimentoAte = new Map(
    agregarPorConta(db, entrada.empresaId, periodosAte(db, entrada.empresaId, periodo)).map(
      (linha) => [linha.contaId, linha],
    ),
  );

  const linhas: LinhaBalancete[] = [];
  let totais = { debitosCentavos: 0, creditosCentavos: 0 };
  for (const contaLinha of contas) {
    const doPeriodo = movimentoPeriodo.get(contaLinha.id);
    const ate = movimentoAte.get(contaLinha.id);
    if (!doPeriodo && !ate) continue;
    const debitos = doPeriodo?.debitos ?? 0;
    const creditos = doPeriodo?.creditos ?? 0;
    linhas.push({
      contaId: contaLinha.id,
      codigo: contaLinha.codigo,
      descricao: contaLinha.descricao,
      tipo: contaLinha.tipo,
      debitosCentavos: debitos,
      creditosCentavos: creditos,
      saldoPeriodoCentavos: debitos - creditos,
      acumuladoCentavos: (ate?.debitos ?? 0) - (ate?.creditos ?? 0),
    });
    totais = {
      debitosCentavos: totais.debitosCentavos + debitos,
      creditosCentavos: totais.creditosCentavos + creditos,
    };
  }

  return { empresaId: entrada.empresaId, periodo, linhas, totais };
}

/* -------------------------------------------------------------------------- */
/* Razão (RF-11)                                                               */
/* -------------------------------------------------------------------------- */

export interface ContraparteRazao {
  contaId: number;
  codigo: string;
  descricao: string;
  natureza: 'D' | 'C';
  valorCentavos: number;
}

export interface LinhaRazao {
  lancamentoId: number;
  data: string;
  historico: string;
  debitoCentavos: number;
  creditoCentavos: number;
  saldoCorrenteCentavos: number;
  contrapartes: ContraparteRazao[];
}

export interface Razao {
  empresaId: number;
  conta: Conta;
  de: string | null;
  ate: string | null;
  linhas: LinhaRazao[];
  totais: { debitosCentavos: number; creditosCentavos: number };
  saldoFinalCentavos: number;
}

/**
 * Razão por empresa, conta e intervalo de datas (RF-11/CA-03/CA-04): lista cada
 * lançamento que afetou a conta com data, histórico, contrapartes, débito,
 * crédito e saldo corrente. O saldo corrente é acumulado desde o início (sem
 * filtro de datas) e apenas as linhas do intervalo são listadas.
 */
export async function gerarRazao(
  db: AppDb,
  entrada: { empresaId: number; contaId: number; de?: string | undefined; ate?: string | undefined },
): Promise<Razao> {
  const contaAlvo = await buscarContaNaEmpresa(db, entrada.contaId, entrada.empresaId);
  if (!contaAlvo) {
    throw new ErroAplicacao(404, 'Conta não encontrada nesta empresa.', 'conta_nao_encontrada');
  }

  const movimento = db
    .select({
      lancamentoId: lancamento.id,
      data: lancamento.data,
      historico: lancamento.historico,
      natureza: partida.natureza,
      valorCentavos: partida.valorCentavos,
    })
    .from(partida)
    .innerJoin(lancamento, eq(partida.lancamentoId, lancamento.id))
    .where(and(eq(lancamento.empresaId, entrada.empresaId), eq(partida.contaId, entrada.contaId)))
    .orderBy(asc(lancamento.data), asc(lancamento.id))
    .all();

  // Várias partidas da MESMA conta em um lançamento viram uma única linha
  // (débito/crédito somados), como manda RF-11 ("cada lançamento").
  interface Agrupado {
    lancamentoId: number;
    data: string;
    historico: string;
    debitoCentavos: number;
    creditoCentavos: number;
  }
  const agrupados: Agrupado[] = [];
  for (const partidasLinha of movimento) {
    const anterior = agrupados.at(-1);
    if (anterior && anterior.lancamentoId === partidasLinha.lancamentoId) {
      if (partidasLinha.natureza === 'D') anterior.debitoCentavos += partidasLinha.valorCentavos;
      else anterior.creditoCentavos += partidasLinha.valorCentavos;
      continue;
    }
    agrupados.push({
      lancamentoId: partidasLinha.lancamentoId,
      data: partidasLinha.data,
      historico: partidasLinha.historico,
      debitoCentavos: partidasLinha.natureza === 'D' ? partidasLinha.valorCentavos : 0,
      creditoCentavos: partidasLinha.natureza === 'C' ? partidasLinha.valorCentavos : 0,
    });
  }

  const linhas: LinhaRazao[] = [];
  let saldoCorrente = 0;
  let saldoFinal = 0;
  let totais = { debitosCentavos: 0, creditosCentavos: 0 };
  for (const linha of agrupados) {
    saldoCorrente += linha.debitoCentavos - linha.creditoCentavos;
    // `ate` corta o saldo final: linhas posteriores não entram nem no saldo.
    if (entrada.ate && linha.data > entrada.ate) continue;
    saldoFinal = saldoCorrente;
    if (entrada.de && linha.data < entrada.de) continue;
    const contrapartes = buscarContrapartes(db, linha.lancamentoId, entrada.contaId);
    linhas.push({ ...linha, saldoCorrenteCentavos: saldoCorrente, contrapartes });
    totais = {
      debitosCentavos: totais.debitosCentavos + linha.debitoCentavos,
      creditosCentavos: totais.creditosCentavos + linha.creditoCentavos,
    };
  }

  return {
    empresaId: entrada.empresaId,
    conta: contaAlvo,
    de: entrada.de ?? null,
    ate: entrada.ate ?? null,
    linhas,
    totais,
    saldoFinalCentavos: saldoFinal,
  };
}

/** Partidas de OUTRAS contas no lançamento (contrapartes do razão). */
function buscarContrapartes(db: AppDb, lancamentoId: number, contaExcluida: number): ContraparteRazao[] {
  const linhas = db
    .select({
      contaId: partida.contaId,
      codigo: conta.codigo,
      descricao: conta.descricao,
      natureza: partida.natureza,
      valorCentavos: partida.valorCentavos,
    })
    .from(partida)
    .innerJoin(conta, eq(partida.contaId, conta.id))
    .where(and(eq(partida.lancamentoId, lancamentoId), sql`${partida.contaId} != ${contaExcluida}`))
    .orderBy(asc(partida.id))
    .all();
  return linhas;
}

/* -------------------------------------------------------------------------- */
/* Balanço patrimonial (RF-12)                                                 */
/* -------------------------------------------------------------------------- */

export interface LinhaBalanco {
  contaId: number;
  codigo: string;
  descricao: string;
  tipo: TipoConta;
  saldoCentavos: number;
}

export interface SecaoBalanco {
  linhas: LinhaBalanco[];
  totalCentavos: number;
}

export interface Balanco {
  empresaId: number;
  data: string;
  ativo: SecaoBalanco;
  passivo: SecaoBalanco;
  patrimonioLiquido: SecaoBalanco;
  totais: {
    ativoCentavos: number;
    passivoCentavos: number;
    patrimonioLiquidoCentavos: number;
    confere: boolean;
  };
}

/**
 * Balanço patrimonial por empresa e data (RF-12/CA-05): seções de ativo,
 * passivo e patrimônio líquido agrupadas por conta do plano. O PL inclui as
 * contas permanentes de patrimônio líquido E o resultado do período (receita e
 * despesa), de modo que `ativo − passivo − PL = 0` confere por construção
 * (todo lançamento é equilibrado — CA-13). Lista apenas contas com saldo.
 */
export async function gerarBalanco(
  db: AppDb,
  entrada: { empresaId: number; data: string },
): Promise<Balanco> {
  const agregado = db
    .select({
      contaId: partida.contaId,
      debitos: sql<number>`coalesce(sum(case when ${partida.natureza} = 'D' then ${partida.valorCentavos} else 0 end), 0)`,
      creditos: sql<number>`coalesce(sum(case when ${partida.natureza} = 'C' then ${partida.valorCentavos} else 0 end), 0)`,
    })
    .from(partida)
    .innerJoin(lancamento, eq(partida.lancamentoId, lancamento.id))
    .innerJoin(conta, eq(partida.contaId, conta.id))
    .where(and(eq(lancamento.empresaId, entrada.empresaId), sql`${lancamento.data} <= ${entrada.data}`))
    .groupBy(partida.contaId)
    .all();

  const contas = db
    .select()
    .from(conta)
    .where(eq(conta.empresaId, entrada.empresaId))
    .orderBy(asc(conta.codigo))
    .all();
  const porId = new Map(contas.map((linha) => [linha.id, linha]));

  const ativo: LinhaBalanco[] = [];
  const passivo: LinhaBalanco[] = [];
  const patrimonioLiquido: LinhaBalanco[] = [];
  for (const item of agregado) {
    const contaLinha = porId.get(item.contaId);
    if (!contaLinha) continue;
    const saldo = item.debitos - item.creditos; // assinado: D − C
    if (saldo === 0) continue;
    const linha: LinhaBalanco = {
      contaId: contaLinha.id,
      codigo: contaLinha.codigo,
      descricao: contaLinha.descricao,
      tipo: contaLinha.tipo,
      // Convenção da seção: ativo positivo = devedor; passivo/PL positivo = credor.
      saldoCentavos: contaLinha.tipo === 'ativo' ? saldo : -saldo,
    };
    if (contaLinha.tipo === 'ativo') ativo.push(linha);
    else if (contaLinha.tipo === 'passivo') passivo.push(linha);
    else patrimonioLiquido.push(linha); // patrimonio_liquido, receita e despesa compõem o PL
  }

  const somar = (linhas: LinhaBalanco[]): SecaoBalanco => ({
    linhas,
    totalCentavos: linhas.reduce((total, linha) => total + linha.saldoCentavos, 0),
  });
  const secaoAtivo = somar(ativo);
  const secaoPassivo = somar(passivo);
  const secaoPl = somar(patrimonioLiquido);
  const confere =
    secaoAtivo.totalCentavos - secaoPassivo.totalCentavos - secaoPl.totalCentavos === 0;

  return {
    empresaId: entrada.empresaId,
    data: entrada.data,
    ativo: secaoAtivo,
    passivo: secaoPassivo,
    patrimonioLiquido: secaoPl,
    totais: {
      ativoCentavos: secaoAtivo.totalCentavos,
      passivoCentavos: secaoPassivo.totalCentavos,
      patrimonioLiquidoCentavos: secaoPl.totalCentavos,
      confere,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Saldo acumulado das contas de resultado (base do encerramento — RF-09)      */
/* -------------------------------------------------------------------------- */

export interface SaldoResultado {
  conta: Conta;
  /** Débito − crédito acumulados até o fim do período (positivo = devedor). */
  saldoCentavos: number;
}

/**
 * Saldos acumulados das contas de resultado (receita/despesa) até e incluindo
 * o período informado — é o resultado a ser zerado/transferido ao encerrar
 * (RF-09: "zera as contas de resultado"; H12: transferência ao PL).
 */
export function saldosResultadoAtePeriodo(
  db: AppDb,
  empresaId: number,
  periodo: PeriodoContabil,
): SaldoResultado[] {
  const agregado = agregarPorConta(db, empresaId, periodosAte(db, empresaId, periodo));
  const contas = db
    .select()
    .from(conta)
    .where(and(eq(conta.empresaId, empresaId), inArray(conta.tipo, TIPOS_RESULTADO)))
    .orderBy(asc(conta.codigo))
    .all();

  const porId = new Map(agregado.map((linha) => [linha.contaId, linha]));
  const saldos: SaldoResultado[] = [];
  for (const contaLinha of contas) {
    const item = porId.get(contaLinha.id);
    if (!item) continue;
    const saldo = item.debitos - item.creditos;
    if (saldo !== 0) saldos.push({ conta: contaLinha, saldoCentavos: saldo });
  }
  return saldos;
}

/* -------------------------------------------------------------------------- */
/* Fluxo de caixa (RF-17, TASK-019)                                            */
/* -------------------------------------------------------------------------- */

export interface DiaFluxoDeCaixa {
  data: string;
  entradasRealizadasCentavos: number;
  saidasRealizadasCentavos: number;
  entradasPrevistasCentavos: number;
  saidasPrevistasCentavos: number;
  /** Saldo ao fim do dia (positivo = caixa a favor; pode ficar negativo). */
  saldoAcumuladoCentavos: number;
}

export interface FluxoDeCaixa {
  empresaId: number;
  de: string;
  ate: string;
  /** Σ `saldo_inicial_centavos` das contas bancárias com `data_saldo_inicial <= de` (F-1). */
  saldoInicialCentavos: number;
  /** Apenas dias com movimento, em ordem cronológica. */
  linhas: DiaFluxoDeCaixa[];
  totais: {
    entradasRealizadasCentavos: number;
    saidasRealizadasCentavos: number;
    entradasPrevistasCentavos: number;
    saidasPrevistasCentavos: number;
  };
  /** Identidade do RF-17/CA-09: saldo_inicial + entradas − saídas. */
  saldoFinalCentavos: number;
}

/** Títulos em aberto/parcial são os que ainda podem virar caixa (previstos). */
const SITUACOES_EM_ABERTO = SITUACOES_TITULO.filter(
  (situacao) => situacao === 'aberto' || situacao === 'parcial',
);

/**
 * Fluxo de caixa por empresa e intervalo de datas (RF-17/CA-09):
 * - **saldo inicial (F-1):** Σ `saldo_inicial_centavos` das contas bancárias
 *   DA EMPRESA com `data_saldo_inicial <= de` (contas declaradas depois do
 *   início e contas de outras empresas ficam de fora);
 * - **realizadas (F-3):** baixas **vigentes** (`estorno_lancamento_id IS NULL`)
 *   do intervalo, pelo valor de caixa líquido (`valor − retenção + encargos`);
 *   baixa estornada não conta;
 * - **previstas (F-3):** `saldo_centavos` residual dos títulos em aberto
 *   (`situacao IN ('aberto','parcial')`) posicionado no vencimento; título
 *   pago/cancelado deixa de ser previsto.
 *
 * Agrupa por dia (dias sem movimento não geram linha) e acumula o saldo dia a
 * dia, de modo que `saldo_inicial + entradas − saídas = saldo_final` confere
 * por construção (CA-09).
 */
export async function gerarFluxoDeCaixa(
  db: AppDb,
  entrada: { empresaId: number; de: string; ate: string },
): Promise<FluxoDeCaixa> {
  const contasIniciais = db
    .select({ saldoInicialCentavos: contaBancaria.saldoInicialCentavos })
    .from(contaBancaria)
    .where(
      and(
        eq(contaBancaria.empresaId, entrada.empresaId),
        lte(contaBancaria.dataSaldoInicial, entrada.de),
      ),
    )
    .all();
  const saldoInicialCentavos = contasIniciais.reduce(
    (total, linha) => total + linha.saldoInicialCentavos,
    0,
  );

  interface MovimentoDia {
    data: string;
    entradasRealizadasCentavos: number;
    saidasRealizadasCentavos: number;
    entradasPrevistasCentavos: number;
    saidasPrevistasCentavos: number;
  }
  const porDia = new Map<string, MovimentoDia>();
  const diaDe = (data: string): MovimentoDia => {
    const existente = porDia.get(data);
    if (existente) return existente;
    const novo: MovimentoDia = {
      data,
      entradasRealizadasCentavos: 0,
      saidasRealizadasCentavos: 0,
      entradasPrevistasCentavos: 0,
      saidasPrevistasCentavos: 0,
    };
    porDia.set(data, novo);
    return novo;
  };

  // Realizadas: baixas vigentes do intervalo, pelo valor de caixa (F-3).
  const baixas = db
    .select({
      data: baixa.data,
      tipo: titulo.tipo,
      caixaCentavos: sql<number>`${baixa.valorCentavos} - ${baixa.retencaoCentavos} + ${baixa.encargosCentavos}`,
    })
    .from(baixa)
    .innerJoin(titulo, eq(baixa.tituloId, titulo.id))
    .where(
      and(
        eq(baixa.empresaId, entrada.empresaId),
        isNull(baixa.estornoLancamentoId),
        gte(baixa.data, entrada.de),
        lte(baixa.data, entrada.ate),
      ),
    )
    .all();
  for (const baixaLinha of baixas) {
    const movimento = diaDe(baixaLinha.data);
    if (baixaLinha.tipo === 'receber') {
      movimento.entradasRealizadasCentavos += baixaLinha.caixaCentavos;
    } else {
      movimento.saidasRealizadasCentavos += baixaLinha.caixaCentavos;
    }
  }

  // Previstas: vencimentos dos títulos em aberto no intervalo (saldo residual).
  const vencimentos = db
    .select({
      data: titulo.vencimento,
      tipo: titulo.tipo,
      saldoCentavos: titulo.saldoCentavos,
    })
    .from(titulo)
    .where(
      and(
        eq(titulo.empresaId, entrada.empresaId),
        inArray(titulo.situacao, SITUACOES_EM_ABERTO),
        gte(titulo.vencimento, entrada.de),
        lte(titulo.vencimento, entrada.ate),
      ),
    )
    .all();
  for (const tituloLinha of vencimentos) {
    const movimento = diaDe(tituloLinha.data);
    if (tituloLinha.tipo === 'receber') {
      movimento.entradasPrevistasCentavos += tituloLinha.saldoCentavos;
    } else {
      movimento.saidasPrevistasCentavos += tituloLinha.saldoCentavos;
    }
  }

  const totais = {
    entradasRealizadasCentavos: 0,
    saidasRealizadasCentavos: 0,
    entradasPrevistasCentavos: 0,
    saidasPrevistasCentavos: 0,
  };
  const linhas: DiaFluxoDeCaixa[] = [];
  let acumulado = saldoInicialCentavos;
  const ordenados = [...porDia.values()].sort((a, b) => (a.data < b.data ? -1 : 1));
  for (const movimento of ordenados) {
    acumulado +=
      movimento.entradasRealizadasCentavos +
      movimento.entradasPrevistasCentavos -
      movimento.saidasRealizadasCentavos -
      movimento.saidasPrevistasCentavos;
    linhas.push({ ...movimento, saldoAcumuladoCentavos: acumulado });
    totais.entradasRealizadasCentavos += movimento.entradasRealizadasCentavos;
    totais.saidasRealizadasCentavos += movimento.saidasRealizadasCentavos;
    totais.entradasPrevistasCentavos += movimento.entradasPrevistasCentavos;
    totais.saidasPrevistasCentavos += movimento.saidasPrevistasCentavos;
  }

  return {
    empresaId: entrada.empresaId,
    de: entrada.de,
    ate: entrada.ate,
    saldoInicialCentavos,
    linhas,
    totais,
    saldoFinalCentavos: acumulado,
  };
}
