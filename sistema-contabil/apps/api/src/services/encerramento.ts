import { and, asc, eq } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import { lancamento, partida, periodoContabil, type PeriodoContabil } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';
import { buscarContaNaEmpresa } from './contas.ts';
import { buscarPeriodoNaEmpresa, saldosResultadoAtePeriodo } from './relatorios.ts';

/**
 * Encerramento de período contábil e do exercício (RF-09/H12, CA-31/CA-32;
 * TASK-015).
 *
 * Semântica UNIFICADA (decisão humana de 2026-10-21 — ver
 * `TASK-015.json:assumptions`): **todo encerramento** (mês comum ou 12º) grava
 * o lançamento que zera as contas de resultado e leva o resultado líquido à
 * conta de PL informada (`conta_resultado_id`), datado no último dia do
 * período, com o período ainda aberto. É o que CA-31 pede literalmente ("zera
 * as contas de resultado … no balancete seguinte") e o mesmo verbo do CA-32
 * ("as contas de resultado ficam zeradas"). Como os fechamentos mensais já
 * transferem, o acumulado no 12º mês é só o de dezembro — "transfere o
 * resultado acumulado" (CA-32) segue verdadeiro nos dois cenários (meses 1-11
 * encerrados ou não). Se NENHUMA conta de resultado tem acumulado não nulo não
 * há lançamento (nada a zerar — economia mantida); correção de 2026-10-22:
 * líquido zero COM movimento ainda gera lançamento (as inversões se fecham
 * entre si, sem linha de PL) — ver `TASK-015.json:assumptions`.
 *
 * O que distingue o **exercício** (12º período do ano-calendário — H12):
 * pré-condição dos 11 períodos anteriores encerrados, evento de trilha
 * `exercicio.encerramento` e `exercicio_encerrado: true` na resposta.
 *
 * Ambiguidade CA-24 x CA-32 resolvida pela leitura de **operação atômica**
 * (registrada em `TASK-015.json:assumptions`): "nada escreve em período
 * encerrado" vale para o caminho normal DEPOIS de fechado (CA-24 — já imposto
 * pela T014 e reforçado no banco pelo trigger `lancamento_no_periodo_encerrado`
 * da migração 0006); a própria ação que fecha o período é o único caminho que
 * grava dentro dele, e ela acontece enquanto `encerrado_em` ainda é NULL —
 * primeiro o lançamento de encerramento, depois a marca. Assim CA-24, CA-31 e
 * CA-32 valem simultaneamente.
 *
 * Mecânica (conta `conta` não tem coluna de saldo — tudo é derivado):
 * - calcula o saldo acumulado das contas de resultado (receita/despesa) até e
 *   incluindo o período;
 * - se ALGUMA conta de resultado tem acumulado não nulo (ainda que o líquido
 *   seja zero), monta o lançamento de encerramento invertendo TODAS essas
 *   contas pelo tipo de cada uma; somente quando o líquido difere de zero
 *   acrescenta a linha da conta de PL de destino (tipo `patrimonio_liquido`,
 *   exigida nesse caso) — com líquido zero as inversões já fecham entre si;
 * - só então marca o período como encerrado (`encerrado_em`), na MESMA
 *   transação. A marca é **única e imutável no banco** (trigger
 *   `periodo_encerramento_unico`, migração 0006): re-encerrar ou reabrir por
 *   qualquer caminho é abortado.
 *
 * Permissão (RF-09/F13): a rota usa `exigirEscritaContabil` — somente contador
 * atribuído com escrita ativa; administrador é recusado auditado (CA-31/CA-32)
 * ANTES de qualquer escrita. O encerramento é auditado (RF-05): evento
 * `periodo.encerramento` (e `exercicio.encerramento` no 12º mês) na mesma
 * transação.
 */

export interface EntradaEncerramento {
  periodoId: number;
  empresaId: number;
  /** Conta de PL que recebe o resultado líquido (exigida quando o líquido difere de zero). */
  contaResultadoId?: number | null;
}

export interface ResultadoEncerramento {
  periodo: PeriodoContabil;
  exercicioEncerrado: boolean;
  /** Σ (débito − crédito) das contas de resultado; negativo = lucro. */
  resultadoCentavos: number;
  lancamentoEncerramentoId: number | null;
}

