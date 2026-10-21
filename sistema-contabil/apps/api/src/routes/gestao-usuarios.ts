import {
  atribuicaoEmpresaRequestSchema,
  atribuicoesResponseSchema,
  atualizarUsuarioRequestSchema,
  criarUsuarioRequestSchema,
  listaUsuariosResponseSchema,
  listaEmpresasResponseSchema,
  situacaoUsuarioRequestSchema,
  usuarioGestaoSchema,
  type UsuarioGestao,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Usuario } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { requerPapel } from '../middleware/papel.ts';
import { listarEmpresasAtribuidas } from '../services/empresas.ts';
import {
  atualizarUsuario,
  atribuirEmpresa,
  buscarUsuarioPorId,
  criarUsuario,
  definirUsuarioAtivo,
  listarAtribuicoes,
  listarUsuarios,
  removerAtribuicao,
} from '../services/usuarios.ts';

/**
 * Gestão de usuários, papéis e atribuições pelo administrador (RF-02, RF-04,
 * R10, F13, CA-02/21/33/37).
 *
 * Todas as rotas exigem papel administrador (contador recebe 403 — CA-21):
 *
 * - `POST /usuarios` — cria usuário com papel e atribuições iniciais;
 * - `GET /usuarios`, `GET /usuarios/:id` — lista/detalhe com atribuições
 *   (nunca `senha_hash`);
 * - `PATCH /usuarios/:id` — e-mail, senha (H15) e/ou papel;
 * - `PUT /usuarios/:id/situacao` — ativa/desativa (R10: efeito imediato);
 * - `POST /usuarios/:id/empresas` — atribui empresa;
 * - `DELETE /usuarios/:id/empresas/:empresaId` — remove atribuição com efeito
 *   IMEDIATO na tentativa seguinte, sem novo login (CA-37).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });
const paramsAtribuicaoSchema = paramsIdSchema.extend({
  empresaId: z.coerce.number().int().positive(),
});

function paraDTO(
  linha: Pick<Usuario, 'id' | 'email' | 'papel' | 'ativo' | 'criadoEm'> & { empresaIds: number[] },
): UsuarioGestao {
  return usuarioGestaoSchema.parse({
    id: linha.id,
    email: linha.email,
    papel: linha.papel,
    ativo: linha.ativo,
    empresa_ids: linha.empresaIds,
    criado_em: linha.criadoEm,
  });
}

export const gestaoUsuariosRoutes: FastifyPluginAsync = async (app) => {
  const somenteAdmin = { preHandler: [exigirAutenticacao, requerPapel('administrador')] };

  app.post('/usuarios', somenteAdmin, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarUsuarioRequestSchema.parse(request.body);
    const criado = await criarUsuario(app.db, {
      email: dados.email,
      senha: dados.senha,
      papel: dados.papel,
      atorId: usuario.id,
      empresaIds: dados.empresa_ids,
    });
    const empresaIds = await listarAtribuicoes(app.db, criado.id);
    const linha = await buscarLinhaUsuario(app, criado.id);
    return reply.status(201).send(paraDTO({ ...linha, empresaIds }));
  });

  app.get('/usuarios', somenteAdmin, async () => {
    const linhas = await listarUsuarios(app.db);
    return listaUsuariosResponseSchema.parse({
      usuarios: linhas.map((linha) => paraDTO(linha)),
    });
  });

  app.get('/usuarios/:id', somenteAdmin, async (request) => {
    const { id } = paramsIdSchema.parse(request.params);
    const linha = await buscarLinhaUsuario(app, id);
    const empresaIds = await listarAtribuicoes(app.db, id);
    return paraDTO({ ...linha, empresaIds });
  });

  app.patch('/usuarios/:id', somenteAdmin, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = atualizarUsuarioRequestSchema.parse(request.body);
    await atualizarUsuario(app.db, id, {
      email: dados.email,
      senha: dados.senha,
      papel: dados.papel,
      atorId: usuario.id,
    });
    const linha = await buscarLinhaUsuario(app, id);
    const empresaIds = await listarAtribuicoes(app.db, id);
    return paraDTO({ ...linha, empresaIds });
  });

  app.put('/usuarios/:id/situacao', somenteAdmin, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const { ativo } = situacaoUsuarioRequestSchema.parse(request.body);
    await definirUsuarioAtivo(app.db, { usuarioId: id, ativo, atorId: usuario.id });
    const linha = await buscarLinhaUsuario(app, id);
    const empresaIds = await listarAtribuicoes(app.db, id);
    return paraDTO({ ...linha, empresaIds });
  });

  app.post('/usuarios/:id/empresas', somenteAdmin, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const { empresa_id } = atribuicaoEmpresaRequestSchema.parse(request.body);
    await atribuirEmpresa(app.db, id, empresa_id, usuario.id);
    return atribuicoesResponseSchema.parse({ empresa_ids: await listarAtribuicoes(app.db, id) });
  });

  app.get('/usuarios/:id/empresas', somenteAdmin, async (request) => {
    const { id } = paramsIdSchema.parse(request.params);
    const empresaIds = await listarAtribuicoes(app.db, id);
    // Devolve também as empresas em si (visão de gestão); só as atribuídas.
    const empresas = await listarEmpresasAtribuidas(app.db, empresaIds);
    return listaEmpresasResponseSchema.parse({
      empresas: empresas.map((linha) => ({
        id: linha.id,
        razao_social: linha.razaoSocial,
        cnpj: linha.cnpj,
        situacao: linha.ativo ? ('ativa' as const) : ('inativa' as const),
        criado_em: linha.criadoEm,
      })),
    });
  });

  app.delete('/usuarios/:id/empresas/:empresaId', somenteAdmin, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id, empresaId } = paramsAtribuicaoSchema.parse(request.params);
    await removerAtribuicao(app.db, id, empresaId, usuario.id);
    return atribuicoesResponseSchema.parse({ empresa_ids: await listarAtribuicoes(app.db, id) });
  });
};

/** Busca a linha completa do usuário ou recusa 404 (mensagens consistentes). */
async function buscarLinhaUsuario(
  app: { db: import('../db/index.ts').AppDb },
  id: number,
): Promise<Usuario> {
  const linha = await buscarUsuarioPorId(app.db, id);
  if (!linha) {
    throw new ErroAplicacao(404, 'Usuário não encontrado.', 'usuario_nao_encontrado');
  }
  return linha;
}
