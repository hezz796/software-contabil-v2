/**
 * Cálculos fiscais puros da TASK-017 (RF-20..23, H17/H18) — sem I/O, sem
 * banco, sem relógio: funções determinísticas testadas isoladamente
 * (`verification_plan`: "juros pro rata, retenção e DAS em funções puras").
 *
 * Convenção de alíquotas (ADR-0001: inteiros, nunca float): percentual em
 * **centésimos de percentual** (4% = 400, 1% a.m. = 100). Dinheiro em
 * centavos; arredondamento meio-em-cima (`Math.round`).
 */

/** Centésimos de percentual aplicados a uma base em centavos (4% de 100000 = 4000). */
export function aplicarPercentual(baseCentavos: number, percentualCentavos: number): number {
  return Math.round((baseCentavos * percentualCentavos) / 10_000);
}

/** Diferença em dias de calendário entre duas datas `YYYY-MM-DD` (negativo → 0). */
export function diasDeAtraso(vencimento: string, data: string): number {
  const ms = Date.parse(`${data}T00:00:00.000Z`) - Date.parse(`${vencimento}T00:00:00.000Z`);
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export interface EntradaEncargosAtraso {
  /** Bruto da baixa em centavos (D1: a base dos encargos é o bruto). */
  brutoCentavos: number;
  /** Percentual da multa em centésimos (2% = 200). */
  multaCentavos: number;
  /** Percentual de juros MENSAL em centésimos (1% a.m. = 100 — H18). */
  jurosMensalCentavos: number;
  /** `YYYY-MM-DD` do vencimento do título. */
  vencimento: string;
  /** `YYYY-MM-DD` da baixa. */
  data: string;
}

export interface ResultadoEncargosAtraso {
  diasAtraso: number;
  multaCentavos: number;
  jurosCentavos: number;
  encargosCentavos: number;
}

/**
 * Multa e juros de atraso (RF-23, CA-48):
 *
 * - baixa **no vencimento ou antes** não gera multa/juros (CA-48 contraste com
 *   CA-06: `diasAtraso = 0` → tudo zero);
 * - multa = bruto × percentual (sobre o bruto abatido do saldo — D1);
 * - juros pro rata diária = bruto × (mensal ÷ 30) × dias (H18: 1% a.m. ÷ 30 →
 *   30 dias = 1% exato: 10,00 sobre 1.000,00).
 */
export function calcularEncargosAtraso(entrada: EntradaEncargosAtraso): ResultadoEncargosAtraso {
  const diasAtraso = diasDeAtraso(entrada.vencimento, entrada.data);
  if (diasAtraso <= 0) {
    return { diasAtraso: 0, multaCentavos: 0, jurosCentavos: 0, encargosCentavos: 0 };
  }
  const multaCentavos = aplicarPercentual(entrada.brutoCentavos, entrada.multaCentavos);
  const jurosCentavos = Math.round(
    (entrada.brutoCentavos * entrada.jurosMensalCentavos * diasAtraso) / (10_000 * 30),
  );
  return {
    diasAtraso,
    multaCentavos,
    jurosCentavos,
    encargosCentavos: multaCentavos + jurosCentavos,
  };
}

export interface TabelaRetencao {
  tabelaId: number;
  /** Percentual em centésimos (5% = 500). */
  aliquotaCentavos: number;
}

export interface ResultadoRetencoes {
  totalCentavos: number;
  porTabela: { tabelaId: number; valorCentavos: number }[];
}

/**
 * Retenções na fonte aplicadas ao bruto da baixa (RF-22, CA-47): cada tabela
 * associada gera seu valor (`bruto × alíquota`); o total é o somatório.
 * `retencao > bruto` é recusado pelo serviço (a CHECK do banco é o retrocesso).
 */
export function calcularRetencoes(brutoCentavos: number, tabelas: TabelaRetencao[]): ResultadoRetencoes {
  const porTabela = tabelas.map((tabela) => ({
    tabelaId: tabela.tabelaId,
    valorCentavos: aplicarPercentual(brutoCentavos, tabela.aliquotaCentavos),
  }));
  return {
    totalCentavos: porTabela.reduce((total, item) => total + item.valorCentavos, 0),
    porTabela,
  };
}

/**
 * Valor do DAS (RF-21, H17): base (receitas do período) × alíquota do regime.
 * Mesmo arredondamento do CHECK `apuracao_das_valor_derivado` no banco.
 */
export function calcularDas(baseCentavos: number, aliquotaCentavos: number): number {
  return Math.round((baseCentavos * aliquotaCentavos) / 10_000);
}
