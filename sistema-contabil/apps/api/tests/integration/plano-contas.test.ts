import {
  contaSchema,
  erroResponseSchema,
  listaContasResponseSchema,
  listaPeriodosResponseSchema,
  periodoContabilSchema,
} from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, conta, periodoContabil } from '../../src/db/schema.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarPeriodoTeste, simularLancamentoEmConta } from '../fixtures/contas.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestApp } from '../harness.ts';

/** Eventos de trilha de um determinado tipo. */
function eventosDe(t: Awaited<ReturnType<typeof createTestApp>>, acao: string) {
  return t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

function contasNoBanco(t: Awaited<ReturnType<typeof createTestApp>>) {
  return t.database.db.select().from(conta).all();
}

function periodosNoBanco(t: Awaited<ReturnType<typeof createTestApp>>) {
  return t.database.db.select().from(periodoContabil).all();
}

/**
 * Plano de contas hierárquico e períodos contábeis (RF-06, RF-09, CA-17/CA-27).
 *
 * A fixture `simularLancamentoEmConta` (T014) grava lançamento + partida nas
 * tabelas REAIS para exercitar as regras de "conta com lançamentos"
 * (CA-17/CA-27) pelo caminho de produção.
 */
describe('plano de contas hierárquico (RF-06, CA-17, CA-27)', () => {
  test('CA-17 criação de conta recusa código duplicado na empresa, tipo ausente e exclusão de conta com lançamentos — apenas inativar é oferecido; nada persistido', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const y = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Y' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id, y.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);
      const totalAntes = contasNoBanco(t).length;

      // criação válida
      const ok = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: { empresa_id: x.id, codigo: '1.1.1', descricao: 'Caixa', tipo: 'ativo' },
      });
      expect(ok.statusCode).toBe(201);
      const caixa = contaSchema.parse(ok.json());
      expect(caixa.situacao).toBe('ativa');
      expect(caixa.tem_lancamentos).toBe(false);
      expect(caixa.conta_pai_id).toBeNull();

      // código duplicado NA MESMA empresa: 409 com mensagem específica
      const duplicada = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: { empresa_id: x.id, codigo: '1.1.1', descricao: 'Outra', tipo: 'ativo' },
      });
      expect(duplicada.statusCode).toBe(409);
      expect(erroResponseSchema.parse(duplicada.json()).erro).toMatch(/código/i);

      // o MESMO código em outra empresa é aceito (único por empresa, não global)
      const emY = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: { empresa_id: y.id, codigo: '1.1.1', descricao: 'Caixa de Y', tipo: 'ativo' },
      });
      expect(emY.statusCode).toBe(201);

      // tipo ausente: 400 com mensagem citando as opções
      const semTipo = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: { empresa_id: x.id, codigo: '5', descricao: 'Despesas diversas' },
      });
      expect(semTipo.statusCode).toBe(400);
      expect(erroResponseSchema.parse(semTipo.json()).erro).toMatch(/tipo da conta/i);

      // exclusão de conta COM LANÇAMENTOS: recusada com orientação a inativar
      simularLancamentoEmConta(t.database.db, caixa.id, x.id);
      const exclusao = await t.app.inject({
        method: 'DELETE',
        url: `/contas/${caixa.id}?empresa_id=${x.id}`,
        headers: { cookie },
      });
      expect(exclusao.statusCode).toBe(405);
      expect(erroResponseSchema.parse(exclusao.json()).erro).toMatch(/inativar/i);

      // nada persistido além das duas criações válidas (recusas não geraram linhas
      // nem removeram a conta)
      const depois = contasNoBanco(t);
      expect(depois).toHaveLength(totalAntes + 2);
      expect(depois.some((linha) => linha.id === caixa.id)).toBe(true);
      expect(depois.filter((linha) => linha.codigo === '5')).toHaveLength(0);

      // a listagem sinaliza "tem lançamentos" (base da recusa de exclusão)
      const listagem = await t.app.inject({
        method: 'GET',
        url: `/contas?empresa_id=${x.id}`,
        headers: { cookie },
      });
      expect(listagem.statusCode).toBe(200);
      const corpo = listaContasResponseSchema.parse(listagem.json());
      expect(corpo.contas.map((item) => item.id)).toEqual([caixa.id]);
      expect(corpo.contas[0]?.tem_lancamentos).toBe(true);

      // trilha registra criações e a tentativa de exclusão (RF-05/CE-13)
      expect(eventosDe(t, 'conta.criacao')).toHaveLength(2);
      const recusa = eventosDe(t, 'conta.exclusao_recusada').at(-1);
      expect(recusa).toBeDefined();
      expect(recusa?.empresaId).toBe(x.id);
      expect(recusa?.objetoId).toBe(String(caixa.id));
      expect(recusa?.dados).toMatchObject({ tem_lancamentos: true });
    } finally {
      await t.close();
    }
  });

  test('CA-27 inativar conta com lançamentos é aceito; excluir é recusado; pai com filhas ativas não inativa antes das filhas', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);

      // hierarquia: 1 — Ativo > 1.1 — Ativo circulante > 1.1.1 — Caixa
      const ativo = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: { empresa_id: x.id, codigo: '1', descricao: 'Ativo', tipo: 'ativo' },
      });
      expect(ativo.statusCode).toBe(201);
      const pai = contaSchema.parse(ativo.json());

      const circulante = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie },
        payload: {
          empresa_id: x.id,
          codigo: '1.1',
          descricao: 'Ativo circulante',
          tipo: 'ativo',
          conta_pai_id: pai.id,
        },
      });
      expect(circulante.statusCode).toBe(201);
      const filha = contaSchema.parse(circulante.json());
      expect(filha.conta_pai_id).toBe(pai.id);

      // a pai tem lançamentos: excluir continua recusado (inativar é o caminho)
      simularLancamentoEmConta(t.database.db, pai.id, x.id);
      const exclusao = await t.app.inject({
        method: 'DELETE',
        url: `/contas/${pai.id}?empresa_id=${x.id}`,
        headers: { cookie },
      });
      expect(exclusao.statusCode).toBe(405);
      expect(erroResponseSchema.parse(exclusao.json()).erro).toMatch(/inativar/i);

      // pai com filha ATIVA não inativa antes das filhas
      const paiAntesDaInativacao = await t.app.inject({
        method: 'PATCH',
        url: `/contas/${pai.id}?empresa_id=${x.id}`,
        headers: { cookie },
        payload: { situacao: 'inativa' },
      });
      expect(paiAntesDaInativacao.statusCode).toBe(409);
      expect(erroResponseSchema.parse(paiAntesDaInativacao.json()).erro).toMatch(/filhas ativas/i);
      expect(contasNoBanco(t).find((linha) => linha.id === pai.id)?.ativa).toBe(true);

      // inativar a filha funciona normalmente
      const filhaInativada = await t.app.inject({
        method: 'PATCH',
        url: `/contas/${filha.id}?empresa_id=${x.id}`,
        headers: { cookie },
        payload: { situacao: 'inativa' },
      });
      expect(filhaInativada.statusCode).toBe(200);
      expect(contaSchema.parse(filhaInativada.json()).situacao).toBe('inativa');

      // com a filha inativada, a pai inativa (mesmo com lançamentos — aceito)
      const paiInativada = await t.app.inject({
        method: 'PATCH',
        url: `/contas/${pai.id}?empresa_id=${x.id}`,
        headers: { cookie },
        payload: { situacao: 'inativa' },
      });
      expect(paiInativada.statusCode).toBe(200);
      expect(contaSchema.parse(paiInativada.json()).situacao).toBe('inativa');
      expect(contaSchema.parse(paiInativada.json()).tem_lancamentos).toBe(true);
      expect(contasNoBanco(t).find((linha) => linha.id === pai.id)?.ativa).toBe(false);

      // inativar tira a conta das escolhas novas; reativar é permitido
      const somenteAtivas = await t.app.inject({
        method: 'GET',
        url: `/contas?empresa_id=${x.id}&somente_ativas=true`,
        headers: { cookie },
      });
      expect(listaContasResponseSchema.parse(somenteAtivas.json()).contas).toHaveLength(0);

      const reativada = await t.app.inject({
        method: 'PATCH',
        url: `/contas/${pai.id}?empresa_id=${x.id}`,
        headers: { cookie },
        payload: { situacao: 'ativa' },
      });
      expect(reativada.statusCode).toBe(200);
      expect(contaSchema.parse(reativada.json()).situacao).toBe('ativa');

      // auditoria registra as alterações com antes/depois (RF-05)
      const alteracoes = eventosDe(t, 'conta.alteracao');
      expect(
        alteracoes.some((evento) =>
          JSON.stringify(evento.dados).includes('"situacao":{"de":"ativa","para":"inativa"}'),
        ),
      ).toBe(true);
    } finally {
      await t.close();
    }
  });

  test('F13/CA-33 admin não escreve no plano de contas; contador só nas empresas atribuídas; leitura global do admin é auditada', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [],
      });
      const naoAtribuido = await criarUsuarioTeste(t.database.db, {
        email: 'contador.de.outra@escritorio.test',
        papel: 'contador',
        empresas: [],
      });
      const atribuido = await criarUsuarioTeste(t.database.db, {
        email: 'contador.de.x@escritorio.test',
        papel: 'contador',
        empresas: [x.id],
      });
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);
      const { cookie: cookieNaoAtribuido } = await fazerLogin(t.app, naoAtribuido.email);
      const { cookie: cookieAtribuido } = await fazerLogin(t.app, atribuido.email);

      // admin: sem escrita contábil (F13) — recusado e auditado, nada persistido
      const escritaAdmin = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie: cookieAdmin },
        payload: { empresa_id: x.id, codigo: '1', descricao: 'Ativo', tipo: 'ativo' },
      });
      expect(escritaAdmin.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAdmin.json()).erro).toMatch(/escrita contábil/i);
      const negadaAdmin = eventosDe(t, 'escopo.tentativa_negada').at(-1);
      expect(negadaAdmin?.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });
      expect(contasNoBanco(t)).toHaveLength(0);

      // contador não atribuído: tentativa cruzada de tenant auditada
      const escritaAlheia = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie: cookieNaoAtribuido },
        payload: { empresa_id: x.id, codigo: '1', descricao: 'Ativo', tipo: 'ativo' },
      });
      expect(escritaAlheia.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAlheia.json()).erro).toMatch(/acesso negado/i);
      const negadaAlheia = eventosDe(t, 'escopo.tentativa_negada').at(-1);
      expect(negadaAlheia?.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
      expect(contasNoBanco(t)).toHaveLength(0);

      // sem sessão: negado (CA-18)
      const semSessao = await t.app.inject({
        method: 'POST',
        url: '/contas',
        payload: { empresa_id: x.id, codigo: '1', descricao: 'Ativo', tipo: 'ativo' },
      });
      expect(semSessao.statusCode).toBe(401);

      // contador atribuído: escrita funciona (controle positivo)
      const escritaOk = await t.app.inject({
        method: 'POST',
        url: '/contas',
        headers: { cookie: cookieAtribuido },
        payload: { empresa_id: x.id, codigo: '1', descricao: 'Ativo', tipo: 'ativo' },
      });
      expect(escritaOk.statusCode).toBe(201);

      // admin LÊ o plano de X sem atribuição — leitura global auditada (F13/CA-34)
      const leituraAdmin = await t.app.inject({
        method: 'GET',
        url: `/contas?empresa_id=${x.id}`,
        headers: { cookie: cookieAdmin },
      });
      expect(leituraAdmin.statusCode).toBe(200);
      expect(listaContasResponseSchema.parse(leituraAdmin.json()).contas).toHaveLength(1);
      const global = eventosDe(t, 'escopo.leitura_global').at(-1);
      expect(global?.usuarioId).toBe(admin.id);
      expect(global?.empresaId).toBe(x.id);
    } finally {
      await t.close();
    }
  });
});

