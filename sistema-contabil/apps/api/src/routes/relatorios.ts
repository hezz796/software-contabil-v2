import {
  balanceteQuerySchema,
  balanceteResponseSchema,
  balancoQuerySchema,
  balancoResponseSchema,
  razaoQuerySchema,
  razaoResponseSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import { gerarBalanco, gerarBalancete, gerarRazao } from '../services/relatorios.ts';

/**
 * Relatórios contábeis (RF-10 balancete, RF-11 razão, RF-12 balanço; TASK-015,
 * CA-03/CA-04/CA-05/CA-40).
 *
 * - `GET /relatorios/balancete?empresa_id&periodo_id` — débitos/créditos do
 *   período, saldo e acumulado por conta, com totais (Σ débitos = Σ créditos).
 * - `GET /relatorios/razao?empresa_id&conta_id[&de&ate]` — lançamentos que
 *   afetaram a conta, com contrapartes e saldo corrente.
 * - `GET /relatorios/balanco?empresa_id&data` — ativo, passivo e PL com a
 *   igualdade patrimonial visível.
 *
 * Todos são LEITURA com o padrão da T013: contador só as empresas atribuídas;
 * administrador tem leitura global auditada (F13/CA-34). Empresa inativa
 * continua consultável (CA-40) — os relatórios são histórico.
 */

const leituraRelatorio = { preHandler: [exigirAutenticacao] };

function paraDTOConta(linha: { id: number; codigo: string; descricao: string; tipo: string }) {
  return { id: linha.id, codigo: linha.codigo, descricao: linha.descricao, tipo: linha.tipo };
}

export const relatorioRoutes: FastifyPluginAsync = async (app) => {
  app.get('/relatorios/balancete', leituraRelatorio, async (request) => {
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
    return balanceteResponseSchema.parse({
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
  });

  app.get('/relatorios/razao', leituraRelatorio, async (request) => {
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
    return razaoResponseSchema.parse({
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
  });

  app.get('/relatorios/balanco', leituraRelatorio, async (request) => {
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
    return balancoResponseSchema.parse({
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
  });
};
