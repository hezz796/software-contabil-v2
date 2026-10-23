import { describe, expect, test } from 'vitest';
import { aliquotaCentavosSchema } from '@sistema-contabil/shared';
import {
  aplicarPercentual,
  calcularDas,
  calcularEncargosAtraso,
  calcularRetencoes,
  diasDeAtraso,
} from '../../src/domain/fiscal.ts';

/**
 * Cálculos fiscais puros (RF-20..23, H17/H18, CA-45..48; TASK-017).
 *
 * Convenções verificadas aqui (ADR-0001: inteiros, nunca float):
 * - percentual em centésimos de percentual (4% = 400, 1% a.m. = 100);
 * - dinheiro em centavos, arredondamento meio-em-cima (`Math.round`);
 * - juros pro rata diário = mensal ÷ 30 (H18);
 * - DAS = base × alíquota com MESMO arredondamento da CHECK do banco
 *   (`apuracao_das_valor_derivado`).
 */

describe('aplicarPercentual (centésimos de percentual)', () => {
  test('CA-45: 4% de R$ 1.000,00 = R$ 40,00 (4000 centavos)', () => {
    expect(aplicarPercentual(100_000, 400)).toBe(4_000);
  });

  test('CA-48: 2% de multa sobre R$ 1.000,00 = R$ 20,00', () => {
    expect(aplicarPercentual(100_000, 200)).toBe(2_000);
  });

  test('alíquota zero devolve zero', () => {
    expect(aplicarPercentual(100_000, 0)).toBe(0);
  });

  test('base zero devolve zero', () => {
    expect(aplicarPercentual(0, 400)).toBe(0);
  });

  test('arredondamento meio-em-cima (nunca float)', () => {
    // 33,33% de R$ 0,03 = 0,0099 → 1 centavo arredondado
    expect(aplicarPercentual(3, 3_333)).toBe(1);
    // 50% de R$ 0,01 = 0,005 → 1 centavo (meio-em-cima)
    expect(aplicarPercentual(1, 5_000)).toBe(1);
    // resultado é SEMPRE inteiro
    expect(Number.isInteger(aplicarPercentual(999, 3_333))).toBe(true);
  });
});

