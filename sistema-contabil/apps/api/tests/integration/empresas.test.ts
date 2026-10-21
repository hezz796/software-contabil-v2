import { erroResponseSchema, empresaSchema, listaEmpresasResponseSchema } from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, empresa } from '../../src/db/schema.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { registrarRotaEscritaExemplo } from '../fixtures/escrita-exemplo.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

/**
 * Empresas e permissões de escopo (RF-01, RF-04, F13, H13, CA-15/20/23/34/40).
 *
 * A escrita contábil ainda não tem rota de produto (lançamentos/títulos vêm na
 * T014/T016); os testes de recusa de escrita usam uma rota-exemplo montada com
 * o MESMO preHandler de produto `exigirEscritaContabil` — ver
 * `permissoes-escrita.test.ts`.
 */
describe('empresas: cadastro e escopo (RF-01, RF-04, CA-15, CA-20, CA-23, CA-34)', () => {
  test('CA-15 cadastro recusa razão social vazia, CNPJ inválido e CNPJ duplicado, com mensagem específica e nada persistido', async () => {
    const t = await createTestApp();
    try {
      const admin = await criarUsuarioTeste(t.database.db, { papel: 'administrador' });
      const { cookie } = await fazerLogin(t.app, admin.email);
      const totalAntes = t.database.db.select().from(empresa).all().length;

      // razão social vazia
      const semRazao = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: '   ', cnpj: '11222333000181' },
      });
      expect(semRazao.statusCode).toBe(400);
      expect(erroResponseSchema.parse(semRazao.json()).erro).toMatch(/razão social/i);

      // CNPJ com dígito verificador inválido
      const cnpjRuim = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: 'Empresa Boa', cnpj: '11.222.333/0001-82' },
      });
      expect(cnpjRuim.statusCode).toBe(400);
      expect(erroResponseSchema.parse(cnpjRuim.json()).erro).toMatch(/CNPJ inválido/i);

      // CNPJ com tamanho errado
      const cnpjCurto = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: 'Empresa Curta', cnpj: '123' },
      });
      expect(cnpjCurto.statusCode).toBe(400);
      expect(erroResponseSchema.parse(cnpjCurto.json()).erro).toMatch(/14 dígitos/i);

      // cria uma válida para depois duplicar o CNPJ
      const ok = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: 'Alpha Contabilidade Ltda', cnpj: '11.222.333/0001-81' },
      });
      expect(ok.statusCode).toBe(201);
      const criada = empresaSchema.parse(ok.json());
      expect(criada.situacao).toBe('ativa');
      expect(criada.cnpj).toBe('11222333000181'); // normalizado (sem pontuação)

      // duplicado (mesmo com formatação diferente)
      const duplicada = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: 'Outra Empresa', cnpj: '11222333000181' },
      });
      expect(duplicada.statusCode).toBe(409);
      expect(erroResponseSchema.parse(duplicada.json()).erro).toMatch(/CNPJ/i);

      // nada persistido além da criação válida: 4 recusas não geraram linhas
      const depois = t.database.db.select().from(empresa).all();
      expect(depois).toHaveLength(totalAntes + 1);
      expect(depois.filter((linha) => linha.razaoSocial === 'Outra Empresa')).toHaveLength(0);

      // trilha registra a criação (RF-05) — nunca a senha de ninguém
      const eventos = t.database.db.select().from(auditEvent).all();
      expect(eventos.some((evento) => evento.acao === 'empresa.criacao')).toBe(true);
      expect(JSON.stringify(eventos)).not.toMatch(/senha/i);
    } finally {
      await t.close();
    }
  });

  test('CA-20 contador de X não obtém conteúdo de Y: lista omite Y e ID direto é negação (não vazio) auditada', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const y = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Y' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);

      // lista: só X — Y não aparece (nem dado de Y)
      const lista = await t.app.inject({ method: 'GET', url: '/empresas', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      const corpo = listaEmpresasResponseSchema.parse(lista.json());
      expect(corpo.empresas.map((item) => item.id)).toEqual([x.id]);
      expect(lista.body).not.toContain('Empresa Y');

      // ID direto de Y: 403 negação explícita, nunca 200 com dado vazio ou de Y
      const direto = await t.app.inject({
        method: 'GET',
        url: `/empresas/${y.id}`,
        headers: { cookie },
      });
      expect(direto.statusCode).toBe(403);
      expect(erroResponseSchema.parse(direto.json()).erro).toMatch(/acesso negado/i);
      expect(direto.body).not.toContain('Empresa Y');

      // tentativa fica registrada na trilha como tentativa (RF-05/CE-12)
      const tentativas = t.database.db.select().from(auditEvent).all();
      const negada = tentativas.find((evento) => evento.acao === 'escopo.tentativa_negada');
      expect(negada).toBeDefined();
      expect(negada?.usuarioId).toBe(contador.id);
      expect(negada?.empresaId).toBe(y.id);
      expect(negada?.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
    } finally {
      await t.close();
    }
  });

  test('CA-23 contador sem atribuição vê lista vazia de empresas e não grava em nenhuma', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const qualquer = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Qualquer' });
      const semAtribuicao = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [],
      });
      const { cookie } = await fazerLogin(t.app, semAtribuicao.email);

      const lista = await t.app.inject({ method: 'GET', url: '/empresas', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      expect(listaEmpresasResponseSchema.parse(lista.json())).toEqual({ empresas: [] });
      expect(lista.body).not.toMatch(/razao_social|Empresa/);

      // não grava em NENHUMA empresa (nem a existente): recusa auditada
      const escrita = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie },
        payload: { empresa_id: qualquer.id },
      });
      expect(escrita.statusCode).toBe(403);
      const negada = t.database.db
        .select()
        .from(auditEvent)
        .all()
        .find((evento) => evento.acao === 'escopo.tentativa_negada');
      expect(negada?.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
    } finally {
      await t.close();
    }
  });

  test('CA-34 admin sem atribuição lê dados de qualquer empresa e o acesso fica registrado na trilha (leitura global auditada)', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      // admin SEM atribuição nenhuma (F13: gestão + leitura global auditada)
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [],
      });
      const { cookie } = await fazerLogin(t.app, admin.email);

      // leitura direta: dados corretos de X, apesar de não estar atribuído
      const direto = await t.app.inject({
        method: 'GET',
        url: `/empresas/${x.id}`,
        headers: { cookie },
      });
      expect(direto.statusCode).toBe(200);
      const lida = empresaSchema.parse(direto.json());
      expect(lida.razao_social).toBe('Empresa X');
      expect(lida.cnpj).toBe(x.cnpj);

      // lista global: admin vê todas as empresas
      const lista = await t.app.inject({ method: 'GET', url: '/empresas', headers: { cookie } });
      expect(listaEmpresasResponseSchema.parse(lista.json()).empresas.map((item) => item.id)).toEqual(
        expect.arrayContaining([x.id]),
      );

      // a trilha registra a leitura global: admin, empresa lida, horário
      const globais = t.database.db.select().from(auditEvent).all();
      const evento = globais.find((item) => item.acao === 'escopo.leitura_global');
      expect(evento, 'evento de leitura global').toBeDefined();
      expect(evento?.usuarioId).toBe(admin.id);
      expect(evento?.empresaId).toBe(x.id);
      expect(evento?.criadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // admin também consulta a trilha de X (RF-05/CA-39) sem atribuição
      const trilha = await t.app.inject({
        method: 'GET',
        url: `/auditoria?empresa_id=${x.id}`,
        headers: { cookie },
      });
      expect(trilha.statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  test('CA-15 gestão: admin altera situação (ativa/inativa) auditada e não existe exclusão dura (H13)', async () => {
    const t = await createTestApp();
    try {
      const admin = await criarUsuarioTeste(t.database.db, { papel: 'administrador' });
      const { cookie } = await fazerLogin(t.app, admin.email);
      const alvo = criarEmpresaTeste(t.database.db, { razaoSocial: 'Beta Serviços' });

      const inativada = await t.app.inject({
        method: 'PATCH',
        url: `/empresas/${alvo.id}`,
        headers: { cookie },
        payload: { situacao: 'inativa' },
      });
      expect(inativada.statusCode).toBe(200);
      expect(empresaSchema.parse(inativada.json()).situacao).toBe('inativa');

      // auditoria da alteração com antes/depois (RF-05)
      const alteracao = t.database.db
        .select()
        .from(auditEvent)
        .all()
        .find((evento) => evento.acao === 'empresa.alteracao');
      expect(alteracao).toBeDefined();
      expect(alteracao?.dados).toMatchObject({ situacao: { de: 'ativa', para: 'inativa' } });

      // não há rota de exclusão dura: DELETE responde 404 e a linha permanece
      const remocao = await t.app.inject({
        method: 'DELETE',
        url: `/empresas/${alvo.id}`,
        headers: { cookie },
      });
      expect(remocao.statusCode).toBe(404);
      expect(t.database.db.select().from(empresa).all().some((linha) => linha.id === alvo.id)).toBe(
        true,
      );
    } finally {
      await t.close();
    }
  });

  test('CA-21/RF-02 contador não faz gestão: rotas de empresa e de usuário exigem administrador', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db);
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);

      const tentativas = [
        { method: 'POST' as const, url: '/empresas', payload: { razao_social: 'Nova', cnpj: '11222333000181' } },
        { method: 'PATCH' as const, url: `/empresas/${x.id}`, payload: { razao_social: 'Muda' } },
        { method: 'POST' as const, url: '/usuarios', payload: { email: 'novo@x.test', senha: 'senha-forte-123', papel: 'contador' } },
      ];
      for (const rota of tentativas) {
        const resposta = await t.app.inject({ ...rota, headers: { cookie } });
        expect(resposta.statusCode, `${rota.method} ${rota.url}`).toBe(403);
        expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/permissão negada/i);
      }
    } finally {
      await t.close();
    }
  });
});
