import {
  baixaSchema,
  erroResponseSchema,
  lancamentoSchema,
  listaTitulosResponseSchema,
  tituloComBaixasSchema,
  type TituloComBaixasDTO,
} from '@sistema-contabil/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import {
  auditEvent,
  baixa as baixaTabela,
  empresa as empresaTabela,
  lancamento,
  partida,
  titulo as tituloTabela,
  type Conta,
  type Empresa,
} from '../../src/db/schema.ts';
import { encerrarPeriodo } from '../../src/services/encerramento.ts';
import { buildApp } from '../../src/app.ts';
import type { AppDb } from '../../src/db/index.ts';
import { criarContaTeste, criarPeriodoTeste } from '../fixtures/contas.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { criarTituloTeste } from '../fixtures/titulos.ts';
import { createTestDatabase, type TestApp } from '../harness.ts';

/**
 * Títulos a pagar/receber, baixa total/parcial, cancelamento e estorno de
 * baixa (RF-13/RF-14/RF-15/RF-24, H8, CA-06/07/16/40/41/42/43/55; TASK-016).
 *
 * Um teste por critério de aceite (verificação planejada da TASK-016). As
 * recusas sem CA correspondente (cancelamento, baixa em período encerrado,
 * baixa em empresa inativa) são nomeadas SEM número de CA e a limitação está
 * registrada em `TASK-016.json:assumptions`. Escrita sempre pelo contador
 * ATRIBUIDO via guard `exigirEscritaContabil` (CA-33/35/36 são de T012/T013).
 *
 * Pré-condições de dado REAL em testes negativos (regra 2 do AGENTS.md): as
 * recusas de baixa/estorno acontecem sobre títulos e lançamentos gravados pelo
 * caminho de produção, com o "controle" aceito logo em seguida — recusa sem
 * dado existente não seria evidência.
 */

interface Cenario {
  t: TestApp;
  empresa: Empresa;
  contador: { id: number; email: string };
  cookie: string;
  /** Passivo: conta do título a pagar (razão em que a baixa impacta). */
  fornecedores: Conta;
  /** Ativo: conta do título a receber. */
  cliente: Conta;
  /** Ativo: conta da contrapartida (caixa/banco) das baixas. */
  caixa: Conta;
}

/** App + empresa + contador atribuído + contas (Fornecedores/Clientes/Caixa).
 * `envolverDb` (opcional) troca a conexão exposta às rotas — usado pelos
 * testes de corrida para tornar a janela read-modify-write determinística
 * (ver `dbComLeiturasAdiadas`). */
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
  const { cookie } = await fazerLogin(t.app, contador.email);
  const fornecedores = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '2.1.1',
    descricao: 'Fornecedores',
    tipo: 'passivo',
  });
  const cliente = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '1.2.1',
    descricao: 'Clientes',
    tipo: 'ativo',
  });
  const caixa = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '1.1.1',
    descricao: 'Caixa',
    tipo: 'ativo',
  });
  return { t, empresa, contador, cookie, fornecedores, cliente, caixa };
}

/* ------------------------------- HTTP helpers ------------------------------ */

