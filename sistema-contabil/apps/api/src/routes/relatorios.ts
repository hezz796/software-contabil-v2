import {
  balanceteQuerySchema,
  balanceteResponseSchema,
  balancoQuerySchema,
  balancoResponseSchema,
  fluxoDeCaixaQuerySchema,
  fluxoDeCaixaResponseSchema,
  razaoQuerySchema,
  razaoResponseSchema,
} from '@sistema-contabil/shared';
import type { BalanceteResponse, BalancoResponse, FluxoDeCaixaResponse, RazaoResponse } from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { gerarArquivoRelatorio, type EntradaExportacao } from '../services/exportacao.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import { gerarBalanco, gerarBalancete, gerarFluxoDeCaixa, gerarRazao } from '../services/relatorios.ts';

/**
 * Relatórios contábeis (RF-10 balancete, RF-11 razão, RF-12 balanço; TASK-015;
 * RF-17 fluxo de caixa e RF-18 exportação CSV/PDF; TASK-019).
 *
 * - `GET /relatorios/balancete?empresa_id&periodo_id[&formato]` — débitos/
 *   créditos do período, saldo e acumulado por conta, com totais.
 * - `GET /relatorios/razao?empresa_id&conta_id[&de&ate][&formato]` —
 *   lançamentos que afetaram a conta, com contrapartes e saldo corrente.
 * - `GET /relatorios/balanco?empresa_id&data[&formato]` — ativo, passivo e PL
 *   com a igualdade patrimonial visível.
 * - `GET /relatorios/fluxo-de-caixa?empresa_id&de&ate[&formato]` — saldo
 *   inicial, realizadas/previstas por dia e saldo final (CA-09).
 *
 * `formato=csv|pdf` (RF-18/CA-11) devolve o ARQUIVO com os MESMOS valores do
 * JSON: o DTO é montado/validado uma vez e alimenta as duas saídas. Ausente,
 * devolve o JSON da tela (contrato da T015 preservado).
 *
 * Todos são LEITURA com o padrão da T013: contador só as empresas atribuídas;
 * administrador tem leitura global auditada (F13/CA-34). Empresa inativa
 * continua consultável (CA-40) — os relatórios são histórico.
 */

const leituraRelatorio = { preHandler: [exigirAutenticacao] };

function paraDTOConta(linha: { id: number; codigo: string; descricao: string; tipo: string }) {
  return { id: linha.id, codigo: linha.codigo, descricao: linha.descricao, tipo: linha.tipo };
}

/** Resposta de arquivo do ADR-0006: attachment + content-type + corpo binário. */
function responderArquivo(reply: FastifyReply, arquivo: {
  contentType: string;
  nomeArquivo: string;
  buffer: Buffer;
}) {
  reply.header('content-type', arquivo.contentType);
  reply.header('content-disposition', `attachment; filename="${arquivo.nomeArquivo}"`);
  return reply.send(arquivo.buffer);
}

