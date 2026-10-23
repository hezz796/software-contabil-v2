import {
  baixaSchema,
  conciliacaoSchema,
  contaBancariaSchema,
  erroResponseSchema,
  itemExtratoSchema,
  lancamentoSchema,
  listaConciliacoesResponseSchema,
  listaItensExtratoResponseSchema,
  tituloComBaixasSchema,
  type ContaBancariaDTO,
  type ItemExtratoDTO,
  type TituloComBaixasDTO,
} from '@sistema-contabil/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  auditEvent,
  baixa as baixaTabela,
  conciliacao,
  itemExtrato,
  titulo as tituloTabela,
  type Conta,
  type Empresa,
} from '../../src/db/schema.ts';
import { buildApp } from '../../src/app.ts';
import type { AppDb } from '../../src/db/index.ts';
import { criarContaTeste, criarPeriodoTeste } from '../fixtures/contas.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestDatabase, type TestApp } from '../harness.ts';

/**
 * Conciliação bancária item a item (RF-16, CA-08/CA-28/CA-44; TASK-018).
 *
 * Um teste por critério de aceite + os extras obrigatórios do brief (dois
 * itens → mesmo objeto recusado; admin 403 auditado; contador alheio com
 * oráculo idêntico). Os itens são MANUAIS (caminho de produção do RF-16);
 * a importação de arquivo é coberta em `importacao-extrato.test.ts` (CA-53).
 *
 * Pré-condições de dado REAL em testes negativos (regra 2 do AGENTS.md): as
 * recusas acontecem sobre itens/títulos/lançamentos gravados pelo caminho de
 * produção, com controle aceito em seguida — recusa sem dado existente não
 * seria evidência.
 */

interface Cenario {
  t: TestApp;
  empresa: Empresa;
  contador: { id: number; email: string };
  cookie: string;
  /** Passivo: conta do título a pagar. */
  fornecedores: Conta;
  /** Ativo: contrapartida (caixa) dos lançamentos/baixas. */
  caixa: Conta;
  contaBancaria: ContaBancariaDTO;
}

/**
 * App + empresa + contador atribuído + contas + conta bancária (via API).
 * `envolverDb` (opcional) troca a conexão exposta às rotas — usado pelos
 * testes de corrida para tornar a janela leitura→escrita determinística
 * (ver `dbComJanelaDeCorrida`). */
async function prepararCenario(
  razaoSocial: string,
  envolverDb?: (db: AppDb) => AppDb,
): Promise<Cenario> {
  const database = createTestDatabase();
  const app = await buildApp({ db: envolverDb ? envolverDb(database.db) : database.db, logger: false });
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
  const { cookie } = await fazerLogin(app, contador.email);
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

  // conta bancária pelo caminho de produção (pré-condição do extrato)
  const respostaConta = await app.inject({
    method: 'POST',
    url: '/contas-bancarias',
    headers: { cookie },
    payload: {
      empresa_id: empresa.id,
      nome: 'Banco Conciliação',
      saldo_inicial_centavos: 100_000,
      data_saldo_inicial: '2026-05-01',
    },
  });
  if (respostaConta.statusCode !== 201) {
    throw new Error(`conta bancária de teste falhou (${respostaConta.statusCode}): ${respostaConta.body}`);
  }

  return {
    t,
    empresa,
    contador,
    cookie,
    fornecedores,
    caixa,
    contaBancaria: contaBancariaSchema.parse(respostaConta.json()),
  };
}

/* ------------------------------- HTTP helpers ------------------------------ */

