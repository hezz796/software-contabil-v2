import {
  atualizarContaRequestSchema,
  contasQuerySchema,
  contaSchema,
  criarContaRequestSchema,
  listaContasResponseSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conta } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import {
  buscarContaNaEmpresa,
  contaTemLancamentos,
  contasComLancamentos,
  criarConta,
  atualizarConta,
  excluirConta,
  listarContas,
} from '../services/contas.ts';

/**
 * Plano de contas hierárquico (RF-06, CA-17/CA-27, CE-13).
 *
 * - `POST /contas`, `PATCH /contas/:id`, `DELETE /contas/:id` — escrita
 *   contábil: somente contador **atribuído** à empresa (F13/CA-33: admin é
 *   recusado auditado pelo guard `exigirEscritaContabil`; CA-35/36: contador
 *   não atribuído é recusado auditado). O `empresa_id` usado é o resolvido no
 *   SERVIDOR, nunca o enviado como confiável (RF-04/ADR-0001).
 * - `GET /contas`, `GET /contas/:id` — leitura: contador só as empresas
 *   atribuídas; administrador tem **leitura global auditada** (F13/CA-34).
 * - **Não existe exclusão dura** (H13/CA-17): `DELETE` é registrado como
 *   tentativa e recusado com orientação a inativar (CE-13).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

function paraDTO(linha: Conta, temLancamentos: boolean) {
  return contaSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    codigo: linha.codigo,
    descricao: linha.descricao,
    tipo: linha.tipo,
    conta_pai_id: linha.contaPaiId,
    situacao: linha.ativa ? 'ativa' : 'inativa',
    tem_lancamentos: temLancamentos,
    criado_em: linha.criadoEm,
    atualizado_em: linha.atualizadoEm,
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

export const contaRoutes: FastifyPluginAsync = async (app) => {
  const escritaConta = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'conta' })],
  };

  app.post('/contas', escritaConta, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarContaRequestSchema.parse(request.body);
    const criada = await criarConta(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        codigo: dados.codigo,
        descricao: dados.descricao,
        tipo: dados.tipo,
        contaPaiId: dados.conta_pai_id,
        situacao: dados.situacao,
      },
      usuario.id,
    );
    return reply.status(201).send(paraDTO(criada, false));
  });

  app.get('/contas', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = contasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'conta',
      rota: 'GET /contas',
    });
    const linhas = await listarContas(app.db, query.empresa_id, {
      somenteAtivas: query.somente_ativas === 'true',
    });
    const comLancamentos = contasComLancamentos(app.db, linhas.map((linha) => linha.id));
    return listaContasResponseSchema.parse({
      contas: linhas.map((linha) => paraDTO(linha, comLancamentos.has(linha.id))),
    });
  });

  app.get('/contas/:id', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const query = contasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'conta',
      rota: `GET /contas/${id}`,
    });
    const linha = await buscarContaNaEmpresa(app.db, id, query.empresa_id);
    if (!linha) {
      // Nunca dado alheio (R7): fora da empresa autorizada a resposta é
      // negação/404, como em `GET /empresas/:id`.
      throw new ErroAplicacao(404, 'Conta não encontrada nesta empresa.', 'conta_nao_encontrada');
    }
    return paraDTO(linha, contaTemLancamentos(app.db, linha.id));
  });

  app.patch('/contas/:id', escritaConta, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = atualizarContaRequestSchema.parse(request.body);
    const alterada = await atualizarConta(
      app.db,
      { contaId: id, empresaId: empresaIdEscritada(request) },
      {
        descricao: dados.descricao,
        tipo: dados.tipo,
        situacao: dados.situacao,
      },
      usuario.id,
    );
    return paraDTO(alterada, contaTemLancamentos(app.db, alterada.id));
  });

  app.delete('/contas/:id', escritaConta, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    // Sempre recusa (CA-17/CA-27/CE-13): não existe exclusão dura de conta; a
    // tentativa é auditada dentro do serviço e orienta a inativar.
    await excluirConta(app.db, { contaId: id, empresaId: empresaIdEscritada(request) }, usuario.id);
  });
};
