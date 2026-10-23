import {
  conciliacaoSchema,
  conciliacoesQuerySchema,
  criarConciliacaoRequestSchema,
  listaConciliacoesResponseSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conciliacao } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import {
  criarConciliacao,
  desconciliarConciliacao,
  listarConciliacoes,
} from '../services/conciliacoes.ts';

/**
 * Conciliação bancária item a item (RF-16, CA-08/CA-28; TASK-018).
 *
 * - `POST /conciliacoes` e `DELETE /conciliacoes/:id` — escrita contábil
 *   (guard; admin recusado auditado — T018-F-1), `empresa_id` resolvido no
 *   SERVIDOR;
 * - `GET /conciliacoes` — leitura do histórico (vigentes e desfeitas: a
 *   desconciliação preserva a linha — CA-28);
 * - DELETE com id alheio/inexistente: MESMO 404 (sem oráculo); a trilha
 *   `conciliacao.tentativa_negada` só registra a tentativa alheia real.
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

function paraDTO(linha: Conciliacao) {
  return conciliacaoSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    item_extrato_id: linha.itemExtratoId,
    objeto_tipo: linha.objetoTipo,
    titulo_id: linha.tituloId,
    lancamento_id: linha.lancamentoId,
    conciliado_por: linha.conciliadoPor,
    conciliado_em: linha.conciliadoEm,
    desconciliado_por: linha.desconciliadoPor,
    desconciliado_em: linha.desconciliadoEm,
  });
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

export const conciliacaoRoutes: FastifyPluginAsync = async (app) => {
  const escritaConciliacao = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'conciliacao' })],
  };

  app.post('/conciliacoes', escritaConciliacao, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarConciliacaoRequestSchema.parse(request.body);
    const criada = await criarConciliacao(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        itemExtratoId: dados.item_extrato_id,
        objetoTipo: dados.objeto_tipo,
        tituloId: dados.titulo_id ?? null,
        lancamentoId: dados.lancamento_id ?? null,
      },
      usuario.id,
    );
    return reply.status(201).send(paraDTO(criada));
  });

  app.get('/conciliacoes', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = conciliacoesQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'conciliacao',
      rota: 'GET /conciliacoes',
    });
    const linhas = await listarConciliacoes(app.db, query.empresa_id);
    return listaConciliacoesResponseSchema.parse({
      conciliacoes: linhas.map(paraDTO),
    });
  });

  app.delete('/conciliacoes/:id', escritaConciliacao, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const desfeita = await desconciliarConciliacao(
      app.db,
      { conciliacaoId: id, empresaId: empresaIdEscritada(request) },
      usuario.id,
    );
    return paraDTO(desfeita);
  });
};