function postItem(
  c: Cenario,
  payload: Record<string, unknown>,
  cookie = c.cookie,
) {
  return c.t.app.inject({
    method: 'POST',
    url: `/contas-bancarias/${c.contaBancaria.id}/itens`,
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postConciliacao(
  c: Cenario,
  payload: Record<string, unknown>,
  cookie = c.cookie,
  empresaId = c.empresa.id,
) {
  return c.t.app.inject({
    method: 'POST',
    url: '/conciliacoes',
    headers: { cookie },
    payload: { empresa_id: empresaId, ...payload },
  });
}

function delConciliacao(c: Cenario, conciliacaoId: number, cookie = c.cookie, empresaId = c.empresa.id) {
  return c.t.app.inject({
    method: 'DELETE',
    url: `/conciliacoes/${conciliacaoId}?empresa_id=${empresaId}`,
    headers: { cookie },
  });
}

function getItens(c: Cenario, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/contas-bancarias/${c.contaBancaria.id}/itens?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function getConciliacoes(c: Cenario, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/conciliacoes?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function postTitulo(c: Cenario, payload: Record<string, unknown>, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'POST',
    url: '/titulos',
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postLancamento(c: Cenario, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: '/lancamentos',
    headers: { cookie: c.cookie },
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

function postEstornoBaixa(c: Cenario, baixaId: number, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: `/baixas/${baixaId}/estorno`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

/* ------------------------------ DB helpers -------------------------------- */

function eventosDe(c: Cenario, acao: string) {
  return c.t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

function itensNoBanco(c: Cenario) {
  return c.t.database.db.select().from(itemExtrato).all();
}

function conciliacoesNoBanco(c: Cenario) {
  return c.t.database.db.select().from(conciliacao).all();
}

function tituloNoBanco(c: Cenario, tituloId: number) {
  return c.t.database.db.select().from(tituloTabela).where(eq(tituloTabela.id, tituloId)).all()[0];
}

function baixaNoBanco(c: Cenario, baixaId: number) {
  return c.t.database.db.select().from(baixaTabela).where(eq(baixaTabela.id, baixaId)).all()[0];
}

/* --------------------------- criadores via API ---------------------------- */

async function criarItemViaApi(
  c: Cenario,
  sobrescrita: Record<string, unknown> = {},
): Promise<ItemExtratoDTO> {
  const resposta = await postItem(c, {
    data: '2026-05-05',
    descricao: 'Item de extrato de teste',
    valor_centavos: -10_000,
    ...sobrescrita,
  });
  expect(resposta.statusCode).toBe(201);
  return itemExtratoSchema.parse(resposta.json());
}

async function criarTituloViaApi(
  c: Cenario,
  sobrescrita: Record<string, unknown> = {},
): Promise<TituloComBaixasDTO> {
  const resposta = await postTitulo(c, {
    tipo: 'pagar',
    contraparte: 'Fornecedor Alfa',
    descricao: 'Título de teste',
    vencimento: '2026-05-10',
    valor_centavos: 50_000,
    conta_id: c.fornecedores.id,
    ...sobrescrita,
  });
  expect(resposta.statusCode).toBe(201);
  return tituloComBaixasSchema.parse(resposta.json());
}

/** Lançamento avulso equilibrado (CA-08: conciliação direta a lançamento). */
async function criarLancamentoAvulso(c: Cenario) {
  const resposta = await postLancamento(c, {
    data: '2026-05-12',
    historico: 'Lançamento avulso para conciliação',
    partidas: [
      { conta_id: c.caixa.id, natureza: 'D', valor_centavos: 100_000 },
      { conta_id: c.fornecedores.id, natureza: 'C', valor_centavos: 100_000 },
    ],
  });
  expect(resposta.statusCode).toBe(201);
  return lancamentoSchema.parse(resposta.json());
}

/** Empresa Y com contador próprio, título, conta bancária e item (dados alheios reais). */
async function montarEmpresaAlheia(c: Cenario): Promise<{
  empresaY: Empresa;
  cookieY: string;
  tituloY: TituloComBaixasDTO;
  contaBancariaY: ContaBancariaDTO;
  itemY: ItemExtratoDTO;
}> {
  const db: AppDb = c.t.database.db;
  const empresaY = criarEmpresaTeste(db, { razaoSocial: 'Empresa Alheia' });
  const contadorY = await criarUsuarioTeste(db, {
    papel: 'contador',
    empresas: [empresaY.id],
    email: `contador-alheio-${empresaY.id}@escritorio.test`,
  });
  const { cookie: cookieY } = await fazerLogin(c.t.app, contadorY.email);

  const contaContabilY = criarContaTeste(db, {
    empresaId: empresaY.id,
    codigo: '1.1.1',
    descricao: 'Caixa Y',
    tipo: 'ativo',
  });
  const respostaTitulo = await c.t.app.inject({
    method: 'POST',
    url: '/titulos',
    headers: { cookie: cookieY },
    payload: {
      empresa_id: empresaY.id,
      tipo: 'pagar',
      contraparte: 'Fornecedor Y',
      descricao: 'Título de Y',
      vencimento: '2026-05-10',
      valor_centavos: 10_000,
      conta_id: contaContabilY.id,
    },
  });
  expect(respostaTitulo.statusCode).toBe(201);
  const tituloY = tituloComBaixasSchema.parse(respostaTitulo.json());

  const respostaConta = await c.t.app.inject({
    method: 'POST',
    url: '/contas-bancarias',
    headers: { cookie: cookieY },
    payload: { empresa_id: empresaY.id, nome: 'Banco Y', data_saldo_inicial: '2026-05-01' },
  });
  expect(respostaConta.statusCode).toBe(201);
  const contaBancariaY = contaBancariaSchema.parse(respostaConta.json());

  const respostaItem = await c.t.app.inject({
    method: 'POST',
    url: `/contas-bancarias/${contaBancariaY.id}/itens`,
    headers: { cookie: cookieY },
    payload: {
      empresa_id: empresaY.id,
      data: '2026-05-05',
      descricao: 'Item de extrato de Y',
      valor_centavos: -10_000,
    },
  });
  expect(respostaItem.statusCode).toBe(201);
  const itemY = itemExtratoSchema.parse(respostaItem.json());

  return { empresaY, cookieY, tituloY, contaBancariaY, itemY };
}

/* --------------------------- corrida determinística ------------------------ */

/** Passo observado pela janela de corrida (a pré-condição é comprovada com ele). */
type PassoJanela = 'leitura' | 'transacao';

/**
 * Torna a janela leitura→escrita DETERMÍSTICA nos testes de corrida da
 * conciliação (correção pós-revisão FIX-T018-R1), na linha do
 * `dbComLeiturasAdiadas` da T016 (`titulos.test.ts`), com UM ajuste: as
 * leituras aguardadas são executadas em **LOTE** no mesmo tick.
 *
 * Por que o lote: em `criarConciliacao` e `desconciliarConciliacao` a última
 * leitura É o pré-check que decide o caminho (conciliação vigente do item /
 * linha a desconciliar). Com o flush um a um da T016, a segunda requisição
 * executaria essa leitura DEPOIS da transação da primeira e a corrida não
 * existiria — o pré-check sequencial responderia e o teste não provaria nada.
 * Em lote, as duas requisições executam TODAS as leituras antes de QUALQUER
 * transação: exatamente a janela da corrida real (outro processo escrevendo
 * entre a leitura e a escrita).
 *
 * Nenhuma validação é contornada: só o AGENDAMENTO das leituras muda — o
 * serviço, os guards, o predicado otimista, o rollback e o banco rodam
 * intactos (caminho de produção). O `registro` devolvido existe para o TESTE
 * comprovar a pré-condição do cenário antes de interpretar o resultado
 * (regra 2 do AGENTS.md: sem pré-condição comprovada não é evidência).
 */
function dbComJanelaDeCorrida(db: AppDb): { db: AppDb; registro: PassoJanela[] } {
  const registro: PassoJanela[] = [];
  let aguardando: Array<() => void> = [];
  let loteAgendado = false;

  const executarLote = (): void => {
    loteAgendado = false;
    const lote = aguardando;
    aguardando = [];
    for (const executar of lote) executar();
  };

  const adiar = (builder: unknown): unknown => {
    if (typeof builder !== 'object' || builder === null) return builder;
    return new Proxy(builder as object, {
      get(alvo, prop) {
        if (prop === 'then') {
          return (onOk?: unknown, onErr?: unknown) =>
            new Promise((resolve, reject) => {
              aguardando.push(() => {
                // a leitura EXECUTA aqui, no lote: antes disso nenhuma
                // transação pôde rodar (as transações não passam por isto)
                registro.push('leitura');
                Promise.resolve(alvo as PromiseLike<unknown>).then(
                  (valor) =>
                    resolve(typeof onOk === 'function' ? (onOk as (v: unknown) => unknown)(valor) : valor),
                  (erro) =>
                    reject(typeof onErr === 'function' ? (onErr as (e: unknown) => unknown)(erro) : erro),
                );
              });
              if (!loteAgendado) {
                loteAgendado = true;
                setImmediate(executarLote);
              }
            });
        }
        const valor = Reflect.get(alvo, prop);
        if (typeof valor === 'function') {
          return (...args: unknown[]) => {
            const saida = (valor as (...a: unknown[]) => unknown).apply(alvo, args);
            return typeof saida === 'object' && saida !== null ? adiar(saida) : saida;
          };
        }
        return valor;
      },
    });
  };

  return {
    registro,
    db: new Proxy(db, {
      get(alvo, prop) {
        const valor = Reflect.get(alvo, prop);
        if (prop === 'select' && typeof valor === 'function') {
          return (...args: unknown[]) =>
            adiar((valor as (...a: unknown[]) => unknown).apply(alvo, args));
        }
        if (prop === 'transaction' && typeof valor === 'function') {
          return (...args: unknown[]) => {
            registro.push('transacao');
            return (valor as (...a: unknown[]) => unknown).apply(alvo, args);
          };
        }
        return typeof valor === 'function' ? valor.bind(alvo) : valor;
      },
    }),
  };
}

/* -------------------------------------------------------------------------- */

describe('conciliação bancária item a item (RF-16, CA-08/28/44; TASK-018)', () => {
  test('CA-08 três itens, dois conciliados (um a título, um a lançamento avulso): 2 conciliados + 1 pendente; estado persiste em sessão nova e o pendente é conciliado depois', async () => {
    const c = await prepararCenario('CA-08');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const i1 = await criarItemViaApi(c, {
        data: '2026-05-05',
        descricao: 'Pagamento energia',
        valor_centavos: -15_075,
      });
      const i2 = await criarItemViaApi(c, {
        data: '2026-05-10',
        descricao: 'Recebimento cliente',
        valor_centavos: 250_000,
      });
      const i3 = await criarItemViaApi(c, {
        data: '2026-05-15',
        descricao: 'Transferência interna',
        valor_centavos: -50_000,
      });
      const titulo = await criarTituloViaApi(c);
      const lancamentoAvulso = await criarLancamentoAvulso(c);

      // um item a um título e outro DIRETAMENTE a um lançamento avulso (RF-16)
      const concTitulo = await postConciliacao(c, {
        item_extrato_id: i1.id,
        objeto_tipo: 'titulo',
        titulo_id: titulo.id,
      });
      expect(concTitulo.statusCode).toBe(201);
      const concLancamento = await postConciliacao(c, {
        item_extrato_id: i2.id,
        objeto_tipo: 'lancamento',
        lancamento_id: lancamentoAvulso.id,
      });
      expect(concLancamento.statusCode).toBe(201);

      // 2 conciliados e 1 pendente
      let itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.filter((item) => item.conciliado)).toHaveLength(2);
      expect(itens.filter((item) => !item.conciliado).map((item) => item.id)).toEqual([i3.id]);
      const conciliacoes = listaConciliacoesResponseSchema.parse(
        (await getConciliacoes(c)).json(),
      ).conciliacoes;
      expect(conciliacoes).toHaveLength(2);
      expect(conciliacoes.every((linha) => linha.desconciliado_em === null)).toBe(true);
      expect(eventosDe(c, 'conciliacao.criacao')).toHaveLength(2);

      // sair e voltar (sessão nova): a consulta mantém o MESMO estado
      const logout = await c.t.app.inject({
        method: 'POST',
        url: '/logout',
        headers: { cookie: c.cookie },
      });
      expect(logout.statusCode).toBe(200);
      const novaSessao = await fazerLogin(c.t.app, c.contador.email);
      // a partir daqui a sessão é a NOVA: os helpers usam `c.cookie`
      c.cookie = novaSessao.cookie;
      const itensSessaoNova = listaItensExtratoResponseSchema.parse(
        (await getItens(c, novaSessao.cookie)).json(),
      ).itens;
      expect(itensSessaoNova.filter((item) => item.conciliado).map((item) => item.id)).toEqual([
        i1.id,
        i2.id,
      ]);
      expect(itensSessaoNova.filter((item) => !item.conciliado).map((item) => item.id)).toEqual([
        i3.id,
      ]);
      const conciliacoesSessaoNova = listaConciliacoesResponseSchema.parse(
        (await getConciliacoes(c, novaSessao.cookie)).json(),
      ).conciliacoes;
      expect(conciliacoesSessaoNova).toHaveLength(2);

      // o item pendente pode ser conciliado DEPOIS (parcialidade retomável)
      const titulo2 = await criarTituloViaApi(c, { contraparte: 'Fornecedor Beta' });
      const depois = await postConciliacao(
        c,
        { item_extrato_id: i3.id, objeto_tipo: 'titulo', titulo_id: titulo2.id },
        novaSessao.cookie,
      );
      expect(depois.statusCode).toBe(201);
      itens = listaItensExtratoResponseSchema.parse((await getItens(c, novaSessao.cookie)).json())
        .itens;
      expect(itens.every((item) => item.conciliado)).toBe(true);
      expect(itens).toHaveLength(3);
      expect(eventosDe(c, 'conciliacao.criacao')).toHaveLength(3);
      expect(itensNoBanco(c)).toHaveLength(3);
    } finally {
      await c.t.close();
    }
  });

  test('CA-28 desconciliar devolve o item a pendente com história na trilha; item conciliado não vai a dois objetos sem desconciliar antes', async () => {
    const c = await prepararCenario('CA-28');
    try {
      const i1 = await criarItemViaApi(c, { descricao: 'Item um' });
      const i2 = await criarItemViaApi(c, { descricao: 'Item dois' });
      const tituloA = await criarTituloViaApi(c, { contraparte: 'Fornecedor Alfa' });
      const tituloB = await criarTituloViaApi(c, { contraparte: 'Fornecedor Beta' });

      const criada = await postConciliacao(c, {
        item_extrato_id: i1.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloA.id,
      });
      expect(criada.statusCode).toBe(201);
      const conciliacaoId = conciliacaoSchema.parse(criada.json()).id;

      // item conciliado não concilia a dois objetos distintos (CA-28/CE-9)
      const doisObjetos = await postConciliacao(c, {
        item_extrato_id: i1.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloB.id,
      });
      expect(doisObjetos.statusCode).toBe(409);
      expect(erroResponseSchema.parse(doisObjetos.json()).erro).toMatch(/já está conciliado/i);
      expect(eventosDe(c, 'conciliacao.criacao_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'item_ja_conciliado',
      });
      expect(conciliacoesNoBanco(c)).toHaveLength(1);

      // desconciliar devolve a pendente e preserva o histórico (linha + trilha)
      const desfeita = await delConciliacao(c, conciliacaoId);
      expect(desfeita.statusCode).toBe(200);
      const dtoDesfeita = conciliacaoSchema.parse(desfeita.json());
      expect(dtoDesfeita.desconciliado_em).not.toBeNull();
      expect(dtoDesfeita.desconciliado_por).toBe(c.contador.id);

      const itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.find((item) => item.id === i1.id)?.conciliado).toBe(false);
      expect(itens.find((item) => item.id === i2.id)?.conciliado).toBe(false);

      // histórico: a linha NÃO foi apagada (nunca DELETE) e a trilha registrou
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
      expect(conciliacoesNoBanco(c)[0]?.desconciliadoEm).not.toBeNull();
      const desconciliacoes = eventosDe(c, 'conciliacao.desconciliacao');
      expect(desconciliacoes).toHaveLength(1);
      expect(desconciliacoes[0]?.dados).toMatchObject({
        conciliacao_id: conciliacaoId,
        item_extrato_id: i1.id,
      });

      // depois de desconciliar, o mesmo item concilia OUTRO objeto
      const outra = await postConciliacao(c, {
        item_extrato_id: i1.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloB.id,
      });
      expect(outra.statusCode).toBe(201);
      expect(conciliacoesNoBanco(c)).toHaveLength(1); // reativa a MESMA linha
      expect(conciliacoesNoBanco(c)[0]?.tituloId).toBe(tituloB.id);
      expect(conciliacoesNoBanco(c)[0]?.desconciliadoEm).toBeNull();

      // desconciliar de novo é aceito; a SEGUNDA vez seguida é recusada
      expect((await delConciliacao(c, conciliacaoId)).statusCode).toBe(200);
      const repetida = await delConciliacao(c, conciliacaoId);
      expect(repetida.statusCode).toBe(409);
      expect(erroResponseSchema.parse(repetida.json()).erro).toMatch(/já foi desfeita/i);
      expect(eventosDe(c, 'conciliacao.desconciliacao_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'conciliacao_ja_desfeita',
      });

      // o outro item permaneceu pendente o tempo todo (parcialidade)
      const finais = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(finais.find((item) => item.id === i2.id)?.conciliado).toBe(false);
    } finally {
      await c.t.close();
    }
  });

  test('CA-44 estorno de baixa com lançamento conciliado é recusado orientando desconciliar; após desconciliar, é aceito (fluxo do CA-42)', async () => {
    const c = await prepararCenario('CA-44');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const titulo = await criarTituloViaApi(c);
      const respostaBaixa = await postBaixa(c, titulo.id, {
        data: '2026-05-10',
        valor_centavos: 50_000,
        conta_contrapartida_id: c.caixa.id,
      });
      expect(respostaBaixa.statusCode).toBe(201);
      const baixa = baixaSchema.parse(respostaBaixa.json());
      expect(baixa.lancamento_id).toBeGreaterThan(0);

      // dado real: o lançamento VINCULADO da baixa está conciliado
      const item = await criarItemViaApi(c, {
        data: '2026-05-10',
        descricao: 'Pagamento do título',
        valor_centavos: -50_000,
      });
      const conciliacaoCriada = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'lancamento',
        lancamento_id: baixa.lancamento_id,
      });
      expect(conciliacaoCriada.statusCode).toBe(201);
      const conciliacaoId = conciliacaoSchema.parse(conciliacaoCriada.json()).id;

      // estorno RECUSADO com mensagem orientando a desconciliar (H20/CE-18)
      const recusado = await postEstornoBaixa(c, baixa.id, { data: '2026-05-20' });
      expect(recusado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(recusado.json()).erro).toMatch(/desconcilie/i);
      const recusa = eventosDe(c, 'titulo.estorno_baixa_recusada').at(-1)!;
      expect(recusa.dados).toMatchObject({
        motivo: 'lancamento_conciliado',
        titulo_id: titulo.id,
      });

      // nada mudou: baixa sem estorno, título quitado, sem estorno de lançamento
      expect(baixaNoBanco(c, baixa.id)?.estornoLancamentoId).toBeNull();
      expect(tituloNoBanco(c, titulo.id)?.situacao).toBe('pago');
      expect(tituloNoBanco(c, titulo.id)?.saldoCentavos).toBe(0);
      expect(eventosDe(c, 'titulo.estorno_baixa')).toHaveLength(0);

      // desconciliar libera o lançamento
      const desfeita = await delConciliacao(c, conciliacaoId);
      expect(desfeita.statusCode).toBe(200);

      // estorno ACEITO e fluxo do CA-42 (título volta a aberto com saldo total)
      const estorno = await postEstornoBaixa(c, baixa.id, { data: '2026-05-20' });
      expect(estorno.statusCode).toBe(201);
      expect(baixaNoBanco(c, baixa.id)?.estornoLancamentoId).toBeGreaterThan(0);
      expect(tituloNoBanco(c, titulo.id)?.situacao).toBe('aberto');
      expect(tituloNoBanco(c, titulo.id)?.saldoCentavos).toBe(50_000);
      expect(eventosDe(c, 'titulo.estorno_baixa')).toHaveLength(1);
      // a conciliação continua na trilha como desfeita (histórico preservado)
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
      expect(conciliacoesNoBanco(c)[0]?.desconciliadoEm).not.toBeNull();
    } finally {
      await c.t.close();
    }
  });

  test('dois itens conciliando o MESMO objeto: o segundo é recusado até o primeiro ser desconciliado (T018-F-2)', async () => {
    const c = await prepararCenario('CA-duplo-objeto');
    try {
      const i1 = await criarItemViaApi(c, { descricao: 'Item um' });
      const i2 = await criarItemViaApi(c, { descricao: 'Item dois' });
      const titulo = await criarTituloViaApi(c);

      const primeiro = await postConciliacao(c, {
        item_extrato_id: i1.id,
        objeto_tipo: 'titulo',
        titulo_id: titulo.id,
      });
      expect(primeiro.statusCode).toBe(201);

      // o MESMO título não recebe um segundo item conciliado (exclusividade)
      const segundo = await postConciliacao(c, {
        item_extrato_id: i2.id,
        objeto_tipo: 'titulo',
        titulo_id: titulo.id,
      });
      expect(segundo.statusCode).toBe(409);
      expect(erroResponseSchema.parse(segundo.json()).erro).toMatch(/já está conciliado/i);
      expect(eventosDe(c, 'conciliacao.criacao_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'objeto_ja_conciliado',
      });
      expect(conciliacoesNoBanco(c)).toHaveLength(1);

      // o segundo item segue PENDENTE (nada de "meia conciliação")
      const itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.find((item) => item.id === i2.id)?.conciliado).toBe(false);
      expect(itens.find((item) => item.id === i1.id)?.conciliado).toBe(true);

      // desconciliar o primeiro libera o objeto para o segundo
      const conciliacaoId = conciliacaoSchema.parse(primeiro.json()).id;
      expect((await delConciliacao(c, conciliacaoId)).statusCode).toBe(200);
      const liberado = await postConciliacao(c, {
        item_extrato_id: i2.id,
        objeto_tipo: 'titulo',
        titulo_id: titulo.id,
      });
      expect(liberado.statusCode).toBe(201);

      // histórico: a linha desfeita de i1 permanece; i2 fica ativa
      const linhas = conciliacoesNoBanco(c);
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatchObject({
        itemExtratoId: i1.id,
        tituloId: titulo.id,
        desconciliadoEm: expect.any(String),
      });
      expect(linhas[1]).toMatchObject({
        itemExtratoId: i2.id,
        tituloId: titulo.id,
        desconciliadoEm: null,
      });
      const finais = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(finais.find((item) => item.id === i1.id)?.conciliado).toBe(false);
      expect(finais.find((item) => item.id === i2.id)?.conciliado).toBe(true);
    } finally {
      await c.t.close();
    }
  });

  test('conciliação com objeto inexistente x alheio: MESMO 404 (sem oráculo), recusa auditada só no alheio e controle aceito na própria empresa', async () => {
    const c = await prepararCenario('CA-objeto-oraculo');
    try {
      const item = await criarItemViaApi(c, { descricao: 'Item conciliável' });
      const { empresaY, tituloY } = await montarEmpresaAlheia(c);

      // (1) título INEXISTENTE x título ALHEIO — MESMA resposta (sem oráculo)
      const inexistente = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'titulo',
        titulo_id: 999_999,
      });
      const alheio = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloY.id,
      });
      expect(inexistente.statusCode).toBe(404);
      expect(alheio.statusCode).toBe(404);
      const erroInexistente = erroResponseSchema.parse(inexistente.json()).erro;
      const erroAlheio = erroResponseSchema.parse(alheio.json()).erro;
      expect(erroAlheio).toBe(erroInexistente);
      expect(erroAlheio).toMatch(/Título não encontrado nesta empresa/i);

      // trilha SÓ na tentativa alheia (padrão da T016: inexistente não gera trilha)
      const recusas = eventosDe(c, 'conciliacao.criacao_recusada');
      expect(recusas).toHaveLength(1);
      expect(recusas[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_do_titulo: empresaY.id,
      });
      expect(recusas[0]?.usuarioId).toBe(c.contador.id);

      // nada foi gravado e o item continua pendente
      expect(conciliacoesNoBanco(c)).toHaveLength(0);
      const itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.find((linha) => linha.id === item.id)?.conciliado).toBe(false);

      // controle aceito: conciliar a um título da própria empresa funciona
      const tituloProprio = await criarTituloViaApi(c, { contraparte: 'Fornecedor Próprio' });
      const aceito = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloProprio.id,
      });
      expect(aceito.statusCode).toBe(201);
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('admin é recusado auditado na conciliação (escrita contábil) e continua com leitura (T018-F-1)', async () => {
    const c = await prepararCenario('CA-admin-conciliacao');
    try {
      // dado real: item criado pelo contador (tentativa do admin o alveja)
      const item = await criarItemViaApi(c, { descricao: 'Item do admin' });
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        email: 'admin-conciliacao@escritorio.test',
        empresas: [c.empresa.id],
      });
      const { cookie: cookieAdmin } = await fazerLogin(c.t.app, admin.email);

      const tentativa = await c.t.app.inject({
        method: 'POST',
        url: '/conciliacoes',
        headers: { cookie: cookieAdmin },
        payload: {
          empresa_id: c.empresa.id,
          item_extrato_id: item.id,
          objeto_tipo: 'titulo',
          titulo_id: 1,
        },
      });
      expect(tentativa.statusCode).toBe(403);
      expect(erroResponseSchema.parse(tentativa.json()).erro).toMatch(/escrita contábil/i);

      // auditada como tentativa, com usuário, empresa, objeto e motivo
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(admin.id);
      expect(negada.empresaId).toBe(c.empresa.id);
      expect(negada.objetoTipo).toBe('conciliacao');
      expect(negada.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });
      expect(conciliacoesNoBanco(c)).toHaveLength(0);

      // admin só LÊ (leitura global permitida)
      const leitura = await c.t.app.inject({
        method: 'GET',
        url: `/conciliacoes?empresa_id=${c.empresa.id}`,
        headers: { cookie: cookieAdmin },
      });
      expect(leitura.statusCode).toBe(200);
      expect(listaConciliacoesResponseSchema.parse(leitura.json()).conciliacoes).toHaveLength(0);
      const itensLeitura = await c.t.app.inject({
        method: 'GET',
        url: `/contas-bancarias/${c.contaBancaria.id}/itens?empresa_id=${c.empresa.id}`,
        headers: { cookie: cookieAdmin },
      });
      expect(itensLeitura.statusCode).toBe(200);
      expect(listaItensExtratoResponseSchema.parse(itensLeitura.json()).itens).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('contador alheio: escrita com empresa_id alheio 403 auditada; DELETE e criação com id alheio 404 idêntico ao inexistente (sem oráculo)', async () => {
    const c = await prepararCenario('CA-alheio-conciliacao');
    try {
      const { empresaY, cookieY, tituloY, itemY } = await montarEmpresaAlheia(c);

      // conciliacao REAL em Y (dado alheio para o caso "alheio" do oráculo)
      const respostaY = await postConciliacao(
        c,
        { item_extrato_id: itemY.id, objeto_tipo: 'titulo', titulo_id: tituloY.id },
        cookieY,
        empresaY.id,
      );
      expect(respostaY.statusCode).toBe(201);
      const conciliacaoY = conciliacaoSchema.parse(respostaY.json());

      // (1) escrita apontando empresa alheia → 403 auditada (guard, antes do corpo)
      const escritaAlheia = await postConciliacao(
        c,
        { item_extrato_id: itemY.id, objeto_tipo: 'titulo', titulo_id: tituloY.id },
        c.cookie,
        empresaY.id,
      );
      expect(escritaAlheia.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAlheia.json()).erro).toMatch(/acesso negado/i);
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(c.contador.id);
      expect(negada.empresaId).toBe(empresaY.id);
      expect(negada.objetoTipo).toBe('conciliacao');
      expect(negada.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
      expect(conciliacoesNoBanco(c)).toHaveLength(1); // só a de Y, nada em X

      // (2) DELETE: inexistente x alheio — MESMA resposta (sem oráculo)
      const deleteInexistente = await delConciliacao(c, 999_999);
      const deleteAlheio = await delConciliacao(c, conciliacaoY.id);
      expect(deleteInexistente.statusCode).toBe(404);
      expect(deleteAlheio.statusCode).toBe(404);
      const erroInexistente = erroResponseSchema.parse(deleteInexistente.json()).erro;
      const erroAlheio = erroResponseSchema.parse(deleteAlheio.json()).erro;
      expect(erroAlheio).toBe(erroInexistente);
      expect(erroAlheio).toMatch(/não encontrada nesta empresa/i);

      // trilha SÓ na tentativa alheia (padrão da T016)
      const trilhas = eventosDe(c, 'conciliacao.tentativa_negada');
      expect(trilhas).toHaveLength(1);
      expect(trilhas[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_da_conciliacao: empresaY.id,
      });

      // dado de Y intacto: a conciliacao alheia segue ATIVA
      const linhaY = conciliacoesNoBanco(c).find((linha) => linha.id === conciliacaoY.id);
      expect(linhaY?.desconciliadoEm).toBeNull();

      // (3) item: inexistente x alheio — MESMA resposta; trilha só no alheio
      const itemInexistente = await postConciliacao(c, {
        item_extrato_id: 999_999,
        objeto_tipo: 'titulo',
        titulo_id: 1,
      });
      const itemAlheio = await postConciliacao(c, {
        item_extrato_id: itemY.id,
        objeto_tipo: 'titulo',
        titulo_id: 1,
      });
      expect(itemInexistente.statusCode).toBe(404);
      expect(itemAlheio.statusCode).toBe(404);
      const erroItemInexistente = erroResponseSchema.parse(itemInexistente.json()).erro;
      const erroItemAlheio = erroResponseSchema.parse(itemAlheio.json()).erro;
      expect(erroItemAlheio).toBe(erroItemInexistente);
      expect(erroItemAlheio).toMatch(/Item de extrato não encontrado nesta empresa/i);
      const trilhasItem = eventosDe(c, 'item_extrato.tentativa_negada');
      expect(trilhasItem).toHaveLength(1);
      expect(trilhasItem[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_do_item: empresaY.id,
      });

      // nada foi gravado em X
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
      expect(conciliacoesNoBanco(c)[0]?.empresaId).toBe(empresaY.id);
    } finally {
      await c.t.close();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Correção pós-revisão FIX-T018-R1                                            */
/* -------------------------------------------------------------------------- */

describe('corridas da conciliação (D-R1) e valor zero do item manual — FIX-T018-R1', () => {
  test('item manual com valor CENTAVOS ZERO: 400 com mensagem e nenhum item gravado (a mesma regra dos parsers de arquivo)', async () => {
    const c = await prepararCenario('item-valor-zero');
    try {
      // dado REAL + controle no MESMO endpoint: um item com movimento é aceito
      // (a recusa é do zero, não do caminho de criação)
      const aceito = await criarItemViaApi(c, { descricao: 'Item com movimento' });
      expect(aceito.valor_centavos).toBe(-10_000);

      const resposta = await postItem(c, {
        data: '2026-05-06',
        descricao: 'Item sem movimento',
        valor_centavos: 0,
      });
      expect(resposta.statusCode).toBe(400);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/diferente de zero/i);

      // contagem no banco: só o item válido existe; zero não virou registro
      expect(itensNoBanco(c)).toHaveLength(1);
      expect(itensNoBanco(c)[0]?.valorCentavos).toBe(-10_000);
      expect(eventosDe(c, 'item_extrato.criacao')).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('corrida de reativação do MESMO item: duas criações simultâneas → uma 201 e uma 409 auditada item_ja_conciliado; o vínculo vencedor não é sobrescrito (CA-28)', async () => {
    let registro: PassoJanela[] = [];
    const c = await prepararCenario('corrida-reativacao', (db) => {
      const janela = dbComJanelaDeCorrida(db);
      registro = janela.registro;
      return janela.db;
    });
    try {
      // pré-condição REAL: a linha do item existe e está DESFEITA — o caminho
      // das requisições é o UPDATE de reativação (não o INSERT)
      const item = await criarItemViaApi(c, { descricao: 'Item da corrida' });
      const tituloAntigo = await criarTituloViaApi(c, { contraparte: 'Fornecedor Antigo' });
      const tituloA = await criarTituloViaApi(c, { contraparte: 'Fornecedor A' });
      const tituloB = await criarTituloViaApi(c, { contraparte: 'Fornecedor B' });
      const criada = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'titulo',
        titulo_id: tituloAntigo.id,
      });
      expect(criada.statusCode).toBe(201);
      const conciliacaoId = conciliacaoSchema.parse(criada.json()).id;
      expect((await delConciliacao(c, conciliacaoId)).statusCode).toBe(200);
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
      expect(conciliacoesNoBanco(c)[0]?.desconciliadoEm).not.toBeNull();

      // corrida DETERMÍSTICA (ver dbComJanelaDeCorrida): as duas requisições
      // completam TODAS as leituras — inclusive o pré-check "item já
      // conciliado", que enxerga a linha ainda desfeita — antes de qualquer
      // transação. Sem o predicado otimista as duas respondem 201 e a segunda
      // SOBRESCREVE o vínculo da primeira, sem recusa alguma na trilha.
      registro.length = 0;
      const respostas = await Promise.all([
        postConciliacao(c, {
          item_extrato_id: item.id,
          objeto_tipo: 'titulo',
          titulo_id: tituloA.id,
        }),
        postConciliacao(c, {
          item_extrato_id: item.id,
          objeto_tipo: 'titulo',
          titulo_id: tituloB.id,
        }),
      ]);

      // pré-condição COMPROVADA (regra 2 do AGENTS.md): houve transação e
      // NENHUMA leitura da corrida rodou depois da primeira transação — sem
      // isto a corrida não existiria e o teste não seria evidência
      expect(registro.filter((passo) => passo === 'transacao')).not.toHaveLength(0);
      expect(registro.indexOf('transacao')).toBeGreaterThan(registro.lastIndexOf('leitura'));

      const codigos = respostas.map((resposta) => resposta.statusCode).sort((a, b) => a - b);
      expect(codigos).toEqual([201, 409]);

      const aceita = respostas.find((resposta) => resposta.statusCode === 201)!;
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroResponseSchema.parse(recusada.json()).erro).toMatch(/já está conciliado/i);
      const dtoAceita = conciliacaoSchema.parse(aceita.json());

      // UMA linha (a MESMA do histórico, reativa) apontando para o objeto do
      // 201: o vínculo vencedor permanece intacto (CA-28)
      const linhas = conciliacoesNoBanco(c);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({
        id: conciliacaoId,
        tituloId: dtoAceita.titulo_id,
        desconciliadoEm: null,
      });

      // recusa auditada FORA da transação abortada (D-R1), com o MESMO motivo
      // do caminho sequencial e com usuário/empresa/item reais
      const recusas = eventosDe(c, 'conciliacao.criacao_recusada');
      expect(recusas).toHaveLength(1);
      expect(recusas[0]?.usuarioId).toBe(c.contador.id);
      expect(recusas[0]?.empresaId).toBe(c.empresa.id);
      expect(recusas[0]?.dados).toMatchObject({
        motivo: 'item_ja_conciliado',
        item_extrato_id: item.id,
      });

      // a perdedora NÃO gravou nada: 1 criação na corrida (a vencedora) além
      // da do setup, e nenhuma desconciliação fantasma
      expect(eventosDe(c, 'conciliacao.criacao')).toHaveLength(2);
      expect(eventosDe(c, 'conciliacao.desconciliacao')).toHaveLength(1);

      const itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.find((linha) => linha.id === item.id)?.conciliado).toBe(true);
    } finally {
      await c.t.close();
    }
  });

  test('corrida de desconciliação: dois DELETEs simultâneos da MESMA conciliação → um 200 e um 409 auditado conciliacao_ja_desfeita; UM evento de desconciliação (nunca 500 nem evento fantasma)', async () => {
    let registro: PassoJanela[] = [];
    const c = await prepararCenario('corrida-desconciliacao', (db) => {
      const janela = dbComJanelaDeCorrida(db);
      registro = janela.registro;
      return janela.db;
    });
    try {
      // dado REAL: conciliação criada e VIGENTE — as duas requisições partem
      // dela (o pré-check sequencial de cada uma enxerga "não desfeita")
      const item = await criarItemViaApi(c, { descricao: 'Item da corrida de desconciliação' });
      const titulo = await criarTituloViaApi(c);
      const criada = await postConciliacao(c, {
        item_extrato_id: item.id,
        objeto_tipo: 'titulo',
        titulo_id: titulo.id,
      });
      expect(criada.statusCode).toBe(201);
      const conciliacaoId = conciliacaoSchema.parse(criada.json()).id;
      expect(conciliacoesNoBanco(c)).toHaveLength(1);
      expect(conciliacoesNoBanco(c)[0]?.desconciliadoEm).toBeNull();

      // corrida DETERMÍSTICA (ver dbComJanelaDeCorrida): as DUAS leituras da
      // conciliação acontecem antes de QUALQUER transação, então a segunda
      // requisição chega ao UPDATE já com a linha desfeita pela primeira —
      // 0 linhas no predicado. Sem a checagem ela grava o evento de
      // desconciliação de um desfazimento inexistente e devolve `undefined`
      // (a rota responde 500 sem recusa auditada alguma).
      registro.length = 0;
      const respostas = await Promise.all([
        delConciliacao(c, conciliacaoId),
        delConciliacao(c, conciliacaoId),
      ]);

      // pré-condição COMPROVADA (regra 2 do AGENTS.md): houve transação e
      // NENHUMA leitura da corrida rodou depois da primeira transação
      expect(registro.filter((passo) => passo === 'transacao')).not.toHaveLength(0);
      expect(registro.indexOf('transacao')).toBeGreaterThan(registro.lastIndexOf('leitura'));

      const codigos = respostas.map((resposta) => resposta.statusCode).sort((a, b) => a - b);
      expect(codigos).toEqual([200, 409]);
      const recusada = respostas.find((resposta) => resposta.statusCode === 409)!;
      expect(erroResponseSchema.parse(recusada.json()).erro).toMatch(/já foi desfeita/i);
      const dtoAceita = conciliacaoSchema.parse(
        respostas.find((resposta) => resposta.statusCode === 200)!.json(),
      );
      expect(dtoAceita.desconciliado_em).not.toBeNull();
      expect(dtoAceita.desconciliado_por).toBe(c.contador.id);

      // UM evento de desconciliação: a perdedora não grava o desfazimento
      // inexistente (o bug do achado) e não responde 500
      expect(eventosDe(c, 'conciliacao.desconciliacao')).toHaveLength(1);
      // a recusa dela fica na trilha FORA da transação abortada (D-R1), com o
      // MESMO motivo e a MESMA mensagem do caminho sequencial
      const recusas = eventosDe(c, 'conciliacao.desconciliacao_recusada');
      expect(recusas).toHaveLength(1);
      expect(recusas[0]?.usuarioId).toBe(c.contador.id);
      expect(recusas[0]?.empresaId).toBe(c.empresa.id);
      expect(recusas[0]?.dados).toMatchObject({
        motivo: 'conciliacao_ja_desfeita',
        conciliacao_id: conciliacaoId,
        item_extrato_id: item.id,
      });

      // estado final: linha única desfeita (histórico) e item pendente
      const linhas = conciliacoesNoBanco(c);
      expect(linhas).toHaveLength(1);
      expect(linhas[0]?.desconciliadoEm).not.toBeNull();
      expect(linhas[0]?.desconciliadoPor).toBe(c.contador.id);
      const itens = listaItensExtratoResponseSchema.parse((await getItens(c)).json()).itens;
      expect(itens.find((linha) => linha.id === item.id)?.conciliado).toBe(false);
    } finally {
      await c.t.close();
    }
  });
});
