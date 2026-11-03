import { erroResponseSchema, fluxoDeCaixaResponseSchema } from '@sistema-contabil/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import type { FluxoDeCaixaResponse } from '@sistema-contabil/shared';
import { createTestApp, type TestApp } from '../harness.ts';
import {
  criarFixFluxo,
  D,
  D_MAIS_10,
  D_MAIS_5,
  D_MENOS_2,
  type FixFluxo,
} from '../fixtures/fluxo.ts';
import { criarContaTeste } from '../fixtures/contas.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarTituloTeste } from '../fixtures/titulos.ts';
import { criarContaBancaria } from '../../src/services/extrato.ts';
import { associarTabelaAoTitulo, configurarMultaJuros, criarTabelaImposto } from '../../src/services/fiscal.ts';
import { baixa as baixaTable } from '../../src/db/schema.ts';

/**
 * Fluxo de caixa por empresa e intervalo (RF-17, CA-09; TASK-019).
 *
 * Um teste por critério de aceite, sobre o cenário canônico FIX-FLUXO
 * (`fixtures/fluxo.ts` — saldo inicial R$ 10.000,00 em D−2, recebimento de
 * R$ 1.500,00 em D−2, R$ 2.000,00 recebível em D+5 e R$ 3.000,00 a pagar em
 * D+10). Os números dos asserts são os do próprio CA-09, em centavos
 * (R$ 10.000,00 = 1_000_000 — ADR-0001, nunca float).
 *
 * Hipóteses confirmadas pelo humano em 2026-10-27 (TASK-019.json):
 * - **F-1:** fluxo POR EMPRESA; saldo inicial = Σ `saldo_inicial_centavos` das
 *   contas bancárias com `data_saldo_inicial <= de`;
 * - **F-3:** realizadas = baixas **vigentes** (sem estorno) pelo valor de caixa
 *   (`valor − retenção + encargos`); previstas = `saldo_centavos` dos títulos
 *   em aberto posicionados no vencimento.
 */

/** Reais → centavos (só para escrever os números do CA-09 como no requisito). */
function reais(valor: number): number {
  return Math.round(valor * 100);
}

function getFluxo(t: TestApp, f: FixFluxo, de: string, ate: string, extra = '') {
  return t.app.inject({
    method: 'GET',
    url: `/relatorios/fluxo-de-caixa?empresa_id=${f.empresa.id}&de=${de}&ate=${ate}${extra}`,
    headers: { cookie: f.cookie },
  });
}

/** Fluxo validado pelo schema compartilhado (falha com mensagem se a rota não existir). */
async function fluxoDe(
  t: TestApp,
  f: FixFluxo,
  de: string,
  ate: string,
): Promise<FluxoDeCaixaResponse> {
  const resposta = await getFluxo(t, f, de, ate);
  expect(resposta.statusCode, `GET /relatorios/fluxo-de-caixa ${de}..${ate}: ${resposta.body}`)
    .toBe(200);
  return fluxoDeCaixaResponseSchema.parse(resposta.json());
}

/** Baixa total de um título pela rota de produção (TASK-016). */
async function baixar(
  t: TestApp,
  f: FixFluxo,
  tituloId: number,
  entrada: { data: string; valorCentavos: number },
): Promise<number> {
  const resposta = await t.app.inject({
    method: 'POST',
    url: `/titulos/${tituloId}/baixas`,
    headers: { cookie: f.cookie },
    payload: {
      empresa_id: f.empresa.id,
      data: entrada.data,
      valor_centavos: entrada.valorCentavos,
      conta_contrapartida_id: f.caixa.id,
    },
  });
  expect(resposta.statusCode, `baixa do título #${tituloId}: ${resposta.body}`).toBe(201);
  return (resposta.json() as { id: number }).id;
}

