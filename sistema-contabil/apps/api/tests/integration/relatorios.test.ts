import {
  balanceteResponseSchema,
  balancoResponseSchema,
  erroResponseSchema,
  razaoResponseSchema,
} from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import type { TestApp } from '../harness.ts';
import { createTestApp } from '../harness.ts';
import { criarFix01, type Fix01 } from '../fixtures/fix-01.ts';
import { empresa } from '../../src/db/schema.ts';

/**
 * Relatórios contábeis (RF-10 balancete, RF-11 razão, RF-12 balanço; TASK-015).
 *
 * Um teste por critério de aceite, todos sobre a MESMA fixture canônica FIX-01
 * (`fixtures/fix-01.ts` — critério de aceite explícito). Os números nos asserts
 * são os canônicos de `docs/requirements/SISTEMA-CONTABIL.md` §6.0/§6.1, em
 * centavos (R$ 1.000,00 = 100_000).
 */

function getBalancete(t: TestApp, f: Fix01, periodoId: number) {
  return t.app.inject({
    method: 'GET',
    url: `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${periodoId}`,
    headers: { cookie: f.cookie },
  });
}

function getRazao(t: TestApp, f: Fix01, contaId: number, extra = '') {
  return t.app.inject({
    method: 'GET',
    url: `/relatorios/razao?empresa_id=${f.empresa.id}&conta_id=${contaId}${extra}`,
    headers: { cookie: f.cookie },
  });
}

function getBalanco(t: TestApp, f: Fix01, data: string) {
  return t.app.inject({
    method: 'GET',
    url: `/relatorios/balanco?empresa_id=${f.empresa.id}&data=${data}`,
    headers: { cookie: f.cookie },
  });
}