describe('períodos contábeis mensais (RF-09, base de CA-24/CA-31)', () => {
  test('RF-09 períodos são únicos por (empresa, ano, mês), nascem abertos e a auditoria registra a criação', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const y = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa Y' });
      const contador = await criarUsuarioTeste(t.database.db, {
        papel: 'contador',
        empresas: [x.id, y.id],
      });
      const { cookie } = await fazerLogin(t.app, contador.email);
      const totalAntes = periodosNoBanco(t).length;

      // criação válida pelo contador atribuído: nasce aberto
      const ok = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie },
        payload: { empresa_id: x.id, ano: 2026, mes: 1 },
      });
      expect(ok.statusCode).toBe(201);
      const periodo = periodoContabilSchema.parse(ok.json());
      expect(periodo.situacao).toBe('aberto');
      expect(periodo.encerrado_em).toBeNull();

      // duplicado exato: 409 com mensagem específica e nada persistido
      const duplicado = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie },
        payload: { empresa_id: x.id, ano: 2026, mes: 1 },
      });
      expect(duplicado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(duplicado.json()).erro).toMatch(/já existe/i);

      // o MESMO (ano, mês) em outra empresa é aceito (único por empresa)
      const emY = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie },
        payload: { empresa_id: y.id, ano: 2026, mes: 1 },
      });
      expect(emY.statusCode).toBe(201);

      // mês/ano inválidos: recusa com mensagem específica
      const mesInvalido = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie },
        payload: { empresa_id: x.id, ano: 2026, mes: 13 },
      });
      expect(mesInvalido.statusCode).toBe(400);
      expect(erroResponseSchema.parse(mesInvalido.json()).erro).toMatch(/mês/i);
      const anoInvalido = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie },
        payload: { empresa_id: x.id, ano: 0, mes: 2 },
      });
      expect(anoInvalido.statusCode).toBe(400);
      expect(erroResponseSchema.parse(anoInvalido.json()).erro).toMatch(/ano/i);

      // nada persistido pelas recusas: apenas os dois criações válidas
      expect(periodosNoBanco(t)).toHaveLength(totalAntes + 2);

      // estado aberto/encerrado vem do campo de encerramento (ações: T015)
      criarPeriodoTeste(t.database.db, {
        empresaId: x.id,
        ano: 2025,
        mes: 12,
        encerradoEm: '2026-01-05T12:00:00.000Z',
      });
      const listagem = await t.app.inject({
        method: 'GET',
        url: `/periodos?empresa_id=${x.id}`,
        headers: { cookie },
      });
      expect(listagem.statusCode).toBe(200);
      const corpo = listaPeriodosResponseSchema.parse(listagem.json());
      const encerrado = corpo.periodos.find((item) => item.ano === 2025);
      expect(encerrado?.situacao).toBe('encerrado');
      expect(encerrado?.encerrado_em).toBe('2026-01-05T12:00:00.000Z');
      const aberto = corpo.periodos.find((item) => item.ano === 2026);
      expect(aberto?.situacao).toBe('aberto');

      // auditoria registra a criação (RF-05)
      const criacoes = eventosDe(t, 'periodo.criacao');
      expect(criacoes.length).toBeGreaterThanOrEqual(2);
      expect(criacoes.at(-1)?.dados).toMatchObject({ ano: 2026, mes: 1, situacao: 'aberto' });
    } finally {
      await t.close();
    }
  });

  test('F13 períodos: admin não cria (escrita contábil exclusiva do contador atribuído); contador de outra empresa é recusado auditado', async () => {
    const t = await createTestApp();
    try {
      const x = criarEmpresaTeste(t.database.db, { razaoSocial: 'Empresa X' });
      const admin = await criarUsuarioTeste(t.database.db, {
        papel: 'administrador',
        empresas: [x.id],
      });
      const deOutra = await criarUsuarioTeste(t.database.db, {
        email: 'contador.deoutra@escritorio.test',
        papel: 'contador',
        empresas: [],
      });
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);
      const { cookie: cookieOutra } = await fazerLogin(t.app, deOutra.email);

      const escritaAdmin = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie: cookieAdmin },
        payload: { empresa_id: x.id, ano: 2026, mes: 3 },
      });
      expect(escritaAdmin.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAdmin.json()).erro).toMatch(/escrita contábil/i);
      expect(eventosDe(t, 'escopo.tentativa_negada').at(-1)?.dados).toMatchObject({
        motivo: 'administrador_sem_escrita_contabil',
      });

      const escritaAlheia = await t.app.inject({
        method: 'POST',
        url: '/periodos',
        headers: { cookie: cookieOutra },
        payload: { empresa_id: x.id, ano: 2026, mes: 3 },
      });
      expect(escritaAlheia.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAlheia.json()).erro).toMatch(/acesso negado/i);
      expect(eventosDe(t, 'escopo.tentativa_negada').at(-1)?.dados).toMatchObject({
        motivo: 'empresa_nao_atribuida',
      });

      // nada persistido pelas duas recusas
      expect(periodosNoBanco(t)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});