function rotuloDoPeriodo(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/** Último dia do mês no formato `YYYY-MM-DD` (data do lançamento de encerramento). */
function ultimoDiaDoPeriodo(ano: number, mes: number): string {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
}

/**
 * Encerra o período (e o exercício, quando é o 12º mês do ano — H12/RF-09).
 * Semântica única (decisão humana de 2026-10-21; correção de 2026-10-22):
 * grava o lançamento de encerramento sempre que ALGUMA conta de resultado tem
 * acumulado não nulo — invertendo todas elas (zerando-as no balancete
 * seguinte, CA-31) e levando o resultado líquido à conta de PL SOMENTE quando
 * o líquido difere de zero; sem movimento de resultado => sem lançamento.
 * Validações antes da transação; escrita + trilha + marca na MESMA transação
 * (R8/CA-29: falha no meio desfaz tudo, sem encerramento parcial).
 */
export async function encerrarPeriodo(
  db: AppDb,
  entrada: EntradaEncerramento,
  atorId: number,
): Promise<ResultadoEncerramento> {
  const periodo = await buscarPeriodoNaEmpresa(db, entrada.periodoId, entrada.empresaId);
  if (!periodo) {
    throw new ErroAplicacao(404, 'Período contábil não encontrado nesta empresa.', 'periodo_nao_encontrado');
  }
  if (periodo.encerradoEm !== null) {
    registrarEvento(db, {
      acao: 'periodo.encerramento_recusado',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'periodo_contabil',
      objetoId: String(periodo.id),
      dados: { motivo: 'ja_encerrado', ano: periodo.ano, mes: periodo.mes },
    });
    throw new ErroAplicacao(
      409,
      `O período ${rotuloDoPeriodo(periodo.ano, periodo.mes)} já está encerrado: o encerramento é uma ação única (RF-09).`,
      'periodo_ja_encerrado',
    );
  }

  // Exercício (H12): encerrar o 12º período exige os 11 anteriores do mesmo
  // ano-calendário já encerrados (CA-32/RF-09). É a pré-condição do exercício;
  // o fechamento mensal em si não depende dos meses vizinhos.
  const ehExercicio = periodo.mes === 12;
  if (ehExercicio) {
    const anteriores = db
      .select()
      .from(periodoContabil)
      .where(
        and(eq(periodoContabil.empresaId, entrada.empresaId), eq(periodoContabil.ano, periodo.ano)),
      )
      .orderBy(asc(periodoContabil.mes))
      .all();
    const faltantes = anteriores.filter((linha) => linha.mes < 12 && linha.encerradoEm === null);
    if (faltantes.length > 0 || anteriores.length < 11) {
      const meses = faltantes.map((linha) => rotuloDoPeriodo(linha.ano, linha.mes)).join(', ');
      throw new ErroAplicacao(
        409,
        `O encerramento do exercício ${periodo.ano} exige os 11 períodos anteriores encerrados (RF-09/H12). ` +
          (meses ? `Períodos ainda abertos: ${meses}.` : 'Faltam períodos do ano-calendário.'),
        'exercicio_com_periodos_abertos',
      );
    }
  }

  // Resultado acumulado ATÉ o período (inclusive) — reportado e auditado em
  // qualquer encerramento.
  const saldos = saldosResultadoAtePeriodo(db, entrada.empresaId, periodo);
  const resultadoCentavos = saldos.reduce((total, item) => total + item.saldoCentavos, 0);

  // Qualquer conta de resultado com acumulado NÃO nulo exige zeragem no
  // balancete seguinte (CA-31) — mesmo quando o líquido é zero (ex.:
  // Receita = Despesas: nesse caso as inversões já fecham entre si e não há
  // linha de PL). Sem NENHUMA conta com acumulado: nada a zerar, economia de
  // lançamento mantida (apenas marca e audita).
  const partidasEncerramento: { contaId: number; natureza: 'D' | 'C'; valorCentavos: number }[] = [];

  if (saldos.length > 0) {
    // Inverte cada conta de resultado com acumulado (devedor vira crédito,
    // credor vira débito — depois disso receita/despesa ficam zeradas). A
    // natureza da inversão segue o sinal do saldo derivado da própria conta.
    partidasEncerramento.push(
      ...saldos.map((item) => ({
        contaId: item.conta.id,
        natureza: item.saldoCentavos > 0 ? ('C' as const) : ('D' as const),
        valorCentavos: Math.abs(item.saldoCentavos),
      })),
    );

    // A linha da conta de PL entra SOMENTE quando o líquido difere de zero
    // (com líquido zero as inversões já equilibram D = C e não há o que
    // transferir). Lucro (resultado < 0 em D−C) é CRÉDITO na conta de PL;
    // prejuízo é débito.
    if (resultadoCentavos !== 0) {
      if (entrada.contaResultadoId === undefined || entrada.contaResultadoId === null) {
        throw new ErroAplicacao(
          400,
          'Informe a conta_resultado_id (patrimônio líquido) que recebe a transferência do resultado deste período (RF-09).',
          'conta_resultado_ausente',
        );
      }
      const contaResultado = await buscarContaNaEmpresa(
        db,
        entrada.contaResultadoId,
        entrada.empresaId,
      );
      if (!contaResultado) {
        throw new ErroAplicacao(404, 'Conta de resultado não encontrada nesta empresa.', 'conta_nao_encontrada');
      }
      if (contaResultado.tipo !== 'patrimonio_liquido') {
        throw new ErroAplicacao(
          400,
          `A conta destino deve ser de patrimônio líquido (informado: ${contaResultado.tipo}).`,
          'conta_resultado_tipo_invalido',
        );
      }
      partidasEncerramento.push({
        contaId: contaResultado.id,
        natureza: resultadoCentavos < 0 ? 'C' : 'D',
        valorCentavos: Math.abs(resultadoCentavos),
      });
    }
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    let lancamentoEncerramentoId: number | null = null;

    if (partidasEncerramento.length > 0) {
      // Sempre >= 2 partidas por construção (RF-07): com líquido zero só há
      // inversões de >= 2 contas de resultado; com líquido não zero há a(s)
      // inversão(ões) + a linha da conta de PL.
      const data = ultimoDiaDoPeriodo(periodo.ano, periodo.mes);
      const inserido = tx
        .insert(lancamento)
        .values({
          empresaId: entrada.empresaId,
          periodoId: periodo.id,
          data,
          historico: ehExercicio
            ? `Encerramento do período e do exercício ${rotuloDoPeriodo(periodo.ano, periodo.mes)}`
            : `Encerramento do período ${rotuloDoPeriodo(periodo.ano, periodo.mes)}`,
          estornoDeId: null,
          criadoPor: atorId,
        })
        .returning()
        .all()[0]!;

      tx.insert(partida)
        .values(
          partidasEncerramento.map((item) => ({
            lancamentoId: inserido.id,
            contaId: item.contaId,
            natureza: item.natureza,
            valorCentavos: item.valorCentavos,
          })),
        )
        .prepare()
        .run();

      lancamentoEncerramentoId = inserido.id;
    }

    // A marca de encerramento é o ÚLTIMO passo: até aqui o período estava
    // aberto e os lançamentos acima eram permitidos (operação atômica — ver
    // cabeçalho do módulo). O trigger `periodo_encerramento_unico` (0006)
    // impede qualquer novo UPDATE/encerramento a partir daqui.
    tx.update(periodoContabil)
      .set({ encerradoEm: new Date().toISOString() })
      .where(eq(periodoContabil.id, periodo.id))
      .prepare()
      .run();

    auditoria.registrar({
      acao: 'periodo.encerramento',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'periodo_contabil',
      objetoId: String(periodo.id),
      dados: {
        ano: periodo.ano,
        mes: periodo.mes,
        exercicio: ehExercicio,
        transferiu_resultado: lancamentoEncerramentoId !== null,
        resultado_centavos: resultadoCentavos,
        lancamento_encerramento_id: lancamentoEncerramentoId,
        conta_resultado_id: entrada.contaResultadoId ?? null,
      },
    });
    if (ehExercicio) {
      auditoria.registrar({
        acao: 'exercicio.encerramento',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'exercicio',
        objetoId: String(periodo.ano),
        dados: { ano: periodo.ano, periodo_id: periodo.id, resultado_centavos: resultadoCentavos },
      });
    }

    const encerrado = tx
      .select()
      .from(periodoContabil)
      .where(eq(periodoContabil.id, periodo.id))
      .all()[0]!;

    return {
      periodo: encerrado,
      exercicioEncerrado: ehExercicio,
      resultadoCentavos,
      lancamentoEncerramentoId,
    };
  });
}