function postTitulo(c: Cenario, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: '/titulos',
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function getTituloDetalhe(c: Cenario, tituloId: number) {
  return c.t.app.inject({
    method: 'GET',
    url: `/titulos/${tituloId}?empresa_id=${c.empresa.id}`,
    headers: { cookie: c.cookie },
  });
}

function getListaTitulos(c: Cenario, extra = '') {
  return c.t.app.inject({
    method: 'GET',
    url: `/titulos?empresa_id=${c.empresa.id}${extra}`,
    headers: { cookie: c.cookie },
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

function postCancelamento(c: Cenario, tituloId: number) {
  return c.t.app.inject({
    method: 'POST',
    url: `/titulos/${tituloId}/cancelamento`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id },
  });
}

function postEstornoBaixa(c: Cenario, baixaId: number, payload: Record<string, unknown> = {}) {
  return c.t.app.inject({
    method: 'POST',
    url: `/baixas/${baixaId}/estorno`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postEstornoLancamento(
  c: Cenario,
  lancamentoId: number,
  payload: Record<string, unknown> = {},
) {
  return c.t.app.inject({
    method: 'POST',
    url: `/lancamentos/${lancamentoId}/estorno`,
    headers: { cookie: c.cookie },
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

/** Lançamento equilibrado padrão: D Caixa / C Fornecedores. */
function payloadEquilibrado(c: Cenario, centavos: number, data = '2026-05-03') {
  return {
    data,
    historico: 'Lançamento de teste',
    partidas: [
      { conta_id: c.caixa.id, natureza: 'D', valor_centavos: centavos },
      { conta_id: c.fornecedores.id, natureza: 'C', valor_centavos: centavos },
    ],
  };
}

/* ------------------------------ DB helpers -------------------------------- */

function eventosDe(c: Cenario, acao: string) {
  return c.t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

function lancamentosNoBanco(c: Cenario) {
  return c.t.database.db.select().from(lancamento).all();
}

function baixasNoBanco(c: Cenario) {
  return c.t.database.db.select().from(baixaTabela).all();
}

function tituloNoBanco(c: Cenario, tituloId: number) {
  return c.t.database.db.select().from(tituloTabela).where(eq(tituloTabela.id, tituloId)).all()[0];
}

function partidasDoLancamentoNoBanco(c: Cenario, lancamentoId: number) {
  return c.t.database.db
    .select()
    .from(partida)
    .where(eq(partida.lancamentoId, lancamentoId))
    .orderBy(partida.id)
    .all();
}

/* ------------------------- corrida determinística -------------------------- */

/**
 * Torna a janela read-modify-write DETERMÍSTICA nos testes de corrida.
 *
 * Medido em 2026-10-22: sem isto, `Promise.all` de `app.inject` se SERIALIZA
 * (better-sqlite3 é síncrono e as leituras resolvem em microtasks) — a segunda
 * baixa enxerga o saldo já abatido e recebe 400 `valor_maior_que_saldo` em vez
 * de exercitar o predicado otimista; a corrida nunca acontece.
 *
 * O proxy adia a EXECUÇÃO de cada `select` do Drizzle para o próximo tick
 * (macrotask): as duas requisições completam TODAS as leituras e validações
 * antes de qualquer transação — exatamente a janela da corrida real — e as
 * transações síncronas correm em FIFO. Nenhuma validação é contornada: só o
 * agendamento das leituras muda; serviço, guards, rollback e banco rodam
 * intactos (o caminho de produção).
 */
function dbComLeiturasAdiadas(db: AppDb): AppDb {
  return new Proxy(db, {
    get(alvo, prop) {
      const valor = Reflect.get(alvo, prop);
      if (prop === 'select' && typeof valor === 'function') {
        return (...args: unknown[]) =>
          adiarThenable((valor as (...a: unknown[]) => unknown).apply(alvo, args));
      }
      return typeof valor === 'function' ? valor.bind(alvo) : valor;
    },
  });
}

/** Cede um tick (setImmediate) antes de acionar o builder thenable do Drizzle. */
function adiarThenable(builder: unknown): unknown {
  if (typeof builder !== 'object' || builder === null) return builder;
  return new Proxy(builder as object, {
    get(alvo, prop) {
      if (prop === 'then') {
        return (onOk?: unknown, onErr?: unknown) =>
          new Promise((resolve, reject) => {
            setImmediate(() => {
              Promise.resolve(alvo as PromiseLike<unknown>).then(
                (valor) =>
                  resolve(typeof onOk === 'function' ? (onOk as (v: unknown) => unknown)(valor) : valor),
                (erro) =>
                  reject(typeof onErr === 'function' ? (onErr as (e: unknown) => unknown)(erro) : erro),
              );
            });
          });
      }
      const valor = Reflect.get(alvo, prop);
      if (typeof valor === 'function') {
        return (...args: unknown[]) => {
          const saida = (valor as (...a: unknown[]) => unknown).apply(alvo, args);
          return typeof saida === 'object' && saida !== null ? adiarThenable(saida) : saida;
        };
      }
      return valor;
    },
  });
}

/** Payload de baixa padrão (período 05/2026 aberto nos testes). */
function payloadBaixa(c: Cenario, centavos: number, data = '2026-05-10') {
  return { data, valor_centavos: centavos, conta_contrapartida_id: c.caixa.id };
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

async function detalheDoTitulo(c: Cenario, tituloId: number): Promise<TituloComBaixasDTO> {
  const resposta = await getTituloDetalhe(c, tituloId);
  expect(resposta.statusCode).toBe(200);
  return tituloComBaixasSchema.parse(resposta.json());
}

/* -------------------------------------------------------------------------- */

describe('títulos a pagar/receber e baixa (RF-13/14/15, CA-06/07/16/40/41)', () => {
  test('CA-06 título a pagar de 500,00 pago no vencimento: situação pago, saldo zera, sem nova baixa, lançamento vinculado de 500,00 e sem multa/juros', async () => {
    const c = await prepararCenario('CA-06');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const aberto = await criarTituloViaApi(c);
      expect(aberto.situacao).toBe('aberto');
      expect(aberto.saldo_centavos).toBe(50_000);

      // pago NO VENCIMENTO (2026-05-10)
      const respostaBaixa = await postBaixa(c, aberto.id, payloadBaixa(c, 50_000));
      expect(respostaBaixa.statusCode).toBe(201);
      const baixa = baixaSchema.parse(respostaBaixa.json());

      // D1/T017: sem retenção nem encargos (multa/juros é cálculo da T017)
      expect(baixa.valor_centavos).toBe(50_000);
      expect(baixa.retencao_centavos).toBe(0);
      expect(baixa.encargos_centavos).toBe(0);

      const detalhe = await detalheDoTitulo(c, aberto.id);
      expect(detalhe.situacao).toBe('pago');
      expect(detalhe.saldo_centavos).toBe(0);
      expect(detalhe.baixas).toHaveLength(1);

      // lançamento vinculado de 500,00 (RF-15): pagar = D conta do título /
      // C contrapartida, datado do vencimento, com trilha na mesma transação
      const vinculado = lancamentosNoBanco(c).find((l) => l.id === baixa.lancamento_id);
      expect(vinculado).toBeDefined();
      expect(vinculado?.data).toBe('2026-05-10');
      expect(partidasDoLancamentoNoBanco(c, baixa.lancamento_id)).toEqual([
        { id: expect.any(Number), lancamentoId: baixa.lancamento_id, contaId: c.fornecedores.id, natureza: 'D', valorCentavos: 50_000 },
        { id: expect.any(Number), lancamentoId: baixa.lancamento_id, contaId: c.caixa.id, natureza: 'C', valorCentavos: 50_000 },
      ]);

      // trilha: criação do título, baixa e o lançamento gerado por ela
      expect(eventosDe(c, 'titulo.criacao')).toHaveLength(1);
      expect(eventosDe(c, 'titulo.baixa')[0]?.dados).toMatchObject({
        titulo_id: aberto.id,
        lancamento_id: baixa.lancamento_id,
        valor_centavos: 50_000,
        saldo_centavos: 0,
        situacao: 'pago',
      });
      expect(eventosDe(c, 'lancamento.criacao')[0]?.dados).toMatchObject({
        origem: 'baixa',
        baixa_id: baixa.id,
        debitos_centavos: 50_000,
        creditos_centavos: 50_000,
      });

      // sem nova baixa após quitação
      const novaBaixa = await postBaixa(c, aberto.id, payloadBaixa(c, 1_000, '2026-05-11'));
      expect(novaBaixa.statusCode).toBe(409);
      expect(erroResponseSchema.parse(novaBaixa.json()).erro).toMatch(/quitado/i);
      expect(eventosDe(c, 'titulo.baixa_recusada')[0]?.dados).toMatchObject({
        motivo: 'titulo_quitado',
      });

      // nada além da baixa única foi persistido
      expect(baixasNoBanco(c)).toHaveLength(1);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-07 mesmo fluxo para conta a receber: título quitado (estado "pago" do enum) com lançamento vinculado', async () => {
    const c = await prepararCenario('CA-07');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      // CA-07 fala em "recebido"; o enum do escopo é aberto|parcial|pago|
      // cancelado (JSON governa) — recebido = pago (TASK-016:assumptions).
      const aberto = await criarTituloViaApi(c, {
        tipo: 'receber',
        contraparte: 'Cliente Beta',
        conta_id: c.cliente.id,
      });
      expect(aberto.tipo).toBe('receber');
      expect(aberto.situacao).toBe('aberto');

      const respostaBaixa = await postBaixa(c, aberto.id, payloadBaixa(c, 50_000));
      expect(respostaBaixa.statusCode).toBe(201);
      const baixa = baixaSchema.parse(respostaBaixa.json());
      expect(baixa.retencao_centavos).toBe(0);
      expect(baixa.encargos_centavos).toBe(0);

      const detalhe = await detalheDoTitulo(c, aberto.id);
      expect(detalhe.situacao).toBe('pago');
      expect(detalhe.saldo_centavos).toBe(0);
      expect(detalhe.baixas).toHaveLength(1);

      // receber = D contrapartida (caixa) / C conta do título (cliente)
      expect(partidasDoLancamentoNoBanco(c, baixa.lancamento_id)).toEqual([
        { id: expect.any(Number), lancamentoId: baixa.lancamento_id, contaId: c.cliente.id, natureza: 'C', valorCentavos: 50_000 },
        { id: expect.any(Number), lancamentoId: baixa.lancamento_id, contaId: c.caixa.id, natureza: 'D', valorCentavos: 50_000 },
      ]);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(eventosDe(c, 'titulo.baixa')).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-16 recusas de baixa (valor > saldo, <= 0, data inválida, título pago/cancelado) sem alteração parcial; controle aceito entre as recusas', async () => {
    const c = await prepararCenario('CA-16');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const t2 = await criarTituloViaApi(c, { contraparte: 'Fornecedor Gama' });

      // dado real: baixa parcial 300,00 → saldo 200,00 (base das recusas)
      const base = await postBaixa(c, t1.id, payloadBaixa(c, 30_000, '2026-05-05'));
      expect(base.statusCode).toBe(201);
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(20_000);

      // (a) valor MAIOR que o saldo: 300,00 com saldo 200,00 — mensagem com
      // os DOIS valores citados literalmente
      const maiorQueSaldo = await postBaixa(c, t1.id, payloadBaixa(c, 30_000, '2026-05-06'));
      expect(maiorQueSaldo.statusCode).toBe(400);
      const erroMaior = erroResponseSchema.parse(maiorQueSaldo.json()).erro;
      expect(erroMaior).toMatch(/maior que o saldo/i);
      expect(erroMaior).toMatch(/R\$ 300,00/);
      expect(erroMaior).toMatch(/R\$ 200,00/);
      expect(eventosDe(c, 'titulo.baixa_recusada')[0]?.dados).toMatchObject({
        motivo: 'valor_maior_que_saldo',
        valor_centavos: 30_000,
        saldo_centavos: 20_000,
      });
      // sem alteração parcial: saldo, baixas e lançamentos intactos
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(20_000);
      expect(baixasNoBanco(c)).toHaveLength(1);
      expect(lancamentosNoBanco(c)).toHaveLength(1);

      // (b) valor zero (entrada, camada de requisição)
      const valorZero = await postBaixa(c, t1.id, { ...payloadBaixa(c, 1_000), valor_centavos: 0 });
      expect(valorZero.statusCode).toBe(400);
      expect(erroResponseSchema.parse(valorZero.json()).erro).toMatch(/maior que zero/i);

      // (c) valor negativo
      const valorNegativo = await postBaixa(c, t1.id, {
        ...payloadBaixa(c, 1_000),
        valor_centavos: -500,
      });
      expect(valorNegativo.statusCode).toBe(400);
      expect(erroResponseSchema.parse(valorNegativo.json()).erro).toMatch(/maior que zero/i);

      // (d) data em formato inválido
      const dataInvalida = await postBaixa(c, t1.id, { ...payloadBaixa(c, 1_000), data: '05/05/2026' });
      expect(dataInvalida.statusCode).toBe(400);
      expect(erroResponseSchema.parse(dataInvalida.json()).erro).toMatch(/AAAA-MM-DD/i);

      // (e) título CANCELADO não aceita baixa (preparado pelo caminho de produção)
      const cancelado = await postCancelamento(c, t2.id);
      expect(cancelado.statusCode).toBe(200);
      const baixaEmCancelado = await postBaixa(c, t2.id, payloadBaixa(c, 1_000, '2026-05-07'));
      expect(baixaEmCancelado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(baixaEmCancelado.json()).erro).toMatch(/cancelado/i);
      expect(eventosDe(c, 'titulo.baixa_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'titulo_cancelado',
      });

      // controle ENTRE as recusas: a baixa válida seguinte é aceita (quitando t1)
      const quitação = await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-08'));
      expect(quitação.statusCode).toBe(201);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('pago');
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(0);

      // (f) título PAGO não aceita nova baixa
      const emPago = await postBaixa(c, t1.id, payloadBaixa(c, 1_000, '2026-05-09'));
      expect(emPago.statusCode).toBe(409);
      expect(erroResponseSchema.parse(emPago.json()).erro).toMatch(/quitado/i);
      expect(eventosDe(c, 'titulo.baixa_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'titulo_quitado',
      });

      // estado final: só as 2 baixas aceitas viraram lançamento; as 3 recusas
      // de serviço auditadas (as de entrada/validação são da camada de request)
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('pago');
      expect(tituloNoBanco(c, t2.id)?.situacao).toBe('cancelado');
      expect(tituloNoBanco(c, t2.id)?.saldoCentavos).toBe(0);
      expect(baixasNoBanco(c)).toHaveLength(2);
      expect(lancamentosNoBanco(c)).toHaveLength(2);
      expect(partidasDoLancamentoNoBanco(c, baixasNoBanco(c)[0]!.lancamentoId)).toHaveLength(2);
      expect(eventosDe(c, 'titulo.baixa_recusada')).toHaveLength(3);
      expect(eventosDe(c, 'titulo.baixa')).toHaveLength(2);
    } finally {
      await c.t.close();
    }
  });

  test('CA-40 empresa inativa: título e baixa novos recusados com mensagem; histórico de títulos segue consultável', async () => {
    const c = await prepararCenario('CA-40');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const baixa = await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-05'));
      expect(baixa.statusCode).toBe(201);

      // inativa a empresa (histórico preservado — H13)
      c.t.database.db.update(empresaTabela).set({ ativo: false }).run();

      // escrita nova recusada com mensagem de empresa inativa (CA-40/CE-14)
      const novoTitulo = await postTitulo(c, {
        tipo: 'pagar',
        contraparte: 'Fornecedor Delta',
        vencimento: '2026-06-10',
        valor_centavos: 10_000,
        conta_id: c.fornecedores.id,
      });
      expect(novoTitulo.statusCode).toBe(403);
      expect(erroResponseSchema.parse(novoTitulo.json()).erro).toMatch(/inativa/i);

      const novaBaixa = await postBaixa(c, t1.id, payloadBaixa(c, 10_000, '2026-05-15'));
      expect(novaBaixa.statusCode).toBe(403);
      expect(erroResponseSchema.parse(novaBaixa.json()).erro).toMatch(/inativa/i);

      // histórico consultável: lista e detalhe com a baixa gravada antes
      const lista = listaTitulosResponseSchema.parse((await getListaTitulos(c)).json());
      expect(lista.titulos).toHaveLength(1);
      expect(lista.titulos[0]).toMatchObject({ id: t1.id, situacao: 'parcial', saldo_centavos: 30_000 });
      const detalhe = await detalheDoTitulo(c, t1.id);
      expect(detalhe.baixas).toHaveLength(1);

      // as recusas não persistiram nada
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(30_000);
      expect(baixasNoBanco(c)).toHaveLength(1);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-41 baixa parcial 200,00 => parcial com saldo 300,00; baixa seguinte 300,00 => pago; lançamentos vinculados somam 500,00', async () => {
    const c = await prepararCenario('CA-41');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);

      const parcial = await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-05'));
      expect(parcial.statusCode).toBe(201);
      const detalheParcial = await detalheDoTitulo(c, t1.id);
      expect(detalheParcial.situacao).toBe('parcial');
      expect(detalheParcial.saldo_centavos).toBe(30_000);

      const final = await postBaixa(c, t1.id, payloadBaixa(c, 30_000, '2026-05-06'));
      expect(final.statusCode).toBe(201);
      const detalheFinal = await detalheDoTitulo(c, t1.id);
      expect(detalheFinal.situacao).toBe('pago');
      expect(detalheFinal.saldo_centavos).toBe(0);
      expect(detalheFinal.baixas).toHaveLength(2);

      // Conferência de somatório (verification_plan): os lançamentos
      // vinculados somam o valor TOTAL do título — em centavos, sem float
      const baixas = baixasNoBanco(c).filter((b) => b.tituloId === t1.id);
      const somaBaixas = baixas.reduce((total, b) => total + b.valorCentavos, 0);
      expect(somaBaixas).toBe(50_000);

      let somaDebitos = 0;
      let somaCreditos = 0;
      for (const b of baixas) {
        const linhas = partidasDoLancamentoNoBanco(c, b.lancamentoId);
        const debitos = linhas.filter((p) => p.natureza === 'D').reduce((s, p) => s + p.valorCentavos, 0);
        const creditos = linhas.filter((p) => p.natureza === 'C').reduce((s, p) => s + p.valorCentavos, 0);
        expect(debitos).toBe(b.valorCentavos);
        expect(creditos).toBe(b.valorCentavos);
        somaDebitos += debitos;
        somaCreditos += creditos;
      }
      expect(somaDebitos).toBe(50_000);
      expect(somaCreditos).toBe(50_000);

      expect(eventosDe(c, 'titulo.baixa')).toHaveLength(2);
      expect(eventosDe(c, 'lancamento.criacao').filter((e) => (e.dados as { origem?: string })?.origem === 'baixa')).toHaveLength(2);
    } finally {
      await c.t.close();
    }
  });
});

describe('estorno de baixa (RF-24, CA-42/43/55)', () => {
  test('CA-42 título pago com estorno volta a aberto com saldo 500,00; lançamento de estorno imutável vinculado; trilha registra; novo pagamento funciona', async () => {
    const c = await prepararCenario('CA-42');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const paga = await postBaixa(c, t1.id, payloadBaixa(c, 50_000, '2026-05-10'));
      expect(paga.statusCode).toBe(201);
      const baixa = baixaSchema.parse(paga.json());
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('pago');

      const estorno = await postEstornoBaixa(c, baixa.id, { data: '2026-05-15' });
      expect(estorno.statusCode).toBe(201);
      const baixaEstornada = baixaSchema.parse(estorno.json());
      expect(baixaEstornada.estorno_lancamento_id).not.toBeNull();

      // título reaberto com saldo integral
      const detalhe = await detalheDoTitulo(c, t1.id);
      expect(detalhe.situacao).toBe('aberto');
      expect(detalhe.saldo_centavos).toBe(50_000);

      // lançamento de estorno vinculado ao da baixa e INVERSO (naturezas trocadas)
      const estornoLancamento = lancamentosNoBanco(c).find(
        (l) => l.id === baixaEstornada.estorno_lancamento_id,
      );
      expect(estornoLancamento?.estornoDeId).toBe(baixa.lancamento_id);
      expect(partidasDoLancamentoNoBanco(c, baixaEstornada.estorno_lancamento_id!)).toEqual([
        { id: expect.any(Number), lancamentoId: baixaEstornada.estorno_lancamento_id, contaId: c.fornecedores.id, natureza: 'C', valorCentavos: 50_000 },
        { id: expect.any(Number), lancamentoId: baixaEstornada.estorno_lancamento_id, contaId: c.caixa.id, natureza: 'D', valorCentavos: 50_000 },
      ]);

      // imutável NO BANCO (R9/RF-08): UPDATE/DELETE diretos abortam
      expect(() =>
        c.t.database.sqlite
          .prepare('UPDATE lancamento SET historico = ? WHERE id = ?')
          .run('hackeado', baixaEstornada.estorno_lancamento_id!),
      ).toThrow(/imutavel/i);
      expect(() =>
        c.t.database.sqlite
          .prepare('DELETE FROM lancamento WHERE id = ?')
          .run(baixaEstornada.estorno_lancamento_id!),
      ).toThrow(/imutavel/i);

      // trilha registra o estorno e o lançamento gerado por ele
      expect(eventosDe(c, 'titulo.estorno_baixa')[0]?.dados).toMatchObject({
        titulo_id: t1.id,
        lancamento_id: baixa.lancamento_id,
        estorno_lancamento_id: baixaEstornada.estorno_lancamento_id,
        valor_centavos: 50_000,
        saldo_centavos: 50_000,
        situacao: 'aberto',
      });
      expect(
        eventosDe(c, 'lancamento.estorno').find(
          (e) => e.objetoId === String(baixaEstornada.estorno_lancamento_id),
        )?.dados,
      ).toMatchObject({ origem: 'estorno_de_baixa', estorno_de_id: baixa.lancamento_id });

      // novo pagamento funciona após o estorno (controle discriminante)
      const novoPagamento = await postBaixa(c, t1.id, payloadBaixa(c, 50_000, '2026-05-20'));
      expect(novoPagamento.statusCode).toBe(201);
      const depois = await detalheDoTitulo(c, t1.id);
      expect(depois.situacao).toBe('pago');
      expect(depois.saldo_centavos).toBe(0);
      expect(depois.baixas).toHaveLength(2);
      expect(baixasNoBanco(c)).toHaveLength(2);
      // pares: baixa1 + estorno1 + baixa2 (o estorno reabriu; a nova baixa quitou)
      expect(lancamentosNoBanco(c)).toHaveLength(3);
    } finally {
      await c.t.close();
    }
  });

  test('CA-43 estorno da baixa parcial (200,00) devolve o título a aberto com saldo 500,00 e estorno vinculado', async () => {
    const c = await prepararCenario('CA-43');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);

      const parcial = await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-05'));
      expect(parcial.statusCode).toBe(201);
      const baixa = baixaSchema.parse(parcial.json());
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('parcial');
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(30_000);

      const estorno = await postEstornoBaixa(c, baixa.id, { data: '2026-05-15' });
      expect(estorno.statusCode).toBe(201);
      const baixaEstornada = baixaSchema.parse(estorno.json());
      expect(baixaEstornada.estorno_lancamento_id).not.toBeNull();

      const detalhe = await detalheDoTitulo(c, t1.id);
      expect(detalhe.situacao).toBe('aberto');
      expect(detalhe.saldo_centavos).toBe(50_000);

      // estorno vinculado: lançamento inverso ligado ao da baixa (RF-24)
      const vinculado = lancamentosNoBanco(c).find(
        (l) => l.id === baixaEstornada.estorno_lancamento_id,
      );
      expect(vinculado?.estornoDeId).toBe(baixa.lancamento_id);
      expect(partidasDoLancamentoNoBanco(c, baixa.lancamento_id)).toHaveLength(2);
      expect(partidasDoLancamentoNoBanco(c, baixaEstornada.estorno_lancamento_id!)).toHaveLength(2);

      // estorno único por baixa: repetir é recusado (RF-24) e não altera nada
      const repetido = await postEstornoBaixa(c, baixa.id, { data: '2026-05-16' });
      expect(repetido.statusCode).toBe(409);
      expect(erroResponseSchema.parse(repetido.json()).erro).toMatch(/só pode ser estornada uma vez/i);
      expect(eventosDe(c, 'titulo.estorno_baixa_recusada')[0]?.dados).toMatchObject({
        motivo: 'baixa_ja_estornada',
      });
      expect(lancamentosNoBanco(c)).toHaveLength(2);
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(50_000);
    } finally {
      await c.t.close();
    }
  });

  test('CA-55 estorno de baixa em período encerrado: recusa com mensagem, título inalterado, sem estorno e tentativa auditada; estorno em aberto funciona', async () => {
    // Relógio congelado em DEZ/2026 — muito depois da data da bomba que este
    // teste era (fixava "hoje" em 10/2026 e quebrava a partir de 2026-11-01).
    // Só o `Date` é falsificado: se qualquer data do teste ainda derivasse do
    // calendário, o período do mês congelado não existiria e o teste falharia
    // — prova PERMANENTE de independência de relógio.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-15T12:00:00.000Z') });
    const c = await prepararCenario('CA-55');
    try {
      // pré-condições: período das baixas (05/2026) e período da DATA DO
      // ESTORNO A (06/2026) — criados a partir das MESMAS datas que os
      // requests enviam. O estorno A manda `data` EXPLÍCITA ('2026-06-10',
      // nunca o padrão "hoje" da rota): o teste é independente do relógio
      // POR CONSTRUÇÃO — nenhum período, data ou asserção deriva de "hoje",
      // então continua verde em qualquer calendário.
      const periodoMaio = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 5,
      });
      const periodoEstornoA = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 6,
      });

      const t1 = await criarTituloViaApi(c);
      const baixaA = baixaSchema.parse((await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-10'))).json());
      const baixaB = baixaSchema.parse((await postBaixa(c, t1.id, payloadBaixa(c, 30_000, '2026-05-20'))).json());
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('pago');

      // estorno A com o período da baixa ainda ABERTO funciona (data
      // explícita em 06/2026, período próprio também aberto)
      const estornoA = await postEstornoBaixa(c, baixaA.id, { data: '2026-06-10' });
      expect(estornoA.statusCode).toBe(201);
      const estornoALancamento = lancamentosNoBanco(c).find(
        (l) => l.id === baixaSchema.parse(estornoA.json()).estorno_lancamento_id,
      );
      expect(estornoALancamento?.periodoId).toBe(periodoEstornoA.id);
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(20_000);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('parcial');

      // fecha o período das baixas pelo SERVIÇO da T015 (não por SQL direto):
      // é a transição legítima de estado usada pelo produto
      const encerrado = await encerrarPeriodo(
        c.t.database.db,
        { periodoId: periodoMaio.id, empresaId: c.empresa.id },
        c.contador.id,
      );
      expect(encerrado.periodo.encerradoEm).not.toBeNull();

      // estorno B (período da baixa encerrado) é recusado com mensagem; a
      // tentativa fica NA TRILHA (evento gravado fora da transação — T016-F-4)
      const estornoB = await postEstornoBaixa(c, baixaB.id);
      expect(estornoB.statusCode).toBe(409);
      const erro = erroResponseSchema.parse(estornoB.json()).erro;
      expect(erro).toMatch(/encerrado/i);
      expect(erro).toMatch(/05\/2026/);
      const recusa = eventosDe(c, 'titulo.estorno_baixa_recusada').at(-1);
      expect(recusa?.dados).toMatchObject({
        motivo: 'periodo_encerrado',
        titulo_id: t1.id,
        data_baixa: '2026-05-20',
        ano: 2026,
        mes: 5,
      });

      // título INALTERADO pela tentativa recusada; sem lançamento de estorno
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(20_000);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('parcial');
      const baixaBLinha = baixasNoBanco(c).find((b) => b.id === baixaB.id);
      expect(baixaBLinha?.estornoLancamentoId).toBeNull();
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === baixaB.lancamento_id)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(3); // baixa A, baixa B, estorno de A
    } finally {
      vi.useRealTimers();
      await c.t.close();
    }
  });
});

describe('correção de baixa pela rota certa (decisão D2) e segurança das buscas (S-T014-2/3/6)', () => {
  test('D2 estorno direto do lançamento de baixa (e do seu estorno) é recusado orientando a POST /baixas/:id/estorno; lançamento comum segue estornável', async () => {
    const c = await prepararCenario('D2');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });

      // controle discriminante: lançamento COMUM estorna normalmente
      const comum = lancamentoSchema.parse((await postLancamento(c, payloadEquilibrado(c, 10_000, '2026-05-01'))).json());
      const estornoComum = await postEstornoLancamento(c, comum.id, { data: '2026-05-02' });
      expect(estornoComum.statusCode).toBe(201);

      // baixa gera lançamento L1
      const t1 = await criarTituloViaApi(c);
      const baixa = baixaSchema.parse((await postBaixa(c, t1.id, payloadBaixa(c, 50_000, '2026-05-10'))).json());

      // estorno DIRETO de L1: recusado com orientação (não reabre título)
      const direto = await postEstornoLancamento(c, baixa.lancamento_id, { data: '2026-05-15' });
      expect(direto.statusCode).toBe(409);
      const erroDireto = erroResponseSchema.parse(direto.json()).erro;
      expect(erroDireto).toMatch(/estorno de baixa/i);
      expect(erroDireto).toMatch(/\/baixas\//);
      expect(eventosDe(c, 'lancamento.estorno_recusado').at(-1)?.dados).toMatchObject({
        motivo: 'vinculado_a_baixa',
        baixa_id: baixa.id,
        orientacao: 'estorno_de_baixa',
      });
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === baixa.lancamento_id)).toHaveLength(0);

      // o caminho CORRETO (estorno de baixa) funciona e restaura o título
      const estornoBaixa = await postEstornoBaixa(c, baixa.id, { data: '2026-05-16' });
      expect(estornoBaixa.statusCode).toBe(201);
      const baixaEstornada = baixaSchema.parse(estornoBaixa.json());
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('aberto');

      // estorno DIRETO do lançamento de estorno da baixa (L2): também recusado
      const diretoNoEstorno = await postEstornoLancamento(c, baixaEstornada.estorno_lancamento_id!, {
        data: '2026-05-17',
      });
      expect(diretoNoEstorno.statusCode).toBe(409);
      expect(erroResponseSchema.parse(diretoNoEstorno.json()).erro).toMatch(/estorno de baixa/i);
      expect(eventosDe(c, 'lancamento.estorno_recusado')).toHaveLength(2);
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === baixaEstornada.estorno_lancamento_id)).toHaveLength(0);

      // estado: comum (2) + L1 + L2 = 4 lançamentos; recusas não criaram nada
      expect(lancamentosNoBanco(c)).toHaveLength(4);
    } finally {
      await c.t.close();
    }
  });

  test('S-T014-2 lançamento/título/baixa de outra empresa respondem o MESMO 404 do inexistente; só a tentativa alheia deixa trilha', async () => {
    const c = await prepararCenario('S-T014-2');
    try {
      // ---- cenário alheio: segunda empresa + contador, com lançamento,
      // título e baixa REAIS gravados pelo caminho de produção ----
      const db = c.t.database.db;
      const empresaAlheia = criarEmpresaTeste(db, { razaoSocial: 'Empresa Alheia' });
      const contadorAlheio = await criarUsuarioTeste(db, {
        papel: 'contador',
        empresas: [empresaAlheia.id],
        email: 'contador@alheia.test',
      });
      const cookieAlheio = (await fazerLogin(c.t.app, contadorAlheio.email)).cookie;
      const caixaAlheia = criarContaTeste(db, {
        empresaId: empresaAlheia.id,
        codigo: '1.1.1',
        descricao: 'Caixa',
        tipo: 'ativo',
      });
      const fornecedorAlheio = criarContaTeste(db, {
        empresaId: empresaAlheia.id,
        codigo: '2.1.1',
        descricao: 'Fornecedores',
        tipo: 'passivo',
      });
      criarPeriodoTeste(db, { empresaId: empresaAlheia.id, ano: 2026, mes: 5 });

      const lancamentoAlheio = lancamentoSchema.parse(
        (
          await c.t.app.inject({
            method: 'POST',
            url: '/lancamentos',
            headers: { cookie: cookieAlheio },
            payload: {
              empresa_id: empresaAlheia.id,
              data: '2026-05-06',
              historico: 'Lançamento alheio',
              partidas: [
                { conta_id: caixaAlheia.id, natureza: 'D', valor_centavos: 10_000 },
                { conta_id: fornecedorAlheio.id, natureza: 'C', valor_centavos: 10_000 },
              ],
            },
          })
        ).json(),
      );
      const tituloAlheio = tituloComBaixasSchema.parse(
        (
          await c.t.app.inject({
            method: 'POST',
            url: '/titulos',
            headers: { cookie: cookieAlheio },
            payload: {
              empresa_id: empresaAlheia.id,
              tipo: 'pagar',
              contraparte: 'Fornecedor Alheio',
              vencimento: '2026-05-20',
              valor_centavos: 40_000,
              conta_id: fornecedorAlheio.id,
            },
          })
        ).json(),
      );
      const baixaAlheia = baixaSchema.parse(
        (
          await c.t.app.inject({
            method: 'POST',
            url: `/titulos/${tituloAlheio.id}/baixas`,
            headers: { cookie: cookieAlheio },
            payload: {
              empresa_id: empresaAlheia.id,
              data: '2026-05-08',
              valor_centavos: 10_000,
              conta_contrapartida_id: caixaAlheia.id,
            },
          })
        ).json(),
      );

      // (1) lançamento: inexistente x alheio — MESMA resposta (sem oráculo)
      const lancInexistente = await postEstornoLancamento(c, 999_999, { data: '2026-05-15' });
      const lancAlheio = await postEstornoLancamento(c, lancamentoAlheio.id, { data: '2026-05-15' });
      expect(lancInexistente.statusCode).toBe(404);
      expect(lancAlheio.statusCode).toBe(404);
      const erroInexistente = erroResponseSchema.parse(lancInexistente.json()).erro;
      const erroAlheio = erroResponseSchema.parse(lancAlheio.json()).erro;
      expect(erroAlheio).toBe(erroInexistente);
      expect(erroAlheio).toMatch(/não encontrado nesta empresa/i);
      // só a tentativa alheia deixa trilha (lancamento.tentativa_negada)
      const trilhasLanc = eventosDe(c, 'lancamento.tentativa_negada');
      expect(trilhasLanc).toHaveLength(1);
      expect(trilhasLanc[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_do_lancamento: empresaAlheia.id,
      });

      // (2) título: inexistente x alheio — MESMA resposta; trilha só no alheio
      const payloadTentativaBaixa = payloadBaixa(c, 1_000, '2026-05-15');
      const tituloInexistente = await postBaixa(c, 999_999, payloadTentativaBaixa);
      const tituloDeOutra = await postBaixa(c, tituloAlheio.id, payloadTentativaBaixa);
      expect(tituloInexistente.statusCode).toBe(404);
      expect(tituloDeOutra.statusCode).toBe(404);
      const erroTituloInexistente = erroResponseSchema.parse(tituloInexistente.json()).erro;
      const erroTituloAlheio = erroResponseSchema.parse(tituloDeOutra.json()).erro;
      expect(erroTituloAlheio).toBe(erroTituloInexistente);
      const trilhasTitulo = eventosDe(c, 'titulo.tentativa_negada');
      expect(trilhasTitulo).toHaveLength(1);
      expect(trilhasTitulo[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_do_titulo: empresaAlheia.id,
      });

      // (3) baixa: inexistente x alheia — MESMA resposta; trilha só na alheia
      const baixaInexistente = await postEstornoBaixa(c, 999_999, { data: '2026-05-15' });
      const baixaDeOutra = await postEstornoBaixa(c, baixaAlheia.id, { data: '2026-05-15' });
      expect(baixaInexistente.statusCode).toBe(404);
      expect(baixaDeOutra.statusCode).toBe(404);
      const erroBaixaInexistente = erroResponseSchema.parse(baixaInexistente.json()).erro;
      const erroBaixaAlheia = erroResponseSchema.parse(baixaDeOutra.json()).erro;
      expect(erroBaixaAlheia).toBe(erroBaixaInexistente);
      const trilhasBaixa = eventosDe(c, 'baixa.tentativa_negada');
      expect(trilhasBaixa).toHaveLength(1);
      expect(trilhasBaixa[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_da_baixa: empresaAlheia.id,
      });

      // dado alheio intacto (nenhuma escrita cruzada aconteceu)
      const baixaAlheiaLinha = baixasNoBanco(c).find((b) => b.id === baixaAlheia.id);
      expect(baixaAlheiaLinha?.estornoLancamentoId).toBeNull();
      const tituloAlheiaLinha = tituloNoBanco(c, tituloAlheio.id);
      expect(tituloAlheiaLinha?.situacao).toBe('parcial');
      expect(tituloAlheiaLinha?.saldoCentavos).toBe(30_000);
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === lancamentoAlheio.id)).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('S-T014-3 falha de banco no estorno não é mascarada como "já estornado": 500 com rollback total; sem o trigger o estorno funciona', async () => {
    const c = await prepararCenario('S-T014-3');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });

      // dado real: lançamento com partidas de 999.999 gravado ANTES do trigger
      const original = lancamentoSchema.parse(
        (await postLancamento(c, payloadEquilibrado(c, 999_999, '2026-03-15'))).json(),
      );
      expect(lancamentosNoBanco(c)).toHaveLength(1);

      // injeta falha de banco no meio do estorno (INSERT da partida abortado)
      c.t.database.sqlite.exec(
        `CREATE TRIGGER partida_falha_injetada BEFORE INSERT ON partida
         WHEN NEW.valor_centavos = 999999
         BEGIN SELECT RAISE(ABORT, 'falha simulada de banco de dados'); END`,
      );

      const comFalha = await postEstornoLancamento(c, original.id, { data: '2026-03-20' });
      expect(comFalha.statusCode).toBe(500);
      expect(comFalha.statusCode).not.toBe(409);
      expect(erroResponseSchema.parse(comFalha.json()).erro).toMatch(/erro/i);

      // NÃO virou 409 "já estornado": nenhuma recusa auditada, nada persistido
      expect(eventosDe(c, 'lancamento.estorno_recusado')).toHaveLength(0);
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === original.id)).toHaveLength(0);
      expect(partidasDoLancamentoNoBanco(c, original.id)).toHaveLength(2);

      // "restaurar a dependência" e reenviar: grava exatamente UMA vez
      c.t.database.sqlite.exec('DROP TRIGGER partida_falha_injetada');
      const semFalha = await postEstornoLancamento(c, original.id, { data: '2026-03-20' });
      expect(semFalha.statusCode).toBe(201);
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === original.id)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('S-T014-6 vínculos conta↔título↔baixa↔lançamento são compostos (…, empresa_id): o banco recusa cross-tenant com dado real; o INSERT casado funciona', async () => {
    const c = await prepararCenario('S-T014-6');
    try {
      const db = c.t.database.db;
      criarPeriodoTeste(db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });

      // dado real da empresa A: título (fixture FIX-02) + lançamento (produto)
      const tituloA = criarTituloTeste(db, {
        empresaId: c.empresa.id,
        contaId: c.fornecedores.id,
        criadoPor: c.contador.id,
        valorCentavos: 50_000,
      });
      const lancamentoA = lancamentoSchema.parse(
        (await postLancamento(c, payloadEquilibrado(c, 10_000, '2026-05-03'))).json(),
      );

      // empresa B com conta e título próprios (para isolar cada FK composta)
      const empresaB = criarEmpresaTeste(db, { razaoSocial: 'Empresa B FK' });
      const contaB = criarContaTeste(db, { empresaId: empresaB.id, codigo: '1.1.1', tipo: 'ativo' });
      const tituloB = criarTituloTeste(db, {
        empresaId: empresaB.id,
        contaId: contaB.id,
        criadoPor: c.contador.id,
        valorCentavos: 40_000,
      });

      const agora = new Date().toISOString();

      // CONTROLE: o INSERT casado (tudo na MESMA empresa) entra e sai normal
      const inserida = c.t.database.sqlite
        .prepare(
          `INSERT INTO baixa (empresa_id, titulo_id, lancamento_id, estorno_lancamento_id,
                              data, valor_centavos, retencao_centavos, encargos_centavos,
                              criado_por, criado_em)
           VALUES (?, ?, ?, NULL, '2026-05-04', 5000, 0, 0, ?, ?)`,
        )
        .run(c.empresa.id, tituloA.id, lancamentoA.id, c.contador.id, agora);
      expect(inserida.changes).toBe(1);
      c.t.database.sqlite
        .prepare('DELETE FROM baixa WHERE empresa_id = ? AND titulo_id = ? AND lancamento_id = ?')
        .run(c.empresa.id, tituloA.id, lancamentoA.id);

      // (1) título com conta de OUTRA empresa → FK `titulo_conta_empresa_fk`
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO titulo (empresa_id, tipo, contraparte, vencimento, valor_centavos,
                                 conta_id, situacao, saldo_centavos, criado_por, criado_em, atualizado_em)
             VALUES (?, 'pagar', 'Título cross-tenant', '2026-05-01', 1000, ?, 'aberto', 1000, ?, ?, ?)`,
          )
          .run(empresaB.id, c.fornecedores.id, c.contador.id, agora, agora),
      ).toThrow(/FOREIGN KEY/i);

      // (2) baixa com TÍTULO de outra empresa → FK `baixa_titulo_empresa_fk`
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO baixa (empresa_id, titulo_id, lancamento_id, estorno_lancamento_id,
                                data, valor_centavos, retencao_centavos, encargos_centavos,
                                criado_por, criado_em)
             VALUES (?, ?, ?, NULL, '2026-05-04', 5000, 0, 0, ?, ?)`,
          )
          .run(c.empresa.id, tituloB.id, lancamentoA.id, c.contador.id, agora),
      ).toThrow(/FOREIGN KEY/i);

      // (3) baixa com LANÇAMENTO de outra empresa → FK `baixa_lancamento_empresa_fk`
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO baixa (empresa_id, titulo_id, lancamento_id, estorno_lancamento_id,
                                data, valor_centavos, retencao_centavos, encargos_centavos,
                                criado_por, criado_em)
             VALUES (?, ?, ?, NULL, '2026-05-04', 5000, 0, 0, ?, ?)`,
          )
          .run(empresaB.id, tituloB.id, lancamentoA.id, c.contador.id, agora),
      ).toThrow(/FOREIGN KEY/i);

      // nenhuma das tentativas persistiu algo (só o controle, já removido)
      expect(baixasNoBanco(c)).toHaveLength(0);
      expect(c.t.database.db.select().from(tituloTabela).all()).toHaveLength(2);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });
});

describe('cancelamento (RF-13/F11, decisão D3 — sem CA correspondente)', () => {
  test('cancelamento de título (não quitado) zera o saldo, audita sem gerar lançamento e preserva as baixas parciais; estorno e baixa em cancelado são recusados', async () => {
    const c = await prepararCenario('cancelamento-aberto');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const parcial = await postBaixa(c, t1.id, payloadBaixa(c, 20_000, '2026-05-05'));
      expect(parcial.statusCode).toBe(201);
      const baixa = baixaSchema.parse(parcial.json());
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('parcial');
      expect(lancamentosNoBanco(c)).toHaveLength(1);

      // cancelar = escrita do contador; "em aberto" = não quitado nem cancelado
      const cancelado = await postCancelamento(c, t1.id);
      expect(cancelado.statusCode).toBe(200);
      const detalhe = tituloComBaixasSchema.parse(cancelado.json());
      expect(detalhe.situacao).toBe('cancelado');
      expect(detalhe.saldo_centavos).toBe(0);
      // baixas anteriores permanecem visíveis (imutabilidade R9)
      expect(detalhe.baixas).toHaveLength(1);

      // NÃO gera lançamento (hipótese D3 — TASK-016:assumptions)
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(eventosDe(c, 'titulo.cancelamento')[0]?.dados).toMatchObject({
        saldo_anterior_centavos: 30_000,
        saldo_centavos: 0,
        situacao: 'cancelado',
        gerou_lancamento: false,
      });

      // baixa em título cancelado → 409 auditado
      const novaBaixa = await postBaixa(c, t1.id, payloadBaixa(c, 1_000, '2026-05-06'));
      expect(novaBaixa.statusCode).toBe(409);
      expect(erroResponseSchema.parse(novaBaixa.json()).erro).toMatch(/cancelado/i);

      // estorno de baixa em título CANCELADO → 409 (não reabre cancelado)
      const estorno = await postEstornoBaixa(c, baixa.id, { data: '2026-05-15' });
      expect(estorno.statusCode).toBe(409);
      expect(erroResponseSchema.parse(estorno.json()).erro).toMatch(/cancelado/i);
      expect(eventosDe(c, 'titulo.estorno_baixa_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'titulo_cancelado',
      });
      expect(baixasNoBanco(c).find((b) => b.id === baixa.id)?.estornoLancamentoId).toBeNull();
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('recusas de cancelamento: título quitado e cancelamento repetido — estado intacto e trilha registra as duas recusas', async () => {
    const c = await prepararCenario('cancelamento-recusas');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });

      // título PAGO: cancelar é recusado (RF-13: só em aberto)
      const tPago = await criarTituloViaApi(c, { contraparte: 'Fornecedor Pago' });
      expect((await postBaixa(c, tPago.id, payloadBaixa(c, 50_000, '2026-05-05'))).statusCode).toBe(201);
      const recusaPago = await postCancelamento(c, tPago.id);
      expect(recusaPago.statusCode).toBe(409);
      expect(erroResponseSchema.parse(recusaPago.json()).erro).toMatch(/quitado/i);

      // cancelamento é ação única: o segundo cancelamento é recusado
      const tAberto = await criarTituloViaApi(c, { contraparte: 'Fornecedor Aberto' });
      const ok = await postCancelamento(c, tAberto.id);
      expect(ok.statusCode).toBe(200);
      const repetido = await postCancelamento(c, tAberto.id);
      expect(repetido.statusCode).toBe(409);
      expect(erroResponseSchema.parse(repetido.json()).erro).toMatch(/ação única/i);

      const recusas = eventosDe(c, 'titulo.cancelamento_recusado');
      expect(recusas).toHaveLength(2);
      expect(recusas.map((evento) => (evento.dados as { motivo?: string })?.motivo).sort()).toEqual([
        'titulo_ja_cancelado',
        'titulo_quitado',
      ]);

      // estado intacto pelas recusas; o cancelamento aceito permanece
      expect(tituloNoBanco(c, tPago.id)?.situacao).toBe('pago');
      expect(tituloNoBanco(c, tPago.id)?.saldoCentavos).toBe(0);
      expect(tituloNoBanco(c, tAberto.id)?.situacao).toBe('cancelado');
      expect(tituloNoBanco(c, tAberto.id)?.saldoCentavos).toBe(0);
      expect(lancamentosNoBanco(c)).toHaveLength(1); // só a baixa quitada
    } finally {
      await c.t.close();
    }
  });
});

describe('baixas com período/empresa inválidos (sem CA correspondente — ver TASK-016:assumptions)', () => {
  test('baixa com data em período encerrado (ou sem período) é recusada auditada sem lançamento; período aberto aceita', async () => {
    const c = await prepararCenario('baixa-periodo');
    try {
      criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 4,
        encerradoEm: '2026-05-01T12:00:00.000Z',
      });
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);

      // data em período ENCERRADO → 409 auditada; nada persistido
      const emEncerrado = await postBaixa(c, t1.id, payloadBaixa(c, 10_000, '2026-04-10'));
      expect(emEncerrado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(emEncerrado.json()).erro).toMatch(/encerrado/i);
      expect(eventosDe(c, 'titulo.baixa_recusada')[0]?.dados).toMatchObject({
        motivo: 'periodo_encerrado',
        data: '2026-04-10',
      });
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(50_000);
      expect(baixasNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // data sem período CADASTRADO → 404 orientando a criar o período
      const semPeriodo = await postBaixa(c, t1.id, payloadBaixa(c, 10_000, '2027-01-15'));
      expect(semPeriodo.statusCode).toBe(404);
      expect(erroResponseSchema.parse(semPeriodo.json()).erro).toMatch(/período contábil/i);
      expect(eventosDe(c, 'titulo.baixa_recusada').at(-1)?.dados).toMatchObject({
        motivo: 'periodo_nao_encontrado',
        data: '2027-01-15',
      });
      expect(baixasNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // controle: em período ABERTO a mesma baixa é aceita
      const emAberto = await postBaixa(c, t1.id, payloadBaixa(c, 10_000, '2026-05-10'));
      expect(emAberto.statusCode).toBe(201);
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(40_000);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('baixa em empresa inativa é recusada pelo guard de escrita sem alterar o título (histórico segue consultável)', async () => {
    const c = await prepararCenario('baixa-empresa-inativa');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const antes = tituloNoBanco(c, t1.id);

      c.t.database.db.update(empresaTabela).set({ ativo: false }).run();

      const resposta = await postBaixa(c, t1.id, payloadBaixa(c, 10_000, '2026-05-10'));
      expect(resposta.statusCode).toBe(403);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(/inativa/i);

      // nada mudou no título e nada foi lançado
      expect(tituloNoBanco(c, t1.id)).toEqual(antes);
      expect(baixasNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);

      // histórico consultável em empresa inativa (leitura não é bloqueada)
      const lista = listaTitulosResponseSchema.parse((await getListaTitulos(c)).json());
      expect(lista.titulos).toHaveLength(1);
      expect(lista.titulos[0]?.id).toBe(t1.id);
    } finally {
      await c.t.close();
    }
  });
});

describe('corridas (predicado otimista D-R1) e auditoria de conta inexistente — correção pós-revisão T016', () => {
  test('corrida de baixas: duas baixas de 600,00 simultâneas sobre título de 1.000,00 — exatamente uma 201 e uma 409 auditada; saldo 400,00 e Σbaixas vigentes 600,00 (nunca 120.000)', async () => {
    const c = await prepararCenario('baixa-concorrente', dbComLeiturasAdiadas);
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c, { valor_centavos: 100_000 });

      // corrida DETERMÍSTICA (ver dbComLeiturasAdiadas): as duas leituras de
      // validação veem saldo 1.000,00 antes de qualquer transação; sem o
      // predicado otimista as duas passam e gravam saldo derivado da MESMA
      // leitura velha (corrupção silenciosa: Σbaixas 120.000 > valor, que o
      // CHECK titulo_saldo_na_faixa não pega)
      const respostas = await Promise.all([
        postBaixa(c, t1.id, payloadBaixa(c, 60_000, '2026-05-10')),
        postBaixa(c, t1.id, payloadBaixa(c, 60_000, '2026-05-10')),
      ]);
      const codigos = respostas.map((r) => r.statusCode).sort((a, b) => a - b);
      expect(codigos).toEqual([201, 409]);

      // a recusa é auditada com o motivo de modificação concorrente (D-R1)
      const recusas = eventosDe(c, 'titulo.baixa_recusada');
      expect(recusas).toHaveLength(1);
      expect(recusas[0]?.dados).toMatchObject({
        motivo: 'titulo_modificado_concorrentemente',
        valor_centavos: 60_000,
        saldo_lido_centavos: 100_000,
      });

      // invariante CA-16 preservada: saldo 400,00 e UMA baixa vigente de
      // 600,00 — o somatório 120.000 (Σ > valor) jamais é gravado
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(40_000);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('parcial');
      const vigentes = baixasNoBanco(c).filter(
        (b) => b.tituloId === t1.id && b.estornoLancamentoId === null,
      );
      expect(vigentes).toHaveLength(1);
      expect(vigentes.reduce((total, b) => total + b.valorCentavos, 0)).toBe(60_000);

      // rollback TOTAL da perdedora: lançamento e baixa recém-inseridos na
      // transação abortada foram desfeitos junto
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(partidasDoLancamentoNoBanco(c, vigentes[0]!.lancamentoId)).toHaveLength(2);
    } finally {
      await c.t.close();
    }
  });

  test('corrida de estornos: dois estornos da mesma baixa simultâneos — exatamente uma 201 e uma 409 "já estornado" (nunca 500); um único lançamento de estorno', async () => {
    const c = await prepararCenario('estorno-concorrente', dbComLeiturasAdiadas);
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      const t1 = await criarTituloViaApi(c);
      const paga = await postBaixa(c, t1.id, payloadBaixa(c, 50_000, '2026-05-10'));
      expect(paga.statusCode).toBe(201);
      const baixa = baixaSchema.parse(paga.json());

      // corrida DETERMÍSTICA (ver dbComLeiturasAdiadas): as duas leituras veem
      // a baixa ainda NÃO estornada; sem o catch da violação única (S-T014-3
      // espelhado) a perdedora estoura em `lancamento_estorno_de_uk` com 500
      // SEM trilha
      const respostas = await Promise.all([
        postEstornoBaixa(c, baixa.id, { data: '2026-05-15' }),
        postEstornoBaixa(c, baixa.id, { data: '2026-05-15' }),
      ]);
      const codigos = respostas.map((r) => r.statusCode).sort((a, b) => a - b);
      expect(codigos).toEqual([201, 409]);

      // a recusa (caminho de validação OU corrida no INSERT) é auditada como
      // "baixa já estornada" — mesma mensagem do caminho sequencial
      const recusa409 = respostas.find((r) => r.statusCode === 409)!;
      expect(erroResponseSchema.parse(recusa409.json()).erro).toMatch(/só pode ser estornada uma vez/i);
      const recusas = eventosDe(c, 'titulo.estorno_baixa_recusada');
      expect(recusas).toHaveLength(1);
      expect(String(recusas[0]?.dados && (recusas[0].dados as { motivo?: string }).motivo)).toMatch(
        /^baixa_ja_estornada/,
      );

      // UM único lançamento de estorno e título de volta a aberto (500,00)
      expect(lancamentosNoBanco(c).filter((l) => l.estornoDeId === baixa.lancamento_id)).toHaveLength(1);
      expect(lancamentosNoBanco(c)).toHaveLength(2); // baixa + estorno único
      expect(baixasNoBanco(c).find((b) => b.id === baixa.id)?.estornoLancamentoId).not.toBeNull();
      expect(tituloNoBanco(c, t1.id)?.saldoCentavos).toBe(50_000);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('aberto');
    } finally {
      await c.t.close();
    }
  });

  test('recusa por conta inexistente (criação de título e baixa) é auditada como as irmãs do mesmo fluxo; nada persistido', async () => {
    const c = await prepararCenario('conta-inexistente');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 5 });
      // dado real (CE-2): conta que EXISTE, mas em OUTRA empresa — a recusa
      // é "não existe nesta empresa", não id fantasma
      const outraEmpresa = criarEmpresaTeste(c.t.database.db, { razaoSocial: 'CE-2 Alheia' });
      const contaAlheia = criarContaTeste(c.t.database.db, {
        empresaId: outraEmpresa.id,
        codigo: '1.1.1',
        tipo: 'ativo',
      });

      const recusaTitulo = await postTitulo(c, {
        tipo: 'pagar',
        contraparte: 'Fornecedor CE-2',
        vencimento: '2026-05-10',
        valor_centavos: 10_000,
        conta_id: contaAlheia.id,
      });
      expect(recusaTitulo.statusCode).toBe(404);
      expect(erroResponseSchema.parse(recusaTitulo.json()).erro).toMatch(/não existe nesta empresa/i);
      expect(eventosDe(c, 'titulo.criacao_recusada')[0]?.dados).toMatchObject({
        motivo: 'conta_nao_encontrada',
        conta_id: contaAlheia.id,
      });

      const t1 = await criarTituloViaApi(c);
      const recusaBaixa = await postBaixa(c, t1.id, {
        ...payloadBaixa(c, 1_000, '2026-05-10'),
        conta_contrapartida_id: contaAlheia.id,
      });
      expect(recusaBaixa.statusCode).toBe(404);
      expect(erroResponseSchema.parse(recusaBaixa.json()).erro).toMatch(/não existe nesta empresa/i);
      expect(eventosDe(c, 'titulo.baixa_recusada')[0]?.dados).toMatchObject({
        motivo: 'conta_nao_encontrada',
        conta_id: contaAlheia.id,
      });

      // nenhuma das recusas persistiu escrita de negócio
      expect(baixasNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);
      expect(tituloNoBanco(c, t1.id)?.situacao).toBe('aberto');
    } finally {
      await c.t.close();
    }
  });
});
