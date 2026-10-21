import {
  criarPeriodoRequestSchema,
  listaPeriodosResponseSchema,
  periodosQuerySchema,
  periodoContabilSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { PeriodoContabil } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import { criarPeriodo, listarPeriodos } from '../services/periodos.ts';

/**
 * Períodos contábeis mensais (RF-09, base do CA-24/CA-31/CA-32).
 *
 * - `POST /periodos` — escrita contábil: contador **atribuído** apenas (F13:
 *   admin é recusado auditado; CA-35/36: não atribuído é recusado auditado);
 *   (empresa, ano, mês) único; nasce aberto. As **ações** de encerramento
 *   (zera resultado, exercício — H12) são da TASK-015.
 * - `GET /periodos` — leitura: contador só as empresas atribuídas;
 *   administrador tem leitura global auditada (F13/CA-34).
 */

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
  app.post(
    '/periodos',
    { preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'periodo_contabil' })] },
    async (request, reply) => {
      const { usuario } = autenticacaoDe(request);
      const dados = criarPeriodoRequestSchema.parse(request.body);
      const criado = await criarPeriodo(
        app.db,
        { empresaId: empresaIdEscritada(request), ano: dados.ano, mes: dados.mes },
        usuario.id,
      );
      return reply.status(201).send(paraDTO(criado));
    },
  );

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
