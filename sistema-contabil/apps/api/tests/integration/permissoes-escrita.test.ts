import {
  atribuicoesResponseSchema,
  erroResponseSchema,
  listaUsuariosResponseSchema,
  usuarioGestaoSchema,
} from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, usuarioEmpresa } from '../../src/db/schema.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { registrarRotaEscritaExemplo } from '../fixtures/escrita-exemplo.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

/** Eventos de trilha de um determinado tipo. */
function eventosDe(t: Awaited<ReturnType<typeof createTestApp>>, acao: string) {
  return t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

/**
 * Permissões de escrita contábil e gestão (F13, RF-02/RF-04, R10, CA-33/35/36/37/40).
 *
 * A escrita contábil não tem rota de produto ainda (T014/T016); os testes usam
 * a rota-exemplo que aplica o MESMO preHandler de produto
 * (`exigirEscritaContabil`) — as recusas auditadas verificadas aqui valem para
 * o produto.
 */
describe('permissões admin x contador e escopo de escrita (F13, CA-33, CA-35, CA-36, CA-37, CA-40)', () => {
  test('CA-33 admin não grava lançamento: escrita contábil recusada, auditada e nada persistido', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, admin.email);

      const antes = t.database.db.select().from(auditEvent).all().length;
      const escrita = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie },
        payload: { empresa_id: x.id, historico: 'Tentativa do admin' },
      });
      expect(escrita.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escrita.json()).erro).toMatch(/escrita contábil/i);

      // nada persistido além do evento de tentativa (não existe lançamento)
      const depois = t.database.db.select().from(auditEvent).all();
      expect(depois).toHaveLength(antes + 1);
      expect(depois[depois.length - 1]?.acao).toBe('escopo.tentativa_negada');

      // tentativa auditada com usuário, empresa, objeto e motivo
      const negada = eventosDe(t, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(admin.id);
      expect(negada.empresaId).toBe(x.id);
      expect(negada.objetoTipo).toBe('lancamento');
      expect(negada.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });

      // gestão continua funcionando para o admin (cria empresa sem atribuição)
      const gestao = await t.app.inject({
        method: 'POST',
        url: '/empresas',
        headers: { cookie },
        payload: { razao_social: 'Gamma Admin', cnpj: '11222333000181' },
      });
      expect(gestao.statusCode).toBe(201);
    } finally {
      await t.close();
    }
  });

  test('CA-35 contador atribuído a X adultera empresa_id no corpo para Y: escrita recusada e auditada como tentativa', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const y = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Y' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);

      // formulário adulterado: o contador é de X, aponta para Y
      const adulterado = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie },
        payload: { empresa_id: y.id, historico: 'Escrita cruzada' },
      });
      expect(adulterado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(adulterado.json()).erro).toMatch(/acesso negado/i);

      // auditada como tentativa, com usuário, empresa alvo, objeto e motivo
      const negada = eventosDe(t, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(contador.id);
      expect(negada.empresaId).toBe(y.id);
      expect(negada.objetoTipo).toBe('lancamento');
      expect(negada.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });

      // nada persistido em Y (nenhuma escrita além da trilha)
      expect(eventosDe(t, 'lancamento.criacao')).toHaveLength(0);

      // escrita legítima em X usa o escopo do SERVIDOR (não o enviado)
      const legitimo = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie },
        payload: { empresa_id: x.id, historico: 'Lançamento de X' },
      });
      expect(legitimo.statusCode).toBe(200);
      expect(legitimo.json()).toMatchObject({ ok: true, empresa_id: x.id });
    } finally {
      await t.close();
    }
  });

  test('CA-36 contador de X envia requisição direta com identificador de Y na URL: negação auditada', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const y = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Y' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);

      // requisição direta: empresa de Y via query string
      const direta = await t.app.inject({
        method: 'POST',
        url: `/lancamentos-exemplo?empresa_id=${y.id}`,
        headers: { cookie },
        payload: {},
      });
      expect(direta.statusCode).toBe(403);
      expect(erroResponseSchema.parse(direta.json()).erro).toMatch(/acesso negado/i);
      expect(direta.body).not.toContain('Empresa Y');

      const negada = eventosDe(t, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(contador.id);
      expect(negada.empresaId).toBe(y.id);
      expect(negada.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
    } finally {
      await t.close();
    }
  });

  test('CA-37 admin remove atribuição: efeito imediato sem novo login; empresa restante segue funcionando', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const z = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Z' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id, z.id],
      });
      const admin = await criarUsuarioTeste(t.database.db, {
        email: 'admin2@escritorio.test',
        papel: 'administrador',
      });
      const { cookie: cookieContador } = await fazerLogin(t.app, contador.email);
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);

      // antes da remoção: leitura e escrita em Z funcionam
      const leituraAntes = await t.app.inject({
        method: 'GET',
        url: `/empresas/${z.id}`,
        headers: { cookie: cookieContador },
      });
      expect(leituraAntes.statusCode).toBe(200);

      // admin remove a atribuição a Z (API de gestão)
      const remocao = await t.app.inject({
        method: 'DELETE',
        url: `/usuarios/${contador.id}/empresas/${z.id}`,
        headers: { cookie: cookieAdmin },
      });
      expect(remocao.statusCode).toBe(200);
      expect(atribuicoesResponseSchema.parse(remocao.json()).empresa_ids).toEqual([x.id]);

      // SEM novo login (mesmo cookie): tentativa seguinte em Z é negada
      const leituraDepois = await t.app.inject({
        method: 'GET',
        url: `/empresas/${z.id}`,
        headers: { cookie: cookieContador },
      });
      expect(leituraDepois.statusCode).toBe(403);
      expect(erroResponseSchema.parse(leituraDepois.json()).erro).toMatch(/acesso negado/i);

      const escritaDepois = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie: cookieContador },
        payload: { empresa_id: z.id },
      });
      expect(escritaDepois.statusCode).toBe(403);

      // enquanto isso, X continua funcionando normalmente
      const leituraX = await t.app.inject({
        method: 'GET',
        url: `/empresas/${x.id}`,
        headers: { cookie: cookieContador },
      });
      expect(leituraX.statusCode).toBe(200);
      const escritaX = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie: cookieContador },
        payload: { empresa_id: x.id },
      });
      expect(escritaX.statusCode).toBe(200);

      // remoção auditada com efeito imediato (RF-05/R10)
      const remocaoEvento = eventosDe(t, 'usuario.remocao_atribuicao').at(-1)!;
      expect(remocaoEvento.usuarioId).toBe(admin.id);
      expect(remocaoEvento.empresaId).toBe(z.id);
      expect(remocaoEvento.objetoId).toBe(String(contador.id));
    } finally {
      await t.close();
    }
  });

  test('CA-40 empresa inativa bloqueia escrita contábil com mensagem específica; leitura permanece liberada', async () => {
    const t = await createTestApp();
    try {
      registrarRotaEscritaExemplo(t.app);
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const admin = await criarUsuarioTeste(t.database.db, {
        email: 'admin3@escritorio.test',
        papel: 'administrador',
      });
      const { cookie: cookieContador } = await fazerLogin(t.app, contador.email);
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);

      // enquanto ativa, a escrita passa pelo guard
      const antesDaInativacao = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie: cookieContador },
        payload: { empresa_id: x.id },
      });
      expect(antesDaInativacao.statusCode).toBe(200);

      // admin inativa a empresa (H13: inativar, não excluir)
      const inativacao = await t.app.inject({
        method: 'PATCH',
        url: `/empresas/${x.id}`,
        headers: { cookie: cookieAdmin },
        payload: { situacao: 'inativa' },
      });
      expect(inativacao.statusCode).toBe(200);

      // escrita nova recusada com mensagem de empresa inativa (CE-14/CE-20)
      const escrita = await t.app.inject({
        method: 'POST',
        url: '/lancamentos-exemplo',
        headers: { cookie: cookieContador },
        payload: { empresa_id: x.id },
      });
      expect(escrita.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escrita.json()).erro).toMatch(/inativa/i);

      // recusa auditada (trilha registra o motivo)
      const negada = eventosDe(t, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.dados).toMatchObject({ motivo: 'empresa_inativa' });

      // leitura permanece liberada (histórico consultável)
      const leitura = await t.app.inject({
        method: 'GET',
        url: `/empresas/${x.id}`,
        headers: { cookie: cookieContador },
      });
      expect(leitura.statusCode).toBe(200);
      expect(leitura.json()).toMatchObject({ situacao: 'inativa' });
      const lista = await t.app.inject({
        method: 'GET',
        url: '/empresas',
        headers: { cookie: cookieContador },
      });
      expect(lista.statusCode).toBe(200);
      expect(lista.body).toContain('Empresa X');
    } finally {
      await t.close();
    }
  });

  test('RF-02 admin cria/edita usuários, define papel, atribui empresas; senha nunca aparece na resposta', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const z = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Z' });
      const admin = await criarUsuarioTeste(t.database.db, { papel: 'administrador' });
      const { cookie } = await fazerLogin(t.app, admin.email);

      // cria contador já atribuído a X
      const criado = await t.app.inject({
        method: 'POST',
        url: '/usuarios',
        headers: { cookie },
        payload: {
          email: 'novo.contador@escritorio.test',
          senha: 'senha-forte-456',
          papel: 'contador',
          empresa_ids: [x.id],
        },
      });
      expect(criado.statusCode).toBe(201);
      const usuario = usuarioGestaoSchema.parse(criado.json());
      expect(usuario.papel).toBe('contador');
      expect(usuario.empresa_ids).toEqual([x.id]);
      expect(criado.body).not.toMatch(/senha|hash/i); // nunca senha_hash

      // login com a senha recém-criada funciona (hash Argon2id no banco)
      const login = await fazerLogin(t.app, 'novo.contador@escritorio.test', 'senha-forte-456');
      expect(login.corpo.usuario.papel).toBe('contador');

      // promove a administrador e atribui mais uma empresa
      const promovido = await t.app.inject({
        method: 'PATCH',
        url: `/usuarios/${usuario.id}`,
        headers: { cookie },
        payload: { papel: 'administrador' },
      });
      expect(promovido.statusCode).toBe(200);
      expect(usuarioGestaoSchema.parse(promovido.json()).papel).toBe('administrador');

      const atribuida = await t.app.inject({
        method: 'POST',
        url: `/usuarios/${usuario.id}/empresas`,
        headers: { cookie },
        payload: { empresa_id: z.id },
      });
      expect(atribuida.statusCode).toBe(200);
      expect(atribuicoesResponseSchema.parse(atribuida.json()).empresa_ids).toEqual([x.id, z.id]);

      // lista de gestão traz os atribuídos e nunca credenciais
      const lista = await t.app.inject({ method: 'GET', url: '/usuarios', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      const corpo = listaUsuariosResponseSchema.parse(lista.json());
      expect(corpo.usuarios.some((item) => item.email === 'novo.contador@escritorio.test')).toBe(true);
      expect(lista.body).not.toMatch(/senha|hash/i);

      // criação e alterações auditadas (RF-05)
      expect(eventosDe(t, 'usuario.criacao').length).toBeGreaterThanOrEqual(1);
      expect(eventosDe(t, 'usuario.atribuicao_empresa').length).toBeGreaterThanOrEqual(1);
      expect(eventosDe(t, 'usuario.alteracao').length).toBeGreaterThanOrEqual(1);
      // a trilha nunca registra senha em claro nem hash
      expect(t.database.db.select().from(auditEvent).all().map((evento) => JSON.stringify(evento.dados)).join()).not.toMatch(/senha-forte/i);
    } finally {
      await t.close();
    }
  });

  test('RF-02 ativa/desativa usuário tem efeito imediato (R10) e remoção de empresa exige existência', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db);
      const admin = await criarUsuarioTeste(t.database.db, { papel: 'administrador' });
      const alvo = await criarUsuarioTeste(t.database.db, {
        email: 'alvo@escritorio.test',
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);
      const { cookie: cookieAlvo } = await fazerLogin(t.app, alvo.email);

      // desativa: sessão ativa é negada na tentativa seguinte (CA-22/R10)
      const situacao = await t.app.inject({
        method: 'PUT',
        url: `/usuarios/${alvo.id}/situacao`,
        headers: { cookie: cookieAdmin },
        payload: { ativo: false },
      });
      expect(situacao.statusCode).toBe(200);
      expect(usuarioGestaoSchema.parse(situacao.json()).ativo).toBe(false);
      const negado = await t.app.inject({ method: 'GET', url: '/me', headers: { cookie: cookieAlvo } });
      expect(negado.statusCode).toBe(401);

      // atribuir empresa inexistente: 404, nada persistido
      const inexistente = await t.app.inject({
        method: 'POST',
        url: `/usuarios/${alvo.id}/empresas`,
        headers: { cookie: cookieAdmin },
        payload: { empresa_id: 9999 },
      });
      expect(inexistente.statusCode).toBe(404);
      expect(erroResponseSchema.parse(inexistente.json()).erro).toMatch(/empresa não encontrada/i);
      expect(
        t.database.db.select().from(usuarioEmpresa).all().filter((linha) => linha.empresaId === 9999),
      ).toHaveLength(0);

      // remover atribuição inexistente: 404
      const remocaoFantasma = await t.app.inject({
        method: 'DELETE',
        url: `/usuarios/${alvo.id}/empresas/9999`,
        headers: { cookie: cookieAdmin },
      });
      expect(remocaoFantasma.statusCode).toBe(404);
    } finally {
      await t.close();
    }
  });
});
