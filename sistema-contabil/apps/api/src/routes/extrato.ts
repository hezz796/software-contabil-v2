import {
  contasBancariasQuerySchema,
  contaBancariaSchema,
  criarContaBancariaRequestSchema,
  criarItemExtratoRequestSchema,
  importarExtratoRequestSchema,
  importacaoExtratoResponseSchema,
  itemExtratoSchema,
  listaContasBancariasResponseSchema,
  listaItensExtratoResponseSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContaBancaria, ImportacaoExtrato, ItemExtrato } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import {
  buscarContaBancariaNaEmpresa,
  criarContaBancaria,
  criarItemExtrato,
  importarExtrato,
  listarContasBancarias,
  listarItensExtrato,
} from '../services/extrato.ts';

/**
 * Conta bancária, itens de extrato e importação OFX/CSV (RF-16, CA-53;
 * TASK-018).
 *
 * - escrita (`POST /contas-bancarias`, `POST .../itens`,
 *   `POST .../importacoes`): guard de escrita contábil (contador atribuído;
 *   admin é recusado auditado — T018-F-1), `empresa_id` resolvido no
 *   SERVIDOR;
 * - leitura (`GET`): contador das empresas atribuídas; admin tem leitura
 *   global auditada (F13/CA-34);
 * - recusa com id alheio = MESMO 404 do inexistente (sem oráculo); a trilha
 *   `conta_bancaria.tentativa_negada` só registra a tentativa alheia real e
 *   NÃO acontece em leitura de detalhe (padrão `GET /titulos/:id`).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

function paraContaDTO(linha: ContaBancaria) {
  return contaBancariaSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    nome: linha.nome,
    saldo_inicial_centavos: linha.saldoInicialCentavos,
    data_saldo_inicial: linha.dataSaldoInicial,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  });
}

function paraItemDTO(item: ItemExtrato & { conciliado?: boolean }) {
  return itemExtratoSchema.parse({
    id: item.id,
    conta_bancaria_id: item.contaBancariaId,
    empresa_id: item.empresaId,
    data: item.data,
    descricao: item.descricao,
    valor_centavos: item.valorCentavos,
    origem: item.origem,
    importacao_id: item.importacaoId,
    identificador: item.identificador,
    conciliado: item.conciliado ?? false,
    criado_por: item.criadoPor,
    criado_em: item.criadoEm,
  });
}

function paraImportacaoDTO(linha: ImportacaoExtrato) {
  return {
    id: linha.id,
    conta_bancaria_id: linha.contaBancariaId,
    empresa_id: linha.empresaId,
    nome_arquivo: linha.nomeArquivo,
    arquivo_hash: linha.arquivoHash,
    quantidade_itens: linha.quantidadeItens,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  };
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

export const extratoRoutes: FastifyPluginAsync = async (app) => {
  const escritaContaBancaria = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'conta_bancaria' })],
  };
  const escritaItem = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'item_extrato' })],
  };
  const escritaImportacao = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'importacao' })],
  };
  const leitura = { preHandler: [exigirAutenticacao] };

  app.post('/contas-bancarias', escritaContaBancaria, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarContaBancariaRequestSchema.parse(request.body);
    const criada = await criarContaBancaria(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        nome: dados.nome,
        saldoInicialCentavos: dados.saldo_inicial_centavos,
        dataSaldoInicial: dados.data_saldo_inicial,
      },
      usuario.id,
    );
    return reply.status(201).send(paraContaDTO(criada));
  });

  app.get('/contas-bancarias', leitura, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = contasBancariasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'conta_bancaria',
      rota: 'GET /contas-bancarias',
    });
    const linhas = await listarContasBancarias(app.db, query.empresa_id);
    return listaContasBancariasResponseSchema.parse({
      contas: linhas.map(paraContaDTO),
    });
  });

  app.get('/contas-bancarias/:id', leitura, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const query = contasBancariasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'conta_bancaria',
      rota: `GET /contas-bancarias/${id}`,
    });
    const linha = await buscarContaBancariaNaEmpresa(app.db, id, query.empresa_id);
    if (!linha) {
      // Inexistente e alheia respondem o MESMO 404 (sem oráculo); leitura de
      // detalhe NÃO gera trilha (padrão GET /titulos/:id).
      throw new ErroAplicacao(
        404,
        'Conta bancária não encontrada nesta empresa.',
        'conta_bancaria_nao_encontrada',
      );
    }
    return paraContaDTO(linha);
  });

  app.post('/contas-bancarias/:id/itens', escritaItem, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = criarItemExtratoRequestSchema.parse(request.body);
    const criado = await criarItemExtrato(
      app.db,
      {
        contaBancariaId: id,
        empresaId: empresaIdEscritada(request),
        data: dados.data,
        descricao: dados.descricao,
        valorCentavos: dados.valor_centavos,
      },
      usuario.id,
    );
    return reply.status(201).send(paraItemDTO(criado));
  });

  app.get('/contas-bancarias/:id/itens', leitura, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const query = contasBancariasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'item_extrato',
      rota: `GET /contas-bancarias/${id}/itens`,
    });
    // Leitura: mesmo 404 do inexistente × alheio, sem trilha (padrão de GET).
    const conta = await buscarContaBancariaNaEmpresa(app.db, id, query.empresa_id);
    if (!conta) {
      throw new ErroAplicacao(
        404,
        'Conta bancária não encontrada nesta empresa.',
        'conta_bancaria_nao_encontrada',
      );
    }
    const itens = await listarItensExtrato(app.db, id, query.empresa_id);
    return listaItensExtratoResponseSchema.parse({
      itens: itens.map(paraItemDTO),
    });
  });

  app.post('/contas-bancarias/:id/importacoes', escritaImportacao, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = importarExtratoRequestSchema.parse(request.body);
    // Base64 validado pelo schema (bytes brutos; o parser resolve o charset)
    const bytes = Buffer.from(dados.conteudo_base64, 'base64');
    const resultado = await importarExtrato(
      app.db,
      {
        contaBancariaId: id,
        empresaId: empresaIdEscritada(request),
        nomeArquivo: dados.nome_arquivo ?? null,
        bytes,
      },
      usuario.id,
    );
    return reply.status(201).send(
      importacaoExtratoResponseSchema.parse({
        importacao: paraImportacaoDTO(resultado.importacao),
        itens: resultado.itens.map((item) => paraItemDTO({ ...item, conciliado: false })),
      }),
    );
  });
};
