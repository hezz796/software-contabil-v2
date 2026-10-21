import {
  atualizarEmpresaRequestSchema,
  criarEmpresaRequestSchema,
  empresaSchema,
  listaEmpresasResponseSchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { requerPapel } from '../middleware/papel.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import {
  atualizarEmpresa,
  buscarEmpresaPorId,
  criarEmpresa,
  listarEmpresasAtribuidas,
  listarTodasEmpresas,
} from '../services/empresas.ts';
import type { Empresa } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';

/**
 * Empresas (RF-01, RF-02, RF-04, H13, CA-15/20/23/34/40).
 *
 * - `POST /empresas`, `PATCH /empresas/:id` — somente administrador (gestão);
 *   CNPJ validado e único; situação ativa/inativa; **sem exclusão dura** (H13:
 *   não existe rota de DELETE — inativar é o caminho, CA-40).
 * - `GET /empresas`, `GET /empresas/:id` — leitura:
 *   - contador: somente empresas **atribuídas**; alheia => 403 com negação
 *     explícita (nunca 200 vazio nem dado de Y — CA-20/CA-23), auditada;
 *   - administrador: **leitura global auditada** (F13/CA-34): lê qualquer
 *     empresa e o acesso fica registrado na trilha (`escopo.leitura_global`).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

function paraDTO(linha: Empresa) {
  return empresaSchema.parse({
    id: linha.id,
    razao_social: linha.razaoSocial,
    cnpj: linha.cnpj,
    situacao: linha.ativo ? 'ativa' : 'inativa',
    criado_em: linha.criadoEm,
  });
}

export const empresaRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/empresas',
    { preHandler: [exigirAutenticacao, requerPapel('administrador')] },
    async (request, reply) => {
      const { usuario } = autenticacaoDe(request);
      const dados = criarEmpresaRequestSchema.parse(request.body);
      const criada = await criarEmpresa(
        app.db,
        { razaoSocial: dados.razao_social, cnpj: dados.cnpj, situacao: dados.situacao },
        usuario.id,
      );
      return reply.status(201).send(paraDTO(criada));
    },
  );

  app.patch(
    '/empresas/:id',
    { preHandler: [exigirAutenticacao, requerPapel('administrador')] },
    async (request) => {
      const { usuario } = autenticacaoDe(request);
      const { id } = paramsIdSchema.parse(request.params);
      const dados = atualizarEmpresaRequestSchema.parse(request.body);
      const alterada = await atualizarEmpresa(
        app.db,
        id,
        {
          razaoSocial: dados.razao_social,
          cnpj: dados.cnpj,
          situacao: dados.situacao,
        },
        usuario.id,
      );
      return paraDTO(alterada);
    },
  );

  app.get('/empresas', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const linhas =
      autenticacao.usuario.papel === 'administrador'
        ? await listarTodasEmpresas(app.db)
        : await listarEmpresasAtribuidas(app.db, autenticacao.empresaIds);
    return listaEmpresasResponseSchema.parse({ empresas: linhas.map(paraDTO) });
  });

  app.get('/empresas/:id', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    await autorizarLeituraEmpresa(app.db, autenticacao, id, {
      objeto: 'empresa',
      rota: `GET /empresas/${id}`,
    });
    const linha = await buscarEmpresaPorId(app.db, id);
    if (!linha) {
      // Não pode acontecer após a autorização (que já recusou inexistente);
      // se acontecer (corrida), recusa — nunca dado alheio (R7).
      throw new ErroAplicacao(403, 'Acesso negado: usuário sem acesso a esta empresa.');
    }
    return paraDTO(linha);
  });
};
