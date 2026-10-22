import {
  criarPeriodoRequestSchema,
  encerrarPeriodoRequestSchema,
  encerramentoPeriodoResponseSchema,
  listaPeriodosResponseSchema,
  periodosQuerySchema,
  periodoContabilSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PeriodoContabil } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { encerrarPeriodo } from '../services/encerramento.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import { criarPeriodo, listarPeriodos } from '../services/periodos.ts';

/**
 * Períodos contábeis mensais (RF-09, base do CA-24/CA-31/CA-32).
 *
 * - `POST /periodos` — escrita contábil: contador **atribuído** apenas (F13:
 *   admin é recusado auditado; CA-35/36: não atribuído é recusado auditado);
 *   (empresa, ano, mês) único; nasce aberto.
 * - `POST /periodos/:id/encerramento` — ação de encerramento do período e do
 *   exercício (TASK-015, RF-09/H12, CA-31/CA-32): mesmo guard de escrita
 *   contábil — **somente contador com escrita ativa**; admin é recusado
 *   auditado sem tocar em nada. A escrita é atômica: lançamento(s) de
 *   encerramento + marca do período + trilha na MESMA transação.
 * - `GET /periodos` — leitura: contador só as empresas atribuídas;
 *   administrador tem leitura global auditada (F13/CA-34).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

function paraDTO(linha: PeriodoContabil) {
  return periodoContabilSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    ano: linha.ano,
    mes: linha.mes,
    situacao: linha.encerradoEm ? 'encerrado' : 'aberto',
    encerrado_em: linha.encerradoEm,
    criado_em: linha.criadoEm,
  });
}

function empresaIdEscritada(request: FastifyRequest): number {
  const empresaId = request.escritaContabilEmpresaId;
  if (empresaId === null) {
    throw new ErroAplicacao(
      400,
      'Informe a empresa (empresa_id) na qual a operação deve ser gravada.',
      'empresa_id_ausente',
    );
  }
  return empresaId;
}

export const periodoRoutes: FastifyPluginAsync = async (app) => {
  const escritaPeriodo = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'periodo_contabil' })],
  };

  app.post('/periodos', escritaPeriodo, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarPeriodoRequestSchema.parse(request.body);
    const criado = await criarPeriodo(
      app.db,
      { empresaId: empresaIdEscritada(request), ano: dados.ano, mes: dados.mes },
      usuario.id,
    );
    return reply.status(201).send(paraDTO(criado));
  });

  /**
   * Encerramento do período e do exercício (RF-09/H12, CA-31/CA-32, TASK-015).
   * Escrita contábil: somente contador **atribuído** com escrita ativa (F13:
   * admin é recusado auditado pelo guard, ANTES de qualquer escrita). Operação
   * atômica — ver `services/encerramento.ts` (ambiguidade CA-24 x CA-32
   * resolvida e documentada em TASK-015.json).
   *
   * Semântica única (decisão humana de 2026-10-21): TODO encerramento (mês
   * comum ou 12º) grava o lançamento que zera as contas de resultado e
   * transfere o resultado líquido à conta de PL (`conta_resultado_id`, exigida
   * quando há resultado), datado no último dia do período; período sem
   * resultado fecha sem lançamento. O **exercício** (12º período do
   * ano-calendário — H12) é o fechamento que, além disso, exige os 11
   * períodos anteriores encerrados, marca o exercício e audita
   * `exercicio.encerramento`. Em 2026-12-31 o exercício é encerrado por essa
   * MESMA rota (H12: o balanço é a posição final do ano — nada de lançamento
   * datado de 2027 para "fechar" o ano; a transferência entra em 31/12 junto
   * com o fechamento).
   */
  app.post('/periodos/:id/encerramento', escritaPeriodo, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = encerrarPeriodoRequestSchema.parse(request.body ?? {});
    const resultado = await encerrarPeriodo(
      app.db,
      {
        periodoId: id,
        empresaId: empresaIdEscritada(request),
        contaResultadoId: dados.conta_resultado_id,
      },
      usuario.id,
    );
    return reply.status(200).send(
      encerramentoPeriodoResponseSchema.parse({
        periodo: paraDTO(resultado.periodo),
        exercicio_encerrado: resultado.exercicioEncerrado,
        resultado_centavos: resultado.resultadoCentavos,
        lancamento_encerramento_id: resultado.lancamentoEncerramentoId,
      }),
    );
  });

  app.get('/periodos', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = periodosQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'periodo_contabil',
      rota: 'GET /periodos',
    });
    const linhas = await listarPeriodos(app.db, query.empresa_id);
    return listaPeriodosResponseSchema.parse({ periodos: linhas.map(paraDTO) });
  });
};
