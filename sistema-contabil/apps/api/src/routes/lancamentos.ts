import {
  criarLancamentoRequestSchema,
  estornarLancamentoRequestSchema,
  lancamentoSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/index.ts';
import type { Lancamento } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import {
  criarLancamento,
  estornarLancamento,
  partidasDoLancamento,
  rejeitarEdicaoExclusao,
} from '../services/lancamentos.ts';

/**
 * Lançamentos em partidas dobradas, imutabilidade e estorno (RF-07/RF-08,
 * CA-13/14/24/25/26/29, TASK-014).
 *
 * - `POST /lancamentos` e `POST /lancamentos/:id/estorno` — escrita contábil:
 *   somente contador **atribuído** à empresa (guard obrigatório
 *   `exigirEscritaContabil`; F13/CA-33: admin é recusado auditado; CA-35/36:
 *   contador não atribuído é recusado auditado). O `empresa_id` usado é o
 *   resolvido no SERVIDOR, nunca o enviado como confiável (RF-04/ADR-0001).
 * - `PATCH /lancamentos/:id`, `DELETE /lancamentos/:id` — **não existem como
 *   ação do produto** (CA-25/R9): respondem sempre 405 orientando ao estorno
 *   (RK-4) e auditam a tentativa; nenhum caminho edita ou exclui o lançamento
 *   gravado (triggers no banco abortam UPDATE/DELETE direto — migração 0005).
 * - Não há rota de listagem nesta etapa: balancete/razão/balanço são T015.
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

/** Data padrão do estorno quando o cliente não informa (deve cair em período aberto). */
function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `empresa_id` já autorizado pelo guard de escrita contábil (nunca do corpo como confiável). */
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

async function paraDTO(db: AppDb, linha: Lancamento) {
  const partidas = await partidasDoLancamento(db, linha.id);
  return lancamentoSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    periodo_id: linha.periodoId,
    data: linha.data,
    historico: linha.historico,
    estorno_de_id: linha.estornoDeId,
    partidas: partidas.map((p) => ({
      conta_id: p.contaId,
      natureza: p.natureza,
      valor_centavos: p.valorCentavos,
    })),
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  });
}

export const lancamentoRoutes: FastifyPluginAsync = async (app) => {
  const escritaLancamento = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'lancamento' })],
  };

  app.post('/lancamentos', escritaLancamento, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarLancamentoRequestSchema.parse(request.body);
    const criado = await criarLancamento(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        data: dados.data,
        historico: dados.historico,
        partidas: dados.partidas.map((p) => ({
          contaId: p.conta_id,
          natureza: p.natureza,
          valorCentavos: p.valor_centavos,
        })),
      },
      usuario.id,
    );
    return reply.status(201).send(await paraDTO(app.db, criado.lancamento));
  });

  app.post('/lancamentos/:id/estorno', escritaLancamento, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = estornarLancamentoRequestSchema.parse(request.body ?? {});
    const estornado = await estornarLancamento(
      app.db,
      {
        lancamentoId: id,
        empresaId: empresaIdEscritada(request),
        data: dados.data ?? hoje(),
      },
      usuario.id,
    );
    return reply.status(201).send(await paraDTO(app.db, estornado.lancamento));
  });

  // CA-25/CE-4/R9: edição e exclusão de lançamento gravado NÃO EXISTEM como
  // ação do produto — a rota responde recusa com orientação ao estorno (RK-4)
  // e audita a tentativa; nada é persistido nem alterado.
  app.patch('/lancamentos/:id', escritaLancamento, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    await rejeitarEdicaoExclusao(
      app.db,
      { lancamentoId: id, empresaId: empresaIdEscritada(request) },
      usuario.id,
      'alteracao',
    );
  });

  app.delete('/lancamentos/:id', escritaLancamento, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    await rejeitarEdicaoExclusao(
      app.db,
      { lancamentoId: id, empresaId: empresaIdEscritada(request) },
      usuario.id,
      'exclusao',
    );
  });
};