describe('diasDeAtraso (diferença em dias de calendário)', () => {
  test('baixa no vencimento: 0 dias', () => {
    expect(diasDeAtraso('2026-03-01', '2026-03-01')).toBe(0);
  });

  test('baixa antes do vencimento: 0 dias (não negativo)', () => {
    expect(diasDeAtraso('2026-03-31', '2026-03-01')).toBe(0);
  });

  test('CA-48: exatamente 30 dias de atraso', () => {
    expect(diasDeAtraso('2026-02-28', '2026-03-30')).toBe(30);
  });

  test('atravessa virada de mês e ano (31/jan → 01/fev = 1 dia)', () => {
    expect(diasDeAtraso('2026-01-31', '2026-02-01')).toBe(1);
  });

  test('atravessa virada de ano (31/dez → 01/jan = 1 dia)', () => {
    expect(diasDeAtraso('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('calcularEncargosAtraso (RF-23, CA-48, H18)', () => {
  test('CA-48: vencido 30 dias, multa 2% + juros 1% a.m. → 20,00 + 10,00 = 30,00', () => {
    const resultado = calcularEncargosAtraso({
      brutoCentavos: 100_000,
      multaCentavos: 200,
      jurosMensalCentavos: 100,
      vencimento: '2026-02-28',
      data: '2026-03-30',
    });
    expect(resultado).toEqual({
      diasAtraso: 30,
      multaCentavos: 2_000,
      jurosCentavos: 1_000,
      encargosCentavos: 3_000,
    });
  });

  test('H18 pro rata: 15 dias de juros = metade do mensal', () => {
    const resultado = calcularEncargosAtraso({
      brutoCentavos: 100_000,
      multaCentavos: 200,
      jurosMensalCentavos: 100,
      vencimento: '2026-03-01',
      data: '2026-03-16',
    });
    expect(resultado.diasAtraso).toBe(15);
    expect(resultado.jurosCentavos).toBe(500); // 1% a.m. ÷ 2 = 0,5% de 1.000,00
    expect(resultado.multaCentavos).toBe(2_000);
  });

  test('H18 pro rata: 1 dia de juros = mensal ÷ 30', () => {
    const resultado = calcularEncargosAtraso({
      brutoCentavos: 100_000,
      multaCentavos: 200,
      jurosMensalCentavos: 100,
      vencimento: '2026-03-01',
      data: '2026-03-02',
    });
    expect(resultado.diasAtraso).toBe(1);
    expect(resultado.jurosCentavos).toBe(33); // Math.round(100000*100*1/(10000*30)) = 33
  });

  test('baixa no vencimento ou antes: tudo zero (CA-48 contraste com CA-06)', () => {
    for (const data of ['2026-03-01', '2026-02-20']) {
      const resultado = calcularEncargosAtraso({
        brutoCentavos: 100_000,
        multaCentavos: 200,
        jurosMensalCentavos: 100,
        vencimento: '2026-03-01',
        data,
      });
      expect(resultado).toEqual({ diasAtraso: 0, multaCentavos: 0, jurosCentavos: 0, encargosCentavos: 0 });
    }
  });

  test('sem multa e sem juros configurados: só dias, valores zero', () => {
    const resultado = calcularEncargosAtraso({
      brutoCentavos: 100_000,
      multaCentavos: 0,
      jurosMensalCentavos: 0,
      vencimento: '2026-03-01',
      data: '2026-03-31',
    });
    expect(resultado.diasAtraso).toBe(30);
    expect(resultado.encargosCentavos).toBe(0);
  });

  test('encargos são sempre multa + juros (invariante da CHECK do banco)', () => {
    const resultado = calcularEncargosAtraso({
      brutoCentavos: 123_457,
      multaCentavos: 250,
      jurosMensalCentavos: 175,
      vencimento: '2026-01-10',
      data: '2026-02-03',
    });
    expect(resultado.encargosCentavos).toBe(resultado.multaCentavos + resultado.jurosCentavos);
  });
});

describe('calcularRetencoes (RF-22, CA-47)', () => {
  test('CA-47: uma tabela 5% sobre R$ 1.000,00 = R$ 50,00 retidos', () => {
    const resultado = calcularRetencoes(100_000, [{ tabelaId: 1, aliquotaCentavos: 500 }]);
    expect(resultado.totalCentavos).toBe(5_000);
    expect(resultado.porTabela).toEqual([{ tabelaId: 1, valorCentavos: 5_000 }]);
  });

  test('duas tabelas: total é o somatório e cada tabela tem seu valor', () => {
    const resultado = calcularRetencoes(100_000, [
      { tabelaId: 1, aliquotaCentavos: 500 }, // 5% → 5.000
      { tabelaId: 2, aliquotaCentavos: 150 }, // 1,5% → 1.500
    ]);
    expect(resultado.porTabela).toEqual([
      { tabelaId: 1, valorCentavos: 5_000 },
      { tabelaId: 2, valorCentavos: 1_500 },
    ]);
    expect(resultado.totalCentavos).toBe(6_500);
  });

  test('sem tabelas associadas: nenhuma retenção', () => {
    expect(calcularRetencoes(100_000, [])).toEqual({ totalCentavos: 0, porTabela: [] });
  });

  test('alíquota zero: retenção zero (tabela existe mas não retém)', () => {
    const resultado = calcularRetencoes(100_000, [{ tabelaId: 1, aliquotaCentavos: 0 }]);
    expect(resultado.totalCentavos).toBe(0);
  });

  test('retenção ≥ bruto é calculada sem erro — a recusa é do serviço (CE-19)', () => {
    // Duas tabelas de 100% somam exatamente o bruto: o domínio devolve o
    // número; quem recusa é a regra de negócio (retencao_total_sem_liquido).
    const resultado = calcularRetencoes(100_000, [
      { tabelaId: 1, aliquotaCentavos: 10_000 },
      { tabelaId: 2, aliquotaCentavos: 10_000 },
    ]);
    expect(resultado.totalCentavos).toBe(200_000);
    expect(resultado.totalCentavos).toBeGreaterThan(100_000);
  });
});

describe('calcularDas (RF-21, H17, CA-46/CA-49)', () => {
  test('CA-46: Simples 6% sobre R$ 10.000,00 = R$ 600,00', () => {
    expect(calcularDas(1_000_000, 600)).toBe(60_000);
  });

  test('alíquota zero: DAS zero (regime configurado sem valor)', () => {
    expect(calcularDas(1_000_000, 0)).toBe(0);
  });

  test('base zero: DAS zero', () => {
    expect(calcularDas(0, 600)).toBe(0);
  });

  test('arredondamento casa com a CHECK do banco (base × aliquota + 5000) / 10000', () => {
    // R$ 333,33 × 6% = 19,9998 → 20,00 (2.000 centavos)
    const base = 33_333;
    const aliquota = 600;
    const esperadoPeloBanco = Math.floor((base * aliquota + 5_000) / 10_000);
    expect(calcularDas(base, aliquota)).toBe(esperadoPeloBanco);
    expect(calcularDas(base, aliquota)).toBe(2_000);
  });

  test('resultado é SEMPRE inteiro (ADR-0001: nada de float)', () => {
    for (const base of [1, 7, 999, 123_457]) {
      expect(Number.isInteger(calcularDas(base, 675))).toBe(true);
    }
  });
});

describe('aliquotaCentavosSchema (teto de 100%)', () => {
  test('borda: 10000 (= 100%) é aceita', () => {
    expect(aliquotaCentavosSchema.safeParse(10_000).success).toBe(true);
  });

  test('10001 (> 100%) é rejeitada', () => {
    const resultado = aliquotaCentavosSchema.safeParse(10_001);
    expect(resultado.success).toBe(false);
  });
});
