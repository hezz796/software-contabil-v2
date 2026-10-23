import {
  apuracaoDasSchema,
  baixaSchema,
  erroResponseSchema,
  listaTabelasImpostoResponseSchema,
  previaApuracaoDasSchema,
  razaoResponseSchema,
  regimeFiscalEmpresaSchema,
  tabelaImpostoSchema,
} from '@sistema-contabil/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { buildApp } from '../../src/app.ts';
import {
  apuracaoDas,
  auditEvent,
  baixa as baixaTabela,
  empresa as empresaTabela,
  lancamento,
  partida,
  tabelaImposto,
  titulo as tituloTabela,
  tituloTabelaImposto,
  type Conta,
  type Empresa,
} from '../../src/db/schema.ts';
import { criarContaTeste, criarPeriodoTeste } from '../fixtures/contas.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarUsuarioTeste, fazerLogin, type UsuarioTeste } from '../fixtures/seguranca.ts';
import { criarTituloTeste } from '../fixtures/titulos.ts';
import { createTestDatabase, type TestApp } from '../harness.ts';

/**
 * Fiscal configurável (RF-20..23, H17/H18, CA-45..49/54; TASK-017).
 *
 * Um teste por critério de aceite. Regras de evidência (AGENTS.md):
 * - testes negativos têm dado REAL (título/tabela/config gravados pelo caminho
 *   de produção) e o "controle" aceito logo em seguida;
 * - recusas verificadas pelo código específico (não "qualquer erro");
 * - estado conferido DEPOIS (nada persistido na recusa).
 *
 * Permissões (T017-F-2): configuração fiscal = admin ou contador atribuído
 * (CA-54); geração do DAS e associação tabela↔título = escrita contábil
 * (admin recusado auditado).
 */

interface Cenario {
  t: TestApp;
  empresa: Empresa;
  contador: UsuarioTeste;
  cookie: string;
  /** Passivo: conta do título a pagar. */
  fornecedores: Conta;
  /** Ativo: contrapartida (caixa/banco) das baixas. */
  caixa: Conta;
  /** Passivo: "impostos/retenções a recolher" (tabela de retenção). */
  retencao: Conta;
  /** Despesa: multa e juros de atraso (config de encargos). */
  encargos: Conta;
  /** Receita: base do DAS (H17). */
  receitas: Conta;
  /** Despesa debitada na apuração do DAS. */
  dasDespesa: Conta;
  /** Passivo creditado na apuração do DAS ("a recolher"). */
  dasPassivo: Conta;
}

async function prepararCenario(razaoSocial: string): Promise<Cenario> {
  const database = createTestDatabase();
  const app = await buildApp({ db: database.db, logger: false });
  const t: TestApp = {
    app,
    database,
    async close(): Promise<void> {
      try {
        await app.close();
      } finally {
        database.destroy();
      }
    },
  };
  const empresa = criarEmpresaTeste(t.database.db, { razaoSocial });
  const contador = await criarUsuarioTeste(t.database.db, {
    papel: 'contador',
    empresas: [empresa.id],
  });
  const { cookie } = await fazerLogin(t.app, contador.email);

  const fornecedores = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '2.1.1',
    descricao: 'Fornecedores',
    tipo: 'passivo',
  });
  const caixa = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '1.1.1',
    descricao: 'Caixa',
    tipo: 'ativo',
  });
  const retencao = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '2.1.2',
    descricao: 'Impostos a recolher',
    tipo: 'passivo',
  });
  const encargos = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '3.1.1',
    descricao: 'Multa e juros',
    tipo: 'despesa',
  });
  const receitas = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '4.1.1',
    descricao: 'Receita operacional',
    tipo: 'receita',
  });
  const dasDespesa = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '3.2.1',
    descricao: 'DAS a recolher (despesa)',
    tipo: 'despesa',
  });
  const dasPassivo = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '2.2.1',
    descricao: 'DAS a recolher (passivo)',
    tipo: 'passivo',
  });

  // Período único usado por todos os cenários (baixas, receita e DAS).
  criarPeriodoTeste(t.database.db, { empresaId: empresa.id, ano: 2026, mes: 5 });

  return {
    t,
    empresa,
    contador,
    cookie,
    fornecedores,
    caixa,
    retencao,
    encargos,
    receitas,
    dasDespesa,
    dasPassivo,
  };
}

/* ------------------------------- HTTP helpers ------------------------------ */

function postTabela(c: Cenario, payload: Record<string, unknown>, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'POST',
    url: '/fiscal/tabelas-imposto',
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function patchTabela(
  c: Cenario,
  tabelaId: number,
  payload: Record<string, unknown>,
  cookie = c.cookie,
) {
  return c.t.app.inject({
    method: 'PATCH',
    url: `/fiscal/tabelas-imposto/${tabelaId}?empresa_id=${c.empresa.id}`,
    headers: { cookie },
    payload,
  });
}

function getTabelas(c: Cenario, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/fiscal/tabelas-imposto?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function postAssociacao(c: Cenario, tituloId: number, tabelaId: number, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'POST',
    url: `/titulos/${tituloId}/tabelas-imposto`,
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, tabela_imposto_id: tabelaId },
  });
}