export const relatorioRoutes: FastifyPluginAsync = async (app) => {
  app.get('/relatorios/balancete', leituraRelatorio, async (request, reply) => {
    const autenticacao = autenticacaoDe(request);
    const query = balanceteQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'relatorio_balancete',
      rota: 'GET /relatorios/balancete',
    });
    const balancete = await gerarBalancete(app.db, {
      empresaId: query.empresa_id,
      periodoId: query.periodo_id,
    });
    const dto: BalanceteResponse = balanceteResponseSchema.parse({
      empresa_id: balancete.empresaId,
      periodo: {
        id: balancete.periodo.id,
        empresa_id: balancete.periodo.empresaId,
        ano: balancete.periodo.ano,
        mes: balancete.periodo.mes,
        situacao: balancete.periodo.encerradoEm ? 'encerrado' : 'aberto',
        encerrado_em: balancete.periodo.encerradoEm,
        criado_em: balancete.periodo.criadoEm,
      },
      linhas: balancete.linhas.map((linha) => ({
        conta_id: linha.contaId,
        codigo: linha.codigo,
        descricao: linha.descricao,
        tipo: linha.tipo,
        debitos_centavos: linha.debitosCentavos,
        creditos_centavos: linha.creditosCentavos,
        saldo_periodo_centavos: linha.saldoPeriodoCentavos,
        acumulado_centavos: linha.acumuladoCentavos,
      })),
      totais: {
        debitos_centavos: balancete.totais.debitosCentavos,
        creditos_centavos: balancete.totais.creditosCentavos,
      },
    });
    if (query.formato) {
      const entrada: EntradaExportacao = { relatorio: 'balancete', dto };
      return responderArquivo(reply, await gerarArquivoRelatorio(app.db, query.formato, entrada));
    }
    return dto;
  });

  app.get('/relatorios/razao', leituraRelatorio, async (request, reply) => {
    const autenticacao = autenticacaoDe(request);
    const query = razaoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'relatorio_razao',
      rota: 'GET /relatorios/razao',
    });
    const razao = await gerarRazao(app.db, {
      empresaId: query.empresa_id,
      contaId: query.conta_id,
      de: query.de,
      ate: query.ate,
    });
    const dto: RazaoResponse = razaoResponseSchema.parse({
      empresa_id: razao.empresaId,
      conta: paraDTOConta(razao.conta),
      de: razao.de,
      ate: razao.ate,
      linhas: razao.linhas.map((linha) => ({
        lancamento_id: linha.lancamentoId,
        data: linha.data,
        historico: linha.historico,
        debito_centavos: linha.debitoCentavos,
        credito_centavos: linha.creditoCentavos,
        saldo_corrente_centavos: linha.saldoCorrenteCentavos,
        contrapartes: linha.contrapartes.map((item) => ({
          conta_id: item.contaId,
          codigo: item.codigo,
          descricao: item.descricao,
          natureza: item.natureza,
          valor_centavos: item.valorCentavos,
        })),
      })),
      total_debitos_centavos: razao.totais.debitosCentavos,
      total_creditos_centavos: razao.totais.creditosCentavos,
      saldo_final_centavos: razao.saldoFinalCentavos,
    });
    if (query.formato) {
      const entrada: EntradaExportacao = { relatorio: 'razao', dto };
      return responderArquivo(reply, await gerarArquivoRelatorio(app.db, query.formato, entrada));
    }
    return dto;
  });

  app.get('/relatorios/balanco', leituraRelatorio, async (request, reply) => {
    const autenticacao = autenticacaoDe(request);
    const query = balancoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'relatorio_balanco',
      rota: 'GET /relatorios/balanco',
    });
    const balanco = await gerarBalanco(app.db, { empresaId: query.empresa_id, data: query.data });
    const paraSecao = (secao: { linhas: { contaId: number; codigo: string; descricao: string; tipo: 'ativo' | 'passivo' | 'patrimonio_liquido' | 'receita' | 'despesa'; saldoCentavos: number }[]; totalCentavos: number }) => ({
      linhas: secao.linhas.map((linha) => ({
        conta_id: linha.contaId,
        codigo: linha.codigo,
        descricao: linha.descricao,
        tipo: linha.tipo,
        saldo_centavos: linha.saldoCentavos,
      })),
      total_centavos: secao.totalCentavos,
    });
    const dto: BalancoResponse = balancoResponseSchema.parse({
      empresa_id: balanco.empresaId,
      data: balanco.data,
      ativo: paraSecao(balanco.ativo),
      passivo: paraSecao(balanco.passivo),
      patrimonio_liquido: paraSecao(balanco.patrimonioLiquido),
      totais: {
        ativo_centavos: balanco.totais.ativoCentavos,
        passivo_centavos: balanco.totais.passivoCentavos,
        patrimonio_liquido_centavos: balanco.totais.patrimonioLiquidoCentavos,
        confere: balanco.totais.confere,
      },
    });
    if (query.formato) {
      const entrada: EntradaExportacao = { relatorio: 'balanco', dto };
      return responderArquivo(reply, await gerarArquivoRelatorio(app.db, query.formato, entrada));
    }
    return dto;
  });

  app.get('/relatorios/fluxo-de-caixa', leituraRelatorio, async (request, reply) => {
    const autenticacao = autenticacaoDe(request);
    const query = fluxoDeCaixaQuerySchema.parse(request.query);
    // MUTAÇÃO RED (documentação): autorização removida
    void autenticacao;
    const fluxo = await gerarFluxoDeCaixa(app.db, {
      empresaId: query.empresa_id,
      de: query.de,
      ate: query.ate,
    });
    const dto: FluxoDeCaixaResponse = fluxoDeCaixaResponseSchema.parse({
      empresa_id: fluxo.empresaId,
      de: fluxo.de,
      ate: fluxo.ate,
      saldo_inicial_centavos: fluxo.saldoInicialCentavos,
      linhas: fluxo.linhas.map((linha) => ({
        data: linha.data,
        entradas_realizadas_centavos: linha.entradasRealizadasCentavos,
        saidas_realizadas_centavos: linha.saidasRealizadasCentavos,
        entradas_previstas_centavos: linha.entradasPrevistasCentavos,
        saidas_previstas_centavos: linha.saidasPrevistasCentavos,
        saldo_acumulado_centavos: linha.saldoAcumuladoCentavos,
      })),
      totais: {
        entradas_realizadas_centavos: fluxo.totais.entradasRealizadasCentavos,
        saidas_realizadas_centavos: fluxo.totais.saidasRealizadasCentavos,
        entradas_previstas_centavos: fluxo.totais.entradasPrevistasCentavos,
        saidas_previstas_centavos: fluxo.totais.saidasPrevistasCentavos,
      },
      saldo_final_centavos: fluxo.saldoFinalCentavos,
    });
    if (query.formato) {
      const entrada: EntradaExportacao = { relatorio: 'fluxo-de-caixa', dto };
      return responderArquivo(reply, await gerarArquivoRelatorio(app.db, query.formato, entrada));
    }
    return dto;
  });
};