describe('fluxo de caixa (RF-17, CA-09, F-1, F-3)', () => {
  test('CA-09 D−2..D+10: saldo inicial 10.000,00, entrada realizada 1.500,00 (D−2), entrada prevista 2.000,00 (D+5), saída prevista 3.000,00 (D+10) e saldo final 10.500,00', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);
      const fluxo = await fluxoDe(t, f, D_MENOS_2, D_MAIS_10);

      expect(fluxo.empresa_id).toBe(f.empresa.id);
      expect(fluxo.de).toBe(D_MENOS_2);
      expect(fluxo.ate).toBe(D_MAIS_10);
      expect(fluxo.saldo_inicial_centavos).toBe(reais(10_000)); // R$ 10.000,00 (D−2)

      // Apenas os três dias com movimento, em ordem cronológica (D não tem
      // movimento e não gera linha).
      expect(fluxo.linhas.map((linha) => linha.data)).toEqual([D_MENOS_2, D_MAIS_5, D_MAIS_10]);

      // D−2: entrada REALIZADA de R$ 1.500,00 (baixa do título recebido)
      expect(fluxo.linhas[0]).toEqual({
        data: D_MENOS_2,
        entradas_realizadas_centavos: reais(1_500),
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: 0,
        saidas_previstas_centavos: 0,
        saldo_acumulado_centavos: reais(10_000) + reais(1_500),
      });

      // D+5: entrada PREVISTA de R$ 2.000,00 (título em aberto, vencimento D+5)
      expect(fluxo.linhas[1]).toEqual({
        data: D_MAIS_5,
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: reais(2_000),
        saidas_previstas_centavos: 0,
        saldo_acumulado_centavos: reais(10_000) + reais(1_500) + reais(2_000),
      });

      // D+10: saída PREVISTA de R$ 3.000,00 (título a pagar em aberto)
      expect(fluxo.linhas[2]).toEqual({
        data: D_MAIS_10,
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: 0,
        saidas_previstas_centavos: reais(3_000),
        saldo_acumulado_centavos: reais(10_500),
      });

      expect(fluxo.totais).toEqual({
        entradas_realizadas_centavos: reais(1_500),
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: reais(2_000),
        saidas_previstas_centavos: reais(3_000),
      });

      // Identidade literal do CA-09: 10.000,00 + 1.500,00 + 2.000,00 − 3.000,00
      expect(fluxo.saldo_final_centavos).toBe(reais(10_500));
      expect(fluxo.saldo_final_centavos).toBe(
        reais(10_000) + reais(1_500) + reais(2_000) - reais(3_000),
      );
      expect(fluxo.saldo_final_centavos).toBe(
        fluxo.saldo_inicial_centavos +
          fluxo.totais.entradas_realizadas_centavos +
          fluxo.totais.entradas_previstas_centavos -
          fluxo.totais.saidas_realizadas_centavos -
          fluxo.totais.saidas_previstas_centavos,
      );
    } finally {
      await t.close();
    }
  });

  test('CA-09 identidade saldo_final = saldo_inicial + entradas − saídas CONFERE em todos os intervalos testados (inclusive subintervalos e intervalo sem movimento)', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);

      const intervalos: [string, string][] = [
        [D_MENOS_2, D_MENOS_2], // só o dia do recebimento
        [D_MENOS_2, '2026-03-14'], // antes do primeiro vencimento previsto
        [D_MENOS_2, D_MAIS_5],
        [D_MENOS_2, '2026-03-19'], // antes da saída prevista
        [D_MENOS_2, D_MAIS_10], // cenário completo do CA-09
        [D, D_MAIS_10], // começa depois da entrada realizada
        ['2026-03-01', D_MAIS_10], // começa antes do saldo inicial declarado
        [D_MAIS_10, '2026-03-31'], // depois de todo o movimento
        ['2026-04-01', '2026-04-30'], // intervalo REALMENTE vazio (sem baixa nem vencimento)
      ];

      for (const [de, ate] of intervalos) {
        const fluxo = await fluxoDe(t, f, de, ate);
        const rotulo = `${de}..${ate}`;

        // (a) os totais do intervalo somam exatamente as linhas exibidas
        const somado = fluxo.linhas.reduce(
          (total, linha) => ({
            er: total.er + linha.entradas_realizadas_centavos,
            sr: total.sr + linha.saidas_realizadas_centavos,
            ep: total.ep + linha.entradas_previstas_centavos,
            sp: total.sp + linha.saidas_previstas_centavos,
          }),
          { er: 0, sr: 0, ep: 0, sp: 0 },
        );
        expect(fluxo.totais, `totais ${rotulo}`).toEqual({
          entradas_realizadas_centavos: somado.er,
          saidas_realizadas_centavos: somado.sr,
          entradas_previstas_centavos: somado.ep,
          saidas_previstas_centavos: somado.sp,
        });

        // (b) identidade do RF-17/CA-09 sobre os totais do intervalo
        expect(fluxo.saldo_final_centavos, `identidade ${rotulo}`).toBe(
          fluxo.saldo_inicial_centavos + somado.er + somado.ep - somado.sr - somado.sp,
        );

        // (c) identidade incremental: cada linha fecha com o saldo acumulado
        let acumulado = fluxo.saldo_inicial_centavos;
        for (const linha of fluxo.linhas) {
          acumulado +=
            linha.entradas_realizadas_centavos +
            linha.entradas_previstas_centavos -
            linha.saidas_realizadas_centavos -
            linha.saidas_previstas_centavos;
          expect(linha.saldo_acumulado_centavos, `acumulado ${rotulo} em ${linha.data}`).toBe(
            acumulado,
          );
        }
        if (fluxo.linhas.length > 0) {
          expect(acumulado, `última linha ${rotulo}`).toBe(fluxo.saldo_final_centavos);
        } else {
          expect(fluxo.saldo_final_centavos, `sem movimento ${rotulo}`).toBe(
            fluxo.saldo_inicial_centavos,
          );
        }
      }

      // Intervalo REALMENTE sem movimento (achado 3 da revisão da T019): o
      // ramo "sem linha" acima agora é exercitado — zero linhas, totais
      // zerados e saldo final = inicial (nenhuma baixa nem vencimento em abril).
      const vazio = await fluxoDe(t, f, '2026-04-01', '2026-04-30');
      expect(vazio.linhas).toEqual([]);
      expect(vazio.totais).toEqual({
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: 0,
        saidas_previstas_centavos: 0,
      });
      // conta bancária declarada em D−2 ainda compõe o saldo inicial (F-1),
      // mas sem movimento o final é igual ao inicial
      expect(vazio.saldo_inicial_centavos).toBe(reais(10_000));
      expect(vazio.saldo_final_centavos).toBe(vazio.saldo_inicial_centavos);

      // intervalo invertido é recusado na validação (mensagem em pt-BR)
      const invertido = await getFluxo(t, f, D_MAIS_10, D_MENOS_2);
      expect(invertido.statusCode).toBe(400);
      expect(erroResponseSchema.parse(invertido.json()).erro).toMatch(/inicial.*posterior/i);
    } finally {
      await t.close();
    }
  });

  test('F-1 saldo inicial é a soma das contas bancárias DA EMPRESA com data_saldo_inicial <= de (contas declaradas depois e contas de outra empresa ficam de fora)', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);
      const db = t.database.db;

      // Conta da MESMA empresa declarada ANTES do início: entra no saldo inicial.
      await criarContaBancaria(
        db,
        {
          empresaId: f.empresa.id,
          nome: 'Caixa extra antes do intervalo',
          saldoInicialCentavos: 500_000,
          dataSaldoInicial: '2026-03-01',
        },
        f.contador.id,
      );
      // Conta da MESMA empresa declarada DEPOIS do início: fica de fora.
      await criarContaBancaria(
        db,
        {
          empresaId: f.empresa.id,
          nome: 'Caixa extra depois do intervalo',
          saldoInicialCentavos: 700_000,
          dataSaldoInicial: D_MAIS_5,
        },
        f.contador.id,
      );
      // Conta de OUTRA empresa na mesma data: nunca entra (escopo por empresa).
      const outra = criarEmpresaTeste(db, { razaoSocial: 'Empresa Outra do Fluxo' });
      await criarContaBancaria(
        db,
        {
          empresaId: outra.id,
          nome: 'Banco da outra empresa',
          saldoInicialCentavos: 900_000,
          dataSaldoInicial: D_MENOS_2,
        },
        f.contador.id,
      );

      // Início em D−2: só a conta do cenário (D−2) + a extra anterior a ele.
      const emD2 = await fluxoDe(t, f, D_MENOS_2, D_MAIS_10);
      expect(emD2.saldo_inicial_centavos).toBe(reais(10_000) + reais(5_000));

      // Início em D+5: a conta declarada em D+5 também passa a contar.
      const emD5 = await fluxoDe(t, f, D_MAIS_5, D_MAIS_10);
      expect(emD5.saldo_inicial_centavos).toBe(reais(10_000) + reais(5_000) + reais(7_000));

      // Início antes de qualquer declaração: zero (nenhuma conta elegível).
      const antesDeTudo = await fluxoDe(t, f, '2026-02-01', D_MAIS_10);
      expect(antesDeTudo.saldo_inicial_centavos).toBe(0);
      // e a identidade continua valendo: a entrada realizada de D−2 é contada
      expect(antesDeTudo.saldo_final_centavos).toBe(
        antesDeTudo.saldo_inicial_centavos +
          antesDeTudo.totais.entradas_realizadas_centavos +
          antesDeTudo.totais.entradas_previstas_centavos -
          antesDeTudo.totais.saidas_realizadas_centavos -
          antesDeTudo.totais.saidas_previstas_centavos,
      );
      expect(antesDeTudo.totais.entradas_realizadas_centavos).toBe(reais(1_500));
    } finally {
      await t.close();
    }
  });

  test('F-3 realizado: baixa vigente conta pelo valor de caixa líquido da retenção, baixa estornada sai do fluxo e título pago deixa de aparecer como previsto', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);
      const db = t.database.db;

      // (a) retenção de 10%: bruto R$ 100,00 → caixa sai R$ 90,00 (líquido)
      const tabela = await criarTabelaImposto(
        db,
        {
          empresaId: f.empresa.id,
          nome: 'IRRF',
          aliquotaCentavos: 1_000, // 10% em centésimos de percentual
          contaRetencaoId: f.contaRetencao.id,
        },
        f.contador.id,
      );
      const comRetencao = criarTituloTeste(db, {
        empresaId: f.empresa.id,
        contaId: f.fornecedor.id,
        criadoPor: f.contador.id,
        tipo: 'pagar',
        contraparte: 'Fornecedor com retenção',
        vencimento: D_MAIS_5,
        valorCentavos: reais(100),
      });
      await associarTabelaAoTitulo(
        db,
        { tituloId: comRetencao.id, empresaId: f.empresa.id, tabelaImpostoId: tabela.id },
        f.contador.id,
      );
      await baixar(t, f, comRetencao.id, { data: D_MAIS_5, valorCentavos: reais(100) });

      // (b) título recebido e ESTORNADO: sai do realizado
      const estornado = criarTituloTeste(db, {
        empresaId: f.empresa.id,
        contaId: f.cliente.id,
        criadoPor: f.contador.id,
        tipo: 'receber',
        contraparte: 'Cliente estornado',
        vencimento: D_MAIS_10,
        valorCentavos: reais(500),
      });
      const baixaEstornada = await baixar(t, f, estornado.id, {
        data: D,
        valorCentavos: reais(500),
      });
      const estorno = await t.app.inject({
        method: 'POST',
        url: `/baixas/${baixaEstornada}/estorno`,
        headers: { cookie: f.cookie },
        payload: { empresa_id: f.empresa.id, data: D },
      });
      expect(estorno.statusCode, estorno.body).toBe(201);

      const fluxo = await fluxoDe(t, f, D_MENOS_2, D_MAIS_10);

      // nenhum movimento em D: a baixa estornada não conta como realizado
      expect(fluxo.linhas.map((linha) => linha.data)).toEqual([D_MENOS_2, D_MAIS_5, D_MAIS_10]);

      // D+5: saída realizada de R$ 90,00 (líquido de 10% de retenção) e a
      // entrada prevista original de R$ 2.000,00 — o título pago não é mais previsto
      expect(fluxo.linhas[1]).toEqual({
        data: D_MAIS_5,
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: reais(90),
        entradas_previstas_centavos: reais(2_000),
        saidas_previstas_centavos: 0,
        saldo_acumulado_centavos:
          reais(10_000) + reais(1_500) + reais(2_000) - reais(90),
      });

      // D+10: o título estornado (a RECEBER) voltou a ficar em aberto e volta
      // a ser previsto como ENTRADA; a saída prevista continua sendo só o
      // título a pagar de R$ 3.000,00
      expect(fluxo.linhas[2]).toEqual({
        data: D_MAIS_10,
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: reais(500),
        saidas_previstas_centavos: reais(3_000),
        saldo_acumulado_centavos:
          reais(10_000) + reais(1_500) + reais(2_000) - reais(90) + reais(500) - reais(3_000),
      });

      expect(fluxo.totais).toEqual({
        entradas_realizadas_centavos: reais(1_500),
        saidas_realizadas_centavos: reais(90), // líquido, não os 100,00 do bruto
        entradas_previstas_centavos: reais(2_000) + reais(500),
        saidas_previstas_centavos: reais(3_000),
      });
      expect(fluxo.saldo_final_centavos).toBe(
        fluxo.saldo_inicial_centavos +
          fluxo.totais.entradas_realizadas_centavos +
          fluxo.totais.entradas_previstas_centavos -
          fluxo.totais.saidas_realizadas_centavos -
          fluxo.totais.saidas_previstas_centavos,
      );
    } finally {
      await t.close();
    }
  });

  test('F-3 título PARCIALMENTE baixado: a baixa conta como realizado pelo valor pago e o vencimento continua previsto apenas pelo SALDO RESIDUAL', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);
      const db = t.database.db;

      // Título a receber de R$ 500,00 com vencimento 2026-03-12 (dentro do
      // intervalo, data sem conflito com os eventos do cenário canônico).
      const parcial = criarTituloTeste(db, {
        empresaId: f.empresa.id,
        contaId: f.cliente.id,
        criadoPor: f.contador.id,
        tipo: 'receber',
        contraparte: 'Cliente baixa parcial',
        vencimento: '2026-03-12',
        valorCentavos: reais(500),
      });
      // Baixa PARCIAL de R$ 200,00 em D (2026-03-10) — pela rota de produção.
      await baixar(t, f, parcial.id, { data: D, valorCentavos: reais(200) });

      const fluxo = await fluxoDe(t, f, D_MENOS_2, D_MAIS_10);

      // na DATA DA BAIXA (D): realizado = os R$ 200,00 que saíram/entraram no caixa
      const linhaBaixa = fluxo.linhas.find((linha) => linha.data === D);
      expect(linhaBaixa?.entradas_realizadas_centavos).toBe(reais(200));

      // NO VENCIMENTO (2026-03-12): previsto = só o RESIDUAL R$ 300,00
      // (saldo_centavos do título em situação "parcial" — não os 500,00)
      const linhaVencimento = fluxo.linhas.find((linha) => linha.data === '2026-03-12');
      expect(linhaVencimento).toEqual({
        data: '2026-03-12',
        entradas_realizadas_centavos: 0,
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: reais(300),
        saidas_previstas_centavos: 0,
        saldo_acumulado_centavos:
          reais(10_000) + reais(1_500) + reais(200) + reais(300),
      });

      // identidade aritmética do CA-09 confere com os dois movimentos novos
      expect(fluxo.totais).toEqual({
        entradas_realizadas_centavos: reais(1_500) + reais(200),
        saidas_realizadas_centavos: 0,
        entradas_previstas_centavos: reais(2_000) + reais(300),
        saidas_previstas_centavos: reais(3_000),
      });
      expect(fluxo.saldo_final_centavos).toBe(
        fluxo.saldo_inicial_centavos +
          fluxo.totais.entradas_realizadas_centavos +
          fluxo.totais.entradas_previstas_centavos -
          fluxo.totais.saidas_realizadas_centavos -
          fluxo.totais.saidas_previstas_centavos,
      );
    } finally {
      await t.close();
    }
  });

  test('F-3 realizado com ENCARGOS (multa/juros): a fórmula valor − retenção + encargos é exercitada com os TRÊS componentes não nulos', async () => {
    const t = await createTestApp();
    try {
      const f = await criarFixFluxo(t.app, t.database.db);
      const db = t.database.db;

      // (a) retenção de 10% (RF-22) — mesmo caminho do teste F-3 acima
      const tabela = await criarTabelaImposto(
        db,
        {
          empresaId: f.empresa.id,
          nome: 'IRRF com encargos',
          aliquotaCentavos: 1_000, // 10%
          contaRetencaoId: f.contaRetencao.id,
        },
        f.contador.id,
      );
      // (b) multa 2% + juros 1% a.m. com conta de encargos (RF-23/CA-48, T017)
      const contaEncargos = criarContaTeste(db, {
        empresaId: f.empresa.id,
        codigo: '3.1.2',
        descricao: 'Multa e juros de atraso',
        tipo: 'despesa',
      });
      await configurarMultaJuros(
        db,
        {
          empresaId: f.empresa.id,
          multaCentavos: 200, // 2% (centésimos de percentual)
          jurosMensalCentavos: 100, // 1% a.m. (H18)
          contaEncargosId: contaEncargos.id,
        },
        f.contador.id,
      );

      // (c) título a pagar de R$ 100,00 com vencimento D+5 e retenção associada
      const comEncargos = criarTituloTeste(db, {
        empresaId: f.empresa.id,
        contaId: f.fornecedor.id,
        criadoPor: f.contador.id,
        tipo: 'pagar',
        contraparte: 'Fornecedor com encargos',
        vencimento: D_MAIS_5,
        valorCentavos: reais(100),
      });
      await associarTabelaAoTitulo(
        db,
        { tituloId: comEncargos.id, empresaId: f.empresa.id, tabelaImpostoId: tabela.id },
        f.contador.id,
      );
      // (d) baixa 5 dias APÓS o vencimento (D+10) → multa + juros pro rata
      await baixar(t, f, comEncargos.id, { data: D_MAIS_10, valorCentavos: reais(100) });

      // componentes gravados na baixa, todos NÃO NULOS:
      //   retenção 10% de 100,00 = 10,00 | multa 2% = 2,00 |
      //   juros 1% a.m. ÷ 30 × 5 dias = 0,17 → encargos = 2,17
      const linhaBaixa = db
        .select()
        .from(baixaTable)
        .where(eq(baixaTable.tituloId, comEncargos.id))
        .all()[0]!;
      expect(linhaBaixa.retencaoCentavos).toBe(reais(10));
      expect(linhaBaixa.multaCentavos).toBe(reais(2));
      expect(linhaBaixa.jurosCentavos).toBe(17);
      expect(linhaBaixa.encargosCentavos).toBe(reais(2) + 17);

      const fluxo = await fluxoDe(t, f, D_MENOS_2, D_MAIS_10);
      const linhaBaixaFluxo = fluxo.linhas.find((linha) => linha.data === D_MAIS_10);

      // realizado = valor bruto − retenção + encargos (os três != 0)
      expect(linhaBaixaFluxo?.saidas_realizadas_centavos).toBe(
        reais(100) - reais(10) + reais(2) + 17,
      ); // = 92,17
      expect(linhaBaixaFluxo?.saidas_realizadas_centavos).toBe(9_217);

      // identidade aritmética do CA-09 confere
      expect(fluxo.saldo_final_centavos).toBe(
        fluxo.saldo_inicial_centavos +
          fluxo.totais.entradas_realizadas_centavos +
          fluxo.totais.entradas_previstas_centavos -
          fluxo.totais.saidas_realizadas_centavos -
          fluxo.totais.saidas_previstas_centavos,
      );
    } finally {
      await t.close();
    }
  });
});