function postMultaJuros(c: Cenario, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: '/fiscal/multa-juros',
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postRegime(c: Cenario, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: '/fiscal/regime',
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function getPreviaDas(c: Cenario, ano: number, mes: number, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/fiscal/apuracao-das?empresa_id=${c.empresa.id}&ano=${ano}&mes=${mes}`,
    headers: { cookie },
  });
}

function postGerarDas(c: Cenario, payload: Record<string, unknown>, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'POST',
    url: '/fiscal/apuracoes-das',
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postBaixa(c: Cenario, tituloId: number, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: `/titulos/${tituloId}/baixas`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postEstornoBaixa(c: Cenario, baixaId: number, data = '2026-05-20') {
  return c.t.app.inject({
    method: 'POST',
    url: `/baixas/${baixaId}/estorno`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, data },
  });
}

function postEstornoLancamentoDireto(c: Cenario, lancamentoId: number) {
  return c.t.app.inject({
    method: 'POST',
    url: `/lancamentos/${lancamentoId}/estorno`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id },
  });
}

function postLancamentoReceita(c: Cenario, centavos: number, data: string) {
  return c.t.app.inject({
    method: 'POST',
    url: '/lancamentos',
    headers: { cookie: c.cookie },
    payload: {
      empresa_id: c.empresa.id,
      data,
      historico: 'Receita do período (base do DAS)',
      partidas: [
        { conta_id: c.caixa.id, natureza: 'D', valor_centavos: centavos },
        { conta_id: c.receitas.id, natureza: 'C', valor_centavos: centavos },
      ],
    },
  });
}

function getRazao(c: Cenario, contaId: number) {
  return c.t.app.inject({
    method: 'GET',
    url: `/relatorios/razao?empresa_id=${c.empresa.id}&conta_id=${contaId}`,
    headers: { cookie: c.cookie },
  });
}

/* ------------------------------ DB helpers --------------------------------- */

function eventosDe(c: Cenario, acao: string) {
  return c.t.database.db.select().from(auditEvent).all().filter((e) => e.acao === acao);
}

function partidasDoLancamentoNoBanco(c: Cenario, lancamentoId: number) {
  return c.t.database.db
    .select()
    .from(partida)
    .all()
    .filter((p) => p.lancamentoId === lancamentoId);
}

function apuracoesNoBanco(c: Cenario) {
  return c.t.database.db.select().from(apuracaoDas).all();
}

function lancamentosNoBanco(c: Cenario) {
  return c.t.database.db.select().from(lancamento).all();
}

/* --------------------------------- CA-45 ----------------------------------- */

describe('CA-45 tabela de imposto: nome + alíquota não negativa', () => {
  test('CA-45 cria tabela com alíquota 4% (400 centésimos); negativa e não numéricas recusadas com mensagem', async () => {
    const c = await prepararCenario('CA-45 Tabela');
    try {
      // Criação aceita (alíquota 4% = 400 centésimos de percentual).
      const criada = await postTabela(c, { nome: 'IRRF 4%', aliquota_centavos: 400 });
      expect(criada.statusCode).toBe(201);
      const dto = tabelaImpostoSchema.parse(criada.json());
      expect(dto).toMatchObject({
        empresa_id: c.empresa.id,
        nome: 'IRRF 4%',
        aliquota_centavos: 400,
        conta_retencao_id: null,
        ativa: true,
      });

      // Alíquota NEGATIVA: recusada com mensagem (não 500 genérico).
      const negativa = await postTabela(c, { nome: 'Inválida', aliquota_centavos: -100 });
      expect(negativa.statusCode).toBe(400);
      expect(erroResponseSchema.parse(negativa.json()).erro).toMatch(
        /não negativo/i,
      );

      // Alíquota NÃO NUMÉRICA: recusada com mensagem.
      const naoNumerica = await postTabela(c, { nome: 'Texto', aliquota_centavos: 'quatro' });
      expect(naoNumerica.statusCode).toBe(400);
      expect(erroResponseSchema.parse(naoNumerica.json()).erro).toMatch(/centésimos|número/i);

      // Estado: só a válida persistida; criação auditada (trilha).
      const listadas = listaTabelasImpostoResponseSchema.parse((await getTabelas(c)).json());
      expect(listadas.tabelas).toHaveLength(1);
      expect(listadas.tabelas[0]!.id).toBe(dto.id);
      expect(eventosDe(c, 'fiscal.tabela_imposto_criacao')).toHaveLength(1);
      expect(eventosDe(c, 'fiscal.tabela_imposto_criacao')[0]!.dados).toMatchObject({
        aliquota_centavos: 400,
      });
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------------------- CA-54 ----------------------------------- */

describe('CA-54 configuração fiscal auditada (admin x contador atribuído)', () => {
  test('CA-54a contador NÃO atribuído é recusado auditado na configuração fiscal', async () => {
    const c = await prepararCenario('CA-54a');
    try {
      const outra = criarEmpresaTeste(c.t.database.db, { razaoSocial: 'Empresa Alheia' });
      const fora = await criarUsuarioTeste(c.t.database.db, {
        papel: 'contador',
        empresas: [outra.id],
        email: 'contador-alheio@escritorio.test',
      });
      const { cookie } = await fazerLogin(c.t.app, fora.email);

      const recusado = await postTabela(
        c,
        { nome: 'Tentativa cruzada', aliquota_centavos: 400 },
        cookie,
      );
      expect(recusado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(recusado.json()).erro).toMatch(/acesso negado/i);

      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(fora.id);
      expect(negada.empresaId).toBe(c.empresa.id);
      expect(negada.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });

      // Nada persistido na empresa alvo.
      expect(c.t.database.db.select().from(tabelaImposto).all()).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('CA-54b admin ALTERA alíquota com sucesso e a ação é auditada com antigo/novo', async () => {
    const c = await prepararCenario('CA-54b');
    try {
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        empresas: [c.empresa.id],
        email: 'admin-fiscal@escritorio.test',
      });
      const { cookie } = await fazerLogin(c.t.app, admin.email);

      const criada = tabelaImpostoSchema.parse((await postTabela(c, { nome: 'ISS', aliquota_centavos: 400 })).json());

      // Admin pode configuração fiscal (CA-54: não é escrita contábil).
      const alterada = await patchTabela(c, criada.id, { aliquota_centavos: 500 }, cookie);
      expect(alterada.statusCode).toBe(200);
      const dto = tabelaImpostoSchema.parse(alterada.json());
      expect(dto.aliquota_centavos).toBe(500);

      // Auditada com valores antigo/novo.
      const alteracao = eventosDe(c, 'fiscal.tabela_imposto_alteracao').at(-1)!;
      expect(alteracao.usuarioId).toBe(admin.id);
      expect(alteracao.dados).toMatchObject({
        antes: { aliquota_centavos: 400 },
        depois: { aliquota_centavos: 500 },
      });

      // E o contador atribuído VÊ a tabela com a alíquota nova (CA-54b: o
      // valor novo vale para as operações seguintes).
      const listadas = listaTabelasImpostoResponseSchema.parse((await getTabelas(c)).json());
      expect(listadas.tabelas[0]!.aliquota_centavos).toBe(500);
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------- FIX-T017-A2: admin 404 auditado ---------------------- */

describe('FIX-T017-A2 admin: empresa inexistente na configuração fiscal é recusa auditada', () => {
  test('FIX-T017-A2 admin POST /fiscal/tabelas-imposto com empresa_id inexistente: 404 + escopo.tentativa_negada motivo empresa_inexistente; nada gravado (controle com empresa real passa)', async () => {
    const c = await prepararCenario('FIX-T017-A2');
    try {
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        empresas: [c.empresa.id],
        email: 'admin-a2@escritorio.test',
      });
      const { cookie } = await fazerLogin(c.t.app, admin.email);

      // Pré-condição REAL: a empresa 999999 não existe no banco (regra 2).
      expect(
        c.t.database.db.select().from(empresaTabela).where(eq(empresaTabela.id, 999999)).all(),
      ).toHaveLength(0);

      // Sondagem de empresa_id inexistente por admin na rota de config fiscal.
      const recusado = await c.t.app.inject({
        method: 'POST',
        url: '/fiscal/tabelas-imposto',
        headers: { cookie },
        payload: { empresa_id: 999999, nome: 'Sondagem A2', aliquota_centavos: 400 },
      });
      // (a) contrato de resposta inalterado: 404 com a mensagem esperada.
      expect(recusado.statusCode).toBe(404);
      expect(erroResponseSchema.parse(recusado.json()).erro).toBe('Empresa não encontrada.');

      // (b) a tentativa negada fica na trilha (RF-05/CE-15).
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1);
      expect(negada).toBeDefined();
      expect(negada!.usuarioId).toBe(admin.id);
      expect(negada!.empresaId).toBe(999999);
      expect(negada!.dados).toMatchObject({ motivo: 'empresa_inexistente' });

      // Estado depois: nada persistido pela tentativa.
      expect(c.t.database.db.select().from(tabelaImposto).all()).toHaveLength(0);

      // Controle: o mesmo admin cria tabela na empresa REAL (201).
      const aceita = await postTabela(c, { nome: 'Controle A2', aliquota_centavos: 400 }, cookie);
      expect(aceita.statusCode).toBe(201);
      expect(c.t.database.db.select().from(tabelaImposto).all()).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });
});

/* ------------------------- T017-F-2: 403 auditados -------------------------- */

describe('T017-F-2 associação e DAS exigem escrita contábil (admin recusado auditado)', () => {
  test('T017-F-2 associação tabela↔título: admin recusado 403 auditado; contador atribuído grava (controle)', async () => {
    const c = await prepararCenario('T017-F-2 assoc');
    try {
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        empresas: [c.empresa.id],
        email: 'admin-fiscal@escritorio.test',
      });
      const { cookie: cookieAdmin } = await fazerLogin(c.t.app, admin.email);
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
      });
      const tabela = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'IRRF 5%', aliquota_centavos: 500, conta_retencao_id: c.retencao.id })).json(),
      );

      const recusada = await postAssociacao(c, titulo.id, tabela.id, cookieAdmin);
      expect(recusada.statusCode).toBe(403);
      const negado = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negado.usuarioId).toBe(admin.id);
      expect(negado.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });
      // Nada persistido.
      expect(c.t.database.db.select().from(tituloTabelaImposto).all()).toHaveLength(0);

      // Controle: contador atribuído associa com sucesso.
      const aceita = await postAssociacao(c, titulo.id, tabela.id);
      expect(aceita.statusCode).toBe(201);
      expect(c.t.database.db.select().from(tituloTabelaImposto).all()).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('T017-F-2 geração do DAS: admin recusado 403 auditado; contador atribuído gera (controle)', async () => {
    const c = await prepararCenario('T017-F-2 DAS');
    try {
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        empresas: [c.empresa.id],
        email: 'admin-fiscal@escritorio.test',
      });
      const { cookie: cookieAdmin } = await fazerLogin(c.t.app, admin.email);
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);
      await postRegime(c, {
        aliquota_centavos: 600,
        conta_das_despesa_id: c.dasDespesa.id,
        conta_das_passivo_id: c.dasPassivo.id,
      });

      const recusado = await postGerarDas(c, { ano: 2026, mes: 5 }, cookieAdmin);
      expect(recusado.statusCode).toBe(403);
      const negado = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negado.usuarioId).toBe(admin.id);
      expect(negado.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });
      // NADA gerado pela tentativa do admin.
      expect(apuracoesNoBanco(c)).toHaveLength(0);

      // Controle: contador atribuído gera.
      const gerado = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(gerado.statusCode).toBe(201);
      expect(apuracoesNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------------------- CA-47 ----------------------------------- */

describe('CA-47 retenção na fonte na baixa (RF-22)', () => {
  test('CA-47 R$ 1.000,00 com tabela 5%: líquido 950,00 no caixa, retenção 50,00 em lançamento SEPARADO, título pago', async () => {
    const c = await prepararCenario('CA-47 Retenção');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000, // R$ 1.000,00
        vencimento: '2026-05-10',
      });
      const tabela = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'IRRF 5%', aliquota_centavos: 500, conta_retencao_id: c.retencao.id })).json(),
      );
      expect((await postAssociacao(c, titulo.id, tabela.id)).statusCode).toBe(201);

      // Baixa NO vencimento (sem encargos — foco na retenção).
      const resposta = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(resposta.statusCode).toBe(201);
      const baixa = baixaSchema.parse(resposta.json());
      expect(baixa).toMatchObject({
        titulo_id: titulo.id,
        valor_centavos: 100_000, // bruto abatido do saldo (D1)
        retencao_centavos: 5_000, // R$ 50,00
        multa_centavos: 0,
        juros_centavos: 0,
        encargos_centavos: 0,
      });
      // Retenção tem lançamento PRÓPRIO vinculado (RF-22).
      expect(baixa.retencao_lancamento_id).not.toBeNull();

      // Lançamento de PAGAMENTO: líquido 950,00 — D Fornecedores / C Caixa.
      const partidasPagamento = partidasDoLancamentoNoBanco(c, baixa.lancamento_id);
      expect(partidasPagamento).toHaveLength(2);
      expect(partidasPagamento).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 95_000 }),
      );
      expect(partidasPagamento).toContainEqual(
        expect.objectContaining({ contaId: c.caixa.id, natureza: 'C', valorCentavos: 95_000 }),
      );

      // Lançamento de RETENÇÃO: D Fornecedores / C Impostos a recolher — 50,00.
      const partidasRetencao = partidasDoLancamentoNoBanco(c, baixa.retencao_lancamento_id!);
      expect(partidasRetencao).toHaveLength(2);
      expect(partidasRetencao).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 5_000 }),
      );
      expect(partidasRetencao).toContainEqual(
        expect.objectContaining({ contaId: c.retencao.id, natureza: 'C', valorCentavos: 5_000 }),
      );

      // Pagamento e retenção são lançamentos DISTINTOS.
      expect(baixa.retencao_lancamento_id).not.toBe(baixa.lancamento_id);

      // Título pago (bruto todo abatido: líquido + retenção).
      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('pago');
      expect(linhaTitulo.saldoCentavos).toBe(0);

      // Trilha: criação do lançamento de retenção auditada com origem.
      const criacaoRetencao = eventosDe(c, 'lancamento.criacao').find(
        (e) => (e.dados as { origem?: string }).origem === 'retencao_baixa',
      );
      expect(criacaoRetencao).toBeDefined();
      expect(criacaoRetencao!.dados).toMatchObject({ retencao_centavos: 5_000 });
    } finally {
      await c.t.close();
    }
  });

  test('CA-47 estorno da baixa com retenção desfaz OS DOIS lançamentos; estorno direto deles é recusado', async () => {
    const c = await prepararCenario('CA-47 estorno');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000,
        vencimento: '2026-05-10',
      });
      const tabela = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'IRRF 5%', aliquota_centavos: 500, conta_retencao_id: c.retencao.id })).json(),
      );
      expect((await postAssociacao(c, titulo.id, tabela.id)).statusCode).toBe(201);
      const baixa = baixaSchema.parse(
        (
          await postBaixa(c, titulo.id, {
            data: '2026-05-10',
            valor_centavos: 100_000,
            conta_contrapartida_id: c.caixa.id,
          })
        ).json(),
      );

      const estorno = await postEstornoBaixa(c, baixa.id);
      expect(estorno.statusCode).toBe(201);

      // Estorno do PAGAMENTO e estorno da RETENÇÃO, ambos vinculados aos originais.
      const lancamentos = lancamentosNoBanco(c);
      const estornoPagamento = lancamentos.find((l) => l.estornoDeId === baixa.lancamento_id);
      const estornoRetencao = lancamentos.find((l) => l.estornoDeId === baixa.retencao_lancamento_id);
      expect(estornoPagamento).toBeDefined();
      expect(estornoRetencao).toBeDefined();

      // Trilha do estorno de baixa registra os dois.
      const evento = eventosDe(c, 'titulo.estorno_baixa').at(-1)!;
      expect(evento.dados).toMatchObject({
        estorno_lancamento_id: estornoPagamento!.id,
        retencao_lancamento_id: baixa.retencao_lancamento_id,
        estorno_retencao_lancamento_id: estornoRetencao!.id,
      });

      // Título reaberto integralmente.
      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('aberto');
      expect(linhaTitulo.saldoCentavos).toBe(100_000);

      // Estorno DIRETO do lançamento de retenção: recusado (é de baixa).
      const diretoRetencao = await postEstornoLancamentoDireto(c, baixa.retencao_lancamento_id!);
      expect(diretoRetencao.statusCode).toBe(409);
      expect(erroResponseSchema.parse(diretoRetencao.json()).erro).toMatch(/gerado por uma baixa/i);

      // Estorno DIRETO do estorno da retenção: também recusado.
      const diretoEstorno = await postEstornoLancamentoDireto(c, estornoRetencao!.id);
      expect(diretoEstorno.statusCode).toBe(409);
      expect(erroResponseSchema.parse(diretoEstorno.json()).erro).toMatch(/gerado por uma baixa/i);
    } finally {
      await c.t.close();
    }
  });

  test('recusa (sem número de CA): retenção total cobre o bruto → 400 auditado, nada gravado; alíquota reduzida passa (controle)', async () => {
    const c = await prepararCenario('CA-47 recusa total');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000,
        vencimento: '2026-05-10',
      });
      // Tabela de 100% (alíquota máxima saneada pelo schema: >= 0).
      const tabela = tabelaImpostoSchema.parse(
        (
          await postTabela(c, { nome: 'Retenção total', aliquota_centavos: 10_000, conta_retencao_id: c.retencao.id })
        ).json(),
      );
      expect((await postAssociacao(c, titulo.id, tabela.id)).statusCode).toBe(201);

      const recusa = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(recusa.statusCode).toBe(400);
      expect(erroResponseSchema.parse(recusa.json()).erro).toMatch(/não sobra valor líquido/i);

      // Motivo específico auditado; NADA gravado (sem baixa, sem lançamento).
      const recusada = eventosDe(c, 'titulo.baixa_recusada').at(-1)!;
      expect(recusada.dados).toMatchObject({ motivo: 'retencao_total_sem_liquido' });
      expect(c.t.database.db.select().from(baixaTabela).all()).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // Controle com dado REAL: reduz a alíquota para 5% (CA-54b) e a baixa passa.
      expect((await patchTabela(c, tabela.id, { aliquota_centavos: 500 })).statusCode).toBe(200);
      const aceita = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(aceita.statusCode).toBe(201);
      expect(baixaSchema.parse(aceita.json()).retencao_centavos).toBe(5_000);
    } finally {
      await c.t.close();
    }
  });

  test('recusa (sem número de CA): associação com tabela SEM conta de retenção → 409 auditado; com a conta passa (controle)', async () => {
    const c = await prepararCenario('CA-47 sem conta');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
      });
      // Tabela criada SEM conta de retenção (CA-45 permite; associação exige — H19).
      const tabela = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'Sem conta', aliquota_centavos: 500 })).json(),
      );

      const recusa = await postAssociacao(c, titulo.id, tabela.id);
      expect(recusa.statusCode).toBe(409);
      expect(erroResponseSchema.parse(recusa.json()).erro).toMatch(/conta de retenção/i);
      const recusado = eventosDe(c, 'fiscal.tabela_associacao_recusada').at(-1)!;
      expect(recusado.dados).toMatchObject({ motivo: 'tabela_sem_conta_retencao' });
      expect(c.t.database.db.select().from(tituloTabelaImposto).all()).toHaveLength(0);

      // Controle: configurar a conta (CA-54b) e associar.
      expect(
        (await patchTabela(c, tabela.id, { conta_retencao_id: c.retencao.id })).statusCode,
      ).toBe(200);
      expect((await postAssociacao(c, titulo.id, tabela.id)).statusCode).toBe(201);
      expect(c.t.database.db.select().from(tituloTabelaImposto).all()).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-47 tabela de 0% junto com tabela de 5%: só a 5% gera partidas — baixa 201 e nenhuma partida de valor zero', async () => {
    const c = await prepararCenario('CA-47 alíquota zero mista');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000, // R$ 1.000,00
        vencimento: '2026-05-10',
      });
      // Dado REAL de pré-condição (regra 2): tabela de 0% é LEGÍTIMA (a criação
      // aceita e o unitário "alíquota zero: retenção zero" a cobre). Duas
      // tabelas associadas, uma delas computando zero.
      const tabelaZero = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'ISS 0%', aliquota_centavos: 0, conta_retencao_id: c.retencao.id })).json(),
      );
      const tabelaCinco = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'IRRF 5%', aliquota_centavos: 500, conta_retencao_id: c.retencao.id })).json(),
      );
      expect((await postAssociacao(c, titulo.id, tabelaZero.id)).statusCode).toBe(201);
      expect((await postAssociacao(c, titulo.id, tabelaCinco.id)).statusCode).toBe(201);

      const resposta = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(resposta.statusCode).toBe(201);
      const baixa = baixaSchema.parse(resposta.json());
      expect(baixa).toMatchObject({
        valor_centavos: 100_000,
        retencao_centavos: 5_000, // R$ 50,00 — só a tabela de 5% reteve
        multa_centavos: 0,
        juros_centavos: 0,
        encargos_centavos: 0,
      });
      expect(baixa.retencao_lancamento_id).not.toBeNull();

      // Lançamento de retenção: EXATAMENTE 2 partidas (as da tabela de 5%).
      const partidasRetencao = partidasDoLancamentoNoBanco(c, baixa.retencao_lancamento_id!);
      expect(partidasRetencao).toHaveLength(2);
      expect(partidasRetencao).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 5_000 }),
      );
      expect(partidasRetencao).toContainEqual(
        expect.objectContaining({ contaId: c.retencao.id, natureza: 'C', valorCentavos: 5_000 }),
      );

      // Estado conferido DEPOIS: nenhuma partida de valor zero em lugar nenhum
      // (a tabela de 0% não pode virar partida — o CHECK
      // `partida_valor_positivo` abortaria a transação inteira).
      const partidasComValorZero = c.t.database.db
        .select()
        .from(partida)
        .all()
        .filter((p) => p.valorCentavos <= 0);
      expect(partidasComValorZero).toHaveLength(0);

      // Pagamento: líquido 950,00 (bruto − retenção) e título pago.
      const partidasPagamento = partidasDoLancamentoNoBanco(c, baixa.lancamento_id);
      expect(partidasPagamento).toContainEqual(
        expect.objectContaining({ contaId: c.caixa.id, natureza: 'C', valorCentavos: 95_000 }),
      );
      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('pago');
      expect(linhaTitulo.saldoCentavos).toBe(0);
    } finally {
      await c.t.close();
    }
  });

  test('CA-47 só tabela de 0% associada: baixa 201 sem lançamento de retenção e líquido igual ao bruto', async () => {
    const c = await prepararCenario('CA-47 alíquota zero única');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000,
        vencimento: '2026-05-10',
      });
      const tabela = tabelaImpostoSchema.parse(
        (await postTabela(c, { nome: 'ISS 0% (única)', aliquota_centavos: 0, conta_retencao_id: c.retencao.id })).json(),
      );
      expect((await postAssociacao(c, titulo.id, tabela.id)).statusCode).toBe(201);

      const resposta = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(resposta.statusCode).toBe(201);
      const baixa = baixaSchema.parse(resposta.json());
      // Regressão do guard total: retenção 0 → nenhum lançamento de retenção.
      expect(baixa).toMatchObject({
        valor_centavos: 100_000,
        retencao_centavos: 0,
        retencao_lancamento_id: null,
      });

      // SÓ o lançamento de pagamento existe, com líquido igual ao bruto.
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      const partidasPagamento = partidasDoLancamentoNoBanco(c, baixa.lancamento_id);
      expect(partidasPagamento).toHaveLength(2);
      expect(partidasPagamento).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 100_000 }),
      );
      expect(partidasPagamento).toContainEqual(
        expect.objectContaining({ contaId: c.caixa.id, natureza: 'C', valorCentavos: 100_000 }),
      );
      expect(
        c.t.database.db.select().from(partida).all().filter((p) => p.valorCentavos <= 0),
      ).toHaveLength(0);

      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('pago');
      expect(linhaTitulo.saldoCentavos).toBe(0);
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------------------- CA-48 ----------------------------------- */

describe('CA-48 multa e juros de atraso na baixa (RF-23, H18)', () => {
  test('CA-48 vencido 30 dias, multa 2% + juros 1% a.m.: 20,00 + 10,00; lançamento soma 1.030,00; título pago', async () => {
    const c = await prepararCenario('CA-48 Encargos');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000, // R$ 1.000,00
        vencimento: '2026-04-30',
      });
      // Padrão da empresa: multa 2% + juros 1% a.m., com conta de encargos.
      const config = await postMultaJuros(c, {
        multa_centavos: 200,
        juros_mensal_centavos: 100,
        conta_encargos_id: c.encargos.id,
      });
      expect(config.statusCode).toBe(200);

      // Baixa 30 dias após o vencimento (2026-04-30 → 2026-05-30).
      const resposta = await postBaixa(c, titulo.id, {
        data: '2026-05-30',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(resposta.statusCode).toBe(201);
      const baixa = baixaSchema.parse(resposta.json());
      expect(baixa).toMatchObject({
        valor_centavos: 100_000,
        multa_centavos: 2_000, // R$ 20,00
        juros_centavos: 1_000, // R$ 10,00 (1% a.m. ÷ 30 × 30 dias = 1% exato)
        encargos_centavos: 3_000, // multa + juros (CHECK do banco)
        retencao_centavos: 0,
        retencao_lancamento_id: null, // sem tabela associada → sem lançamento próprio
      });

      // Lançamento vinculado soma 1.030,00 (bruto + encargos = caixa).
      const partidas = partidasDoLancamentoNoBanco(c, baixa.lancamento_id);
      expect(partidas).toHaveLength(3);
      const somaDebitos = partidas
        .filter((p) => p.natureza === 'D')
        .reduce((total, p) => total + p.valorCentavos, 0);
      expect(somaDebitos).toBe(103_000); // R$ 1.030,00
      expect(partidas).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 100_000 }),
      );
      expect(partidas).toContainEqual(
        expect.objectContaining({ contaId: c.encargos.id, natureza: 'D', valorCentavos: 3_000 }),
      );
      expect(partidas).toContainEqual(
        expect.objectContaining({ contaId: c.caixa.id, natureza: 'C', valorCentavos: 103_000 }),
      );

      // Título pago.
      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('pago');
      expect(linhaTitulo.saldoCentavos).toBe(0);
    } finally {
      await c.t.close();
    }
  });

  test('recusa (sem número de CA): encargos sem conta de encargos → 409 auditado; com a conta passa (controle)', async () => {
    const c = await prepararCenario('CA-48 sem conta');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000,
        vencimento: '2026-04-30',
      });
      // Config SEM conta de encargos.
      const config = await postMultaJuros(c, { multa_centavos: 200, juros_mensal_centavos: 100 });
      expect(config.statusCode).toBe(200);

      const recusa = await postBaixa(c, titulo.id, {
        data: '2026-05-30',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(recusa.statusCode).toBe(409);
      expect(erroResponseSchema.parse(recusa.json()).erro).toMatch(/conta de encargos/i);
      const recusada = eventosDe(c, 'titulo.baixa_recusada').at(-1)!;
      expect(recusada.dados).toMatchObject({ motivo: 'config_multa_juros_sem_conta_encargos' });
      // Nada gravado.
      expect(c.t.database.db.select().from(baixaTabela).all()).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // Controle: mesma config recebe a conta (upsert) e a baixa passa.
      expect((await postMultaJuros(c, { conta_encargos_id: c.encargos.id })).statusCode).toBe(200);
      const aceita = await postBaixa(c, titulo.id, {
        data: '2026-05-30',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(aceita.statusCode).toBe(201);
      expect(baixaSchema.parse(aceita.json()).encargos_centavos).toBe(3_000);
    } finally {
      await c.t.close();
    }
  });

  test('CA-48 baixa exatamente no vencimento COM multa/juros configurados: 201, tudo zero e lançamento sem partida de encargos', async () => {
    const c = await prepararCenario('CA-48 no vencimento');
    try {
      const titulo = criarTituloTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 100_000, // R$ 1.000,00
        vencimento: '2026-05-10',
      });
      // Pré-condição REAL de dado (regra 2): a config de multa/juros EXISTE,
      // criada pelo caminho de produção, com percentuais > 0 e conta de encargos.
      const config = await postMultaJuros(c, {
        multa_centavos: 200,
        juros_mensal_centavos: 100,
        conta_encargos_id: c.encargos.id,
      });
      expect(config.statusCode).toBe(200);

      // Baixa na DATA do vencimento (CA-48: contraste com CA-06 — 0 dias).
      const resposta = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 100_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(resposta.statusCode).toBe(201);
      const baixa = baixaSchema.parse(resposta.json());
      expect(baixa).toMatchObject({
        valor_centavos: 100_000,
        multa_centavos: 0,
        juros_centavos: 0,
        encargos_centavos: 0,
        retencao_centavos: 0,
      });

      // Lançamento de pagamento SEM partida de encargos: só título + caixa.
      const partidas = partidasDoLancamentoNoBanco(c, baixa.lancamento_id);
      expect(partidas).toHaveLength(2);
      expect(partidas.filter((p) => p.contaId === c.encargos.id)).toHaveLength(0);
      expect(partidas).toContainEqual(
        expect.objectContaining({ contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 100_000 }),
      );
      expect(partidas).toContainEqual(
        expect.objectContaining({ contaId: c.caixa.id, natureza: 'C', valorCentavos: 100_000 }),
      );

      // Título pago integralmente.
      const linhaTitulo = c.t.database.db
        .select()
        .from(tituloTabela)
        .where(eq(tituloTabela.id, titulo.id))
        .all()[0]!;
      expect(linhaTitulo.situacao).toBe('pago');
      expect(linhaTitulo.saldoCentavos).toBe(0);
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------------------- CA-46 ----------------------------------- */

describe('CA-46 apuração do DAS: Simples 6% × R$ 10.000,00 = R$ 600,00 no razão', () => {
  test('CA-46 gera DAS de R$ 600,00 com lançamento vinculado visível no razão; prévia confere sem persistir', async () => {
    const c = await prepararCenario('CA-46 DAS');
    try {
      // Base do DAS (H17): receita de R$ 10.000,00 lançada no período.
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);

      const regime = await postRegime(c, {
        regime: 'simples_nacional',
        aliquota_centavos: 600, // 6%
        conta_das_despesa_id: c.dasDespesa.id,
        conta_das_passivo_id: c.dasPassivo.id,
      });
      expect(regime.statusCode).toBe(200);
      regimeFiscalEmpresaSchema.parse(regime.json());

      // Prévia (LEITURA, T017-F-2): confere o valor e NÃO persiste.
      const previa = await getPreviaDas(c, 2026, 5);
      expect(previa.statusCode).toBe(200);
      const previaDto = previaApuracaoDasSchema.parse(previa.json());
      expect(previaDto).toMatchObject({
        empresa_id: c.empresa.id,
        regime: 'simples_nacional',
        aliquota_centavos: 600,
        base_centavos: 1_000_000, // R$ 10.000,00 (H17)
        das_centavos: 60_000, // R$ 600,00
      });
      expect(apuracoesNoBanco(c)).toHaveLength(0); // prévia não persiste

      // Geração (escrita contábil do contador atribuído).
      const gerada = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(gerada.statusCode).toBe(201);
      const apuracao = apuracaoDasSchema.parse(gerada.json());
      expect(apuracao).toMatchObject({
        empresa_id: c.empresa.id,
        periodo_id: previaDto.periodo_id,
        base_centavos: 1_000_000,
        aliquota_centavos: 600,
        das_centavos: 60_000,
      });

      // RAZÃO da conta de despesa do DAS: lançamento com débito R$ 600,00.
      const razao = razaoResponseSchema.parse((await getRazao(c, c.dasDespesa.id)).json());
      const linhaDas = razao.linhas.find((l) => l.lancamento_id === apuracao.lancamento_id);
      expect(linhaDas).toBeDefined();
      expect(linhaDas!.debito_centavos).toBe(60_000);
      expect(linhaDas!.historico).toMatch(/DAS/);
      // Contrapartida = passivo "a recolher" (partida C 600,00).
      expect(linhaDas!.contrapartes).toContainEqual(
        expect.objectContaining({ conta_id: c.dasPassivo.id, natureza: 'C', valor_centavos: 60_000 }),
      );

      // Uma apuração por período (RF-21): segunda geração → 409. A mensagem
      // é honesta: estornar o lançamento NÃO libera nova apuração.
      const repetida = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(repetida.statusCode).toBe(409);
      const mensagemRepetida = erroResponseSchema.parse(repetida.json()).erro;
      expect(mensagemRepetida).toMatch(/já tem apuração de DAS válida/i);
      expect(mensagemRepetida).toMatch(/Estornar esse lançamento não libera nova apuração/i);
      expect(apuracoesNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });
});

/* --------------------------------- CA-49 ----------------------------------- */

describe('CA-49 DAS sem regime fiscal: recusado, auditado e NADA gerado', () => {
  test('CA-49 sem regime ativo a geração é recusada 409 auditada; nada é calculado nem gravado; com regime passa (controle)', async () => {
    const c = await prepararCenario('CA-49 Sem regime');
    try {
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);
      // Pré-condição de dado REAL: receita lançada no período (base existente).
      const lancamentosAntes = lancamentosNoBanco(c).length;

      // Prévia sem regime: recusa com mensagem (não calcula).
      const previa = await getPreviaDas(c, 2026, 5);
      expect(previa.statusCode).toBe(409);
      expect(erroResponseSchema.parse(previa.json()).erro).toMatch(/regime fiscal/i);

      // Geração sem regime: 409 auditado, NADA gerado.
      const geracao = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(geracao.statusCode).toBe(409);
      expect(erroResponseSchema.parse(geracao.json()).erro).toMatch(/regime fiscal/i);

      const recusa = eventosDe(c, 'fiscal.apuracao_das_recusada').at(-1)!;
      expect(recusa.usuarioId).toBe(c.contador.id);
      expect(recusa.dados).toMatchObject({ motivo: 'regime_nao_configurado', ano: 2026, mes: 5 });

      // NADA gerado: nenhuma apuração e nenhum lançamento novo (CE-19).
      expect(apuracoesNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(lancamentosAntes);
      const razao = razaoResponseSchema.parse((await getRazao(c, c.dasDespesa.id)).json());
      expect(razao.linhas).toHaveLength(0);

      // Controle: configurar o regime e gerar com sucesso (mesma base).
      expect(
        (
          await postRegime(c, {
            aliquota_centavos: 600,
            conta_das_despesa_id: c.dasDespesa.id,
            conta_das_passivo_id: c.dasPassivo.id,
          })
        ).statusCode,
      ).toBe(200);
      const gerado = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(gerado.statusCode).toBe(201);
      expect(apuracaoDasSchema.parse(gerado.json()).das_centavos).toBe(60_000);
    } finally {
      await c.t.close();
    }
  });
});

/* ----------------------- F2/F3 (FIX-T017-R1) ------------------------------- */

describe('F2 DAS de valor zero: prévia 200/0 e geração recusada auditada', () => {
  test('CE-19 mês SEM receitas (base 0): prévia 200/0; geração recusada 400 auditada das_valor_zero e NADA gravado', async () => {
    const c = await prepararCenario('F2 DAS zero sem receitas');
    try {
      // Regime ativo 6% e período SEM nenhum lançamento de receita (base 0).
      expect(
        (
          await postRegime(c, {
            aliquota_centavos: 600,
            conta_das_despesa_id: c.dasDespesa.id,
            conta_das_passivo_id: c.dasPassivo.id,
          })
        ).statusCode,
      ).toBe(200);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // Prévia: continua HONESTA (200 com 0) — mostra o valor apurado.
      const previa = await getPreviaDas(c, 2026, 5);
      expect(previa.statusCode).toBe(200);
      const previaDto = previaApuracaoDasSchema.parse(previa.json());
      expect(previaDto).toMatchObject({ base_centavos: 0, das_centavos: 0 });

      // Geração: DAS 0 não pode virar lançamento de valor zero (CA-14(b)) →
      // recusa COM mensagem e auditada, nada gravado (CE-19).
      const geracao = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(geracao.statusCode).toBe(400);
      expect(erroResponseSchema.parse(geracao.json()).erro).toMatch(/valor zero/i);
      const recusa = eventosDe(c, 'fiscal.apuracao_das_recusada').at(-1)!;
      expect(recusa.usuarioId).toBe(c.contador.id);
      expect(recusa.dados).toMatchObject({ motivo: 'das_valor_zero', ano: 2026, mes: 5 });

      // Estado conferido DEPOIS: zero apurações, zero lançamentos, razão vazio.
      expect(apuracoesNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);
      const razao = razaoResponseSchema.parse((await getRazao(c, c.dasDespesa.id)).json());
      expect(razao.linhas).toHaveLength(0);

      // Controle com dado REAL: receita lançada no mesmo período → geração passa.
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);
      const gerado = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(gerado.statusCode).toBe(201);
      expect(apuracaoDasSchema.parse(gerado.json()).das_centavos).toBe(60_000);
    } finally {
      await c.t.close();
    }
  });

  test('CE-19 alíquota 0% com base POSITIVA: prévia 200/0 expõe a base; geração recusada 400 auditada das_valor_zero', async () => {
    const c = await prepararCenario('F2 DAS zero alíquota 0');
    try {
      // Pré-condição REAL: receita lançada no período (base 10.000,00) e
      // regime vigente com alíquota 0% (o CHECK só impede alíquota negativa).
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);
      expect(
        (
          await postRegime(c, {
            aliquota_centavos: 0,
            conta_das_despesa_id: c.dasDespesa.id,
            conta_das_passivo_id: c.dasPassivo.id,
          })
        ).statusCode,
      ).toBe(200);
      const lancamentosAntes = lancamentosNoBanco(c).length;

      const previa = await getPreviaDas(c, 2026, 5);
      expect(previa.statusCode).toBe(200);
      expect(previaApuracaoDasSchema.parse(previa.json())).toMatchObject({
        base_centavos: 1_000_000,
        das_centavos: 0,
      });

      const geracao = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(geracao.statusCode).toBe(400);
      expect(erroResponseSchema.parse(geracao.json()).erro).toMatch(/valor zero/i);
      expect(eventosDe(c, 'fiscal.apuracao_das_recusada').at(-1)!.dados).toMatchObject({
        motivo: 'das_valor_zero',
      });
      expect(apuracoesNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(lancamentosAntes);
      const razao = razaoResponseSchema.parse((await getRazao(c, c.dasDespesa.id)).json());
      expect(razao.linhas).toHaveLength(0);

      // Controle: alíquota vigente sobe para 6% (upsert) e a MESMA base gera DAS.
      expect(
        (
          await postRegime(c, {
            aliquota_centavos: 600,
            conta_das_despesa_id: c.dasDespesa.id,
            conta_das_passivo_id: c.dasPassivo.id,
          })
        ).statusCode,
      ).toBe(200);
      const gerado = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(gerado.statusCode).toBe(201);
      expect(apuracaoDasSchema.parse(gerado.json()).das_centavos).toBe(60_000);
    } finally {
      await c.t.close();
    }
  });
});

describe('F3 contrato prévia × geração com base negativa', () => {
  test('prévia 200 expõe a base CRUA negativa (cliente enxerga) e a geração recusa 400 base_receitas_negativa', async () => {
    const c = await prepararCenario('F3 base negativa');
    try {
      // Dado REAL de pré-condição: receita de 10.000,00 e devolução de
      // 20.000,00 no MESMO período → base = −10.000,00 (mais débitos que
      // créditos em conta de receita).
      expect((await postLancamentoReceita(c, 1_000_000, '2026-05-05')).statusCode).toBe(201);
      const devolucao = await c.t.app.inject({
        method: 'POST',
        url: '/lancamentos',
        headers: { cookie: c.cookie },
        payload: {
          empresa_id: c.empresa.id,
          data: '2026-05-06',
          historico: 'Devolução de receita (base negativa)',
          partidas: [
            { conta_id: c.receitas.id, natureza: 'D', valor_centavos: 2_000_000 },
            { conta_id: c.caixa.id, natureza: 'C', valor_centavos: 2_000_000 },
          ],
        },
      });
      expect(devolucao.statusCode).toBe(201);
      expect(
        (
          await postRegime(c, {
            aliquota_centavos: 600,
            conta_das_despesa_id: c.dasDespesa.id,
            conta_das_passivo_id: c.dasPassivo.id,
          })
        ).statusCode,
      ).toBe(200);

      // Prévia NÃO é recusada e expõe a base crua (negativa) — é ela que
      // permite ao cliente enxergar e corrigir; o DAS segue 0 (Math.max).
      const previa = await getPreviaDas(c, 2026, 5);
      expect(previa.statusCode).toBe(200);
      expect(previaApuracaoDasSchema.parse(previa.json())).toMatchObject({
        base_centavos: -1_000_000,
        das_centavos: 0,
      });

      // Geração: recusa 400 auditada (a prévia já mostrou a causa).
      const geracao = await postGerarDas(c, { ano: 2026, mes: 5 });
      expect(geracao.statusCode).toBe(400);
      expect(erroResponseSchema.parse(geracao.json()).erro).toMatch(/negativa/i);
      expect(eventosDe(c, 'fiscal.apuracao_das_recusada').at(-1)!.dados).toMatchObject({
        motivo: 'base_receitas_negativa',
      });
      expect(apuracoesNoBanco(c)).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });
});