describe('relatórios contábeis (RF-10/RF-11/RF-12, CA-03/CA-04/CA-05/CA-40)', () => {
  test('CA-03 lançamento Débito Caixa / Crédito Capital R$ 1.000,00 aparece no razão das duas contas e no balancete com débitos = créditos', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFix01(t.app, t.database.db);

      // (a) razão de Caixa contém L1 como débito de R$ 1.000,00
      const razaoCaixa = razaoResponseSchema.parse((await getRazao(t, f, f.caixa.id)).json());
      const linhaCaixa = razaoCaixa.linhas.find((linha) => linha.lancamento_id === f.lancamentos.l1);
      expect(linhaCaixa).toBeDefined();
      expect(linhaCaixa?.debito_centavos).toBe(100_000); // R$ 1.000,00
      expect(linhaCaixa?.credito_centavos).toBe(0);

      // (b) razão de Capital contém L1 como crédito de R$ 1.000,00
      const razaoCapital = razaoResponseSchema.parse((await getRazao(t, f, f.capital.id)).json());
      const linhaCapital = razaoCapital.linhas.find(
        (linha) => linha.lancamento_id === f.lancamentos.l1,
      );
      expect(linhaCapital).toBeDefined();
      expect(linhaCapital?.credito_centavos).toBe(100_000); // R$ 1.000,00
      expect(linhaCapital?.debito_centavos).toBe(0);

      // (c) balancete do período com totais de débitos = créditos
      const balancete = balanceteResponseSchema.parse((await getBalancete(t, f, f.periodo.id)).json());
      expect(balancete.totais.debitos_centavos).toBe(balancete.totais.creditos_centavos);
    } finally {
      await t.close();
    }
  });

  test('CA-04 FIX-01: balancete com débitos = créditos = R$ 3.000,00 e saldos por conta; razão de Caixa lista exatamente L1, L3, L5 com saldos R$ 1.000,00 / 600,00 / 900,00', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFix01(t.app, t.database.db);

      const balancete = balanceteResponseSchema.parse((await getBalancete(t, f, f.periodo.id)).json());

      // totais gerais canônicos: débitos = créditos = R$ 3.000,00
      expect(balancete.totais.debitos_centavos).toBe(300_000);
      expect(balancete.totais.creditos_centavos).toBe(300_000);

      // saldos por conta (FIX-01; centavos assinados, positivo = devedor)
      const acumuladoDe = (contaId: number): number =>
        balancete.linhas.find((linha) => linha.conta_id === contaId)?.acumulado_centavos ??
        Number.NaN;
      expect(acumuladoDe(f.caixa.id)).toBe(90_000); // Caixa 900,00 (D)
      expect(acumuladoDe(f.cliente.id)).toBe(40_000); // Cliente 400,00 (D)
      expect(acumuladoDe(f.despesas.id)).toBe(60_000); // Despesas 600,00 (D)
      expect(acumuladoDe(f.fornecedor.id)).toBe(-20_000); // Fornecedor 200,00 (C)
      expect(acumuladoDe(f.capital.id)).toBe(-100_000); // Capital 1.000,00 (C)
      expect(acumuladoDe(f.receita.id)).toBe(-70_000); // Receita 700,00 (C)

      // razão de Caixa: exatamente L1, L3 e L5, na ordem cronológica
      const razao = razaoResponseSchema.parse((await getRazao(t, f, f.caixa.id)).json());
      expect(razao.linhas.map((linha) => linha.lancamento_id)).toEqual([
        f.lancamentos.l1,
        f.lancamentos.l3,
        f.lancamentos.l5,
      ]);
      // saldos correntes: R$ 1.000,00; 600,00; 900,00 — iguais ao cálculo manual
      expect(razao.linhas.map((linha) => linha.saldo_corrente_centavos)).toEqual([
        100_000, 60_000, 90_000,
      ]);
      expect(razao.saldo_final_centavos).toBe(90_000);
      expect(razao.total_debitos_centavos).toBe(130_000); // L1 1.000 + L5 300
      expect(razao.total_creditos_centavos).toBe(40_000); // L3 400
    } finally {
      await t.close();
    }
  });

  test('CA-05 FIX-01: balanço na data final com ativo R$ 1.300,00, passivo R$ 200,00 e PL R$ 1.100,00, com ativo − passivo − PL = 0', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFix01(t.app, t.database.db);

      const balanco = balancoResponseSchema.parse((await getBalanco(t, f, '2026-03-31')).json());

      // ativo R$ 1.300,00 (Caixa 900 + Cliente 400)
      expect(balanco.totais.ativo_centavos).toBe(130_000);
      expect(balanco.ativo.linhas.map((linha) => linha.saldo_centavos).sort((a, b) => a - b)).toEqual([
        40_000, 90_000,
      ]);
      // passivo R$ 200,00 (Fornecedor)
      expect(balanco.totais.passivo_centavos).toBe(20_000);
      // PL R$ 1.100,00 (Capital 1.000 + Receita 700 − Despesas 600)
      expect(balanco.totais.patrimonio_liquido_centavos).toBe(110_000);
      const plDe = (contaId: number): number | undefined =>
        balanco.patrimonio_liquido.linhas.find((linha) => linha.conta_id === contaId)
          ?.saldo_centavos;
      expect(plDe(f.capital.id)).toBe(100_000); // Capital 1.000,00 (C)
      expect(plDe(f.receita.id)).toBe(70_000); // Receita 700,00 (C)
      expect(plDe(f.despesas.id)).toBe(-60_000); // Despesas 600,00 (D)

      // igualdade patrimonial visível
      expect(balanco.totais.confere).toBe(true);
      expect(
        balanco.totais.ativo_centavos -
          balanco.totais.passivo_centavos -
          balanco.totais.patrimonio_liquido_centavos,
      ).toBe(0);
    } finally {
      await t.close();
    }
  });

  test('CA-40 empresa inativa: escrita recusada, mas balancete, razão e balanço permanecem consultáveis com os mesmos valores', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFix01(t.app, t.database.db);

      // inativa a empresa (histórico preservado — H13)
      t.database.db.update(empresa).set({ ativo: false }).run();

      // escrita nova recusada com mensagem de empresa inativa (CA-40)
      const escrita = await t.app.inject({
        method: 'POST',
        url: '/lancamentos',
        headers: { cookie: f.cookie },
        payload: {
          empresa_id: f.empresa.id,
          data: '2026-03-28',
          historico: 'Tentativa em empresa inativa',
          partidas: [
            { conta_id: f.caixa.id, natureza: 'D', valor_centavos: 1_000 },
            { conta_id: f.capital.id, natureza: 'C', valor_centavos: 1_000 },
          ],
        },
      });
      expect(escrita.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escrita.json()).erro).toMatch(/inativa/i);

      // relatórios continuam consultáveis (CA-40/M3) com os valores canônicos
      const balancete = balanceteResponseSchema.parse((await getBalancete(t, f, f.periodo.id)).json());
      expect(balancete.totais.debitos_centavos).toBe(300_000);
      expect(balancete.totais.creditos_centavos).toBe(300_000);

      const razao = razaoResponseSchema.parse((await getRazao(t, f, f.caixa.id)).json());
      expect(razao.linhas).toHaveLength(3);
      expect(razao.saldo_final_centavos).toBe(90_000);

      const balanco = balancoResponseSchema.parse((await getBalanco(t, f, '2026-03-31')).json());
      expect(balanco.totais.ativo_centavos).toBe(130_000);
      expect(balanco.totais.confere).toBe(true);
    } finally {
      await t.close();
    }
  });
});
