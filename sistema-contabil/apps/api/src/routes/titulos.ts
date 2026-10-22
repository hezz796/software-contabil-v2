import {
  cancelarTituloRequestSchema,
  criarBaixaRequestSchema,
  criarTituloRequestSchema,
  estornarBaixaRequestSchema,
  listaTitulosResponseSchema,
  titulosQuerySchema,
  tituloComBaixasSchema,
  tituloSchema,
  baixaSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDb } from '../db/index.ts';
import type { Baixa, Titulo } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import {
  cancelarTitulo,
  criarBaixa,
  criarTitulo,
  estornarBaixa,
  listarBaixasDoTitulo,
  listarTitulos,
  buscarTituloNaEmpresa,
} from '../services/titulos.ts';

/**
 * Títulos a pagar/receber, baixa total/parcial, cancelamento e estorno de
 * baixa (RF-13/RF-14/RF-15/RF-24, CA-06/07/16/40/41/42/43/55, TASK-016).
 *
 * - Escritas (`POST /titulos`, `POST /titulos/:id/baixas`,
 *   `POST /titulos/:id/cancelamento`, `POST /baixas/:id/estorno`) usam o guard
 *   `exigirEscritaContabil`: contador **atribuído** com empresa ativa
 *   (F13/CA-33 admin recusado auditado; CA-35/36 não-atribuído recusado
 *   auditado; CA-40 empresa inativa recusada). O `empresa_id` usado é o
 *   resolvido no SERVIDOR (`empresaIdEscritada`), nunca o do corpo (RF-04).
 * - Leituras (`GET /titulos`, `GET /titulos/:id`) passam por
 *   `autorizarLeituraEmpresa`: contador só as atribuídas; admin tem leitura
 *   global auditada (F13/CA-34).
 * - A rota de estorno direto de lançamento **recusa** lançamento de baixa
 *   orientando para `POST /baixas/:id/estorno` (D2 — em
 *   `services/lancamentos.ts`).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

/** Data padrão do estorno de baixa quando o cliente não informa (hoje, UTC). */
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

function paraDTODeTitulo(linha: Titulo) {
  return tituloSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    tipo: linha.tipo,
    contraparte: linha.contraparte,
    descricao: linha.descricao,
    vencimento: linha.vencimento,
    valor_centavos: linha.valorCentavos,
    conta_id: linha.contaId,
    situacao: linha.situacao,
    saldo_centavos: linha.saldoCentavos,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
    atualizado_em: linha.atualizadoEm,
  });
}

function paraDTODeBaixa(linha: Baixa) {
  return baixaSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    titulo_id: linha.tituloId,
    lancamento_id: linha.lancamentoId,
    estorno_lancamento_id: linha.estornoLancamentoId,
    data: linha.data,
    valor_centavos: linha.valorCentavos,
    retencao_centavos: linha.retencaoCentavos,
    encargos_centavos: linha.encargosCentavos,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  });
}

async function detalheDoTitulo(db: AppDb, linha: Titulo) {
  const baixas = await listarBaixasDoTitulo(db, linha.id);
  return tituloComBaixasSchema.parse({
    ...paraDTODeTitulo(linha),
    baixas: baixas.map(paraDTODeBaixa),
  });
}

export const tituloRoutes: FastifyPluginAsync = async (app) => {
  const escritaTitulo = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'titulo' })],
  };
  const escritaBaixa = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'baixa' })],
  };

  app.post('/titulos', escritaTitulo, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarTituloRequestSchema.parse(request.body);
    const criado = await criarTitulo(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        tipo: dados.tipo,
        contraparte: dados.contraparte,
        descricao: dados.descricao,
        vencimento: dados.vencimento,
        valorCentavos: dados.valor_centavos,
        contaId: dados.conta_id,
      },
      usuario.id,
    );
    return reply.status(201).send(await detalheDoTitulo(app.db, criado));
  });

  app.get('/titulos', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = titulosQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'titulo',
      rota: 'GET /titulos',
    });
    const linhas = await listarTitulos(app.db, query.empresa_id, {
      tipo: query.tipo,
      situacao: query.situacao,
    });
    return listaTitulosResponseSchema.parse({
      titulos: linhas.map(paraDTODeTitulo),
    });
  });

  app.get('/titulos/:id', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const query = titulosQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'titulo',
      rota: `GET /titulos/${id}`,
    });
    const linha = await buscarTituloNaEmpresa(app.db, id, query.empresa_id);
    if (!linha) {
      // Nunca dado alheio (R7): fora da empresa autorizada a resposta é
      // negação/404, como em `GET /contas/:id`.
      throw new ErroAplicacao(404, 'Título não encontrado nesta empresa.', 'titulo_nao_encontrado');
    }
    return detalheDoTitulo(app.db, linha);
  });

  app.post('/titulos/:id/baixas', escritaBaixa, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = criarBaixaRequestSchema.parse(request.body);
    const resultado = await criarBaixa(
      app.db,
      {
        tituloId: id,
        empresaId: empresaIdEscritada(request),
        data: dados.data,
        valorCentavos: dados.valor_centavos,
        contaContrapartidaId: dados.conta_contrapartida_id,
      },
      usuario.id,
    );
    return reply.status(201).send(paraDTODeBaixa(resultado.baixa));
  });

  app.post('/titulos/:id/cancelamento', escritaTitulo, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    cancelarTituloRequestSchema.parse(request.body);
    const cancelado = await cancelarTitulo(
      app.db,
      { tituloId: id, empresaId: empresaIdEscritada(request) },
      usuario.id,
    );
    return reply.status(200).send(await detalheDoTitulo(app.db, cancelado));
  });

  app.post('/baixas/:id/estorno', escritaBaixa, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = estornarBaixaRequestSchema.parse(request.body ?? {});
    const resultado = await estornarBaixa(
      app.db,
      { baixaId: id, empresaId: empresaIdEscritada(request), data: dados.data ?? hoje() },
      usuario.id,
    );
    return reply.status(201).send(paraDTODeBaixa(resultado.baixa));
  });
};
