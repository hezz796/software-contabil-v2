import { erroResponseSchema, lancamentoSchema } from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, lancamento, partida, type Conta, type Empresa } from '../../src/db/schema.ts';
import { criarContaTeste, criarPeriodoTeste, encerrarPeriodoTeste } from '../fixtures/contas.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestApp, type TestApp } from '../harness.ts';

/**
 * Lançamentos em partidas dobradas, imutabilidade e estorno (RF-07/RF-08,
 * R9/RK-4, CA-13/14/24/25/26/29, TASK-014).
 *
 * Um teste por critério de aceite; escrita sempre pelo contador ATRIBUIDO via
 * guard `exigirEscritaContabil` (admin/não-atribuído são CA-33/35/36 — já
 * cobertos em plano-contas.test.ts com o mesmo guard).
 */

interface Cenario {
  t: TestApp;
  empresa: Empresa;
  contador: { id: number; email: string };
  cookie: string;
  caixa: Conta;
  capital: Conta;
}

/** App + empresa + contador atribuído + duas contas (Caixa/Capital). */
async function prepararCenario(razaoSocial = 'Empresa Lançamentos'): Promise<Cenario> {
  const t = await createTestApp();
  const empresa = criarEmpresaTeste(t.database.db, { razaoSocial });
  const contador = await criarUsuarioTeste(t.database.db, {
    papel: 'contador',
    empresas: [empresa.id],
  });
  const { cookie } = await fazerLogin(t.app, contador.email);
  const caixa = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '1.1.1',
    descricao: 'Caixa',
    tipo: 'ativo',
  });
  const capital = criarContaTeste(t.database.db, {
    empresaId: empresa.id,
    codigo: '4.1.1',
    descricao: 'Capital social',
    tipo: 'patrimonio_liquido',
  });
  return { t, empresa, contador, cookie, caixa, capital };
}

function postLancamento(c: Cenario, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: '/lancamentos',
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postEstorno(c: Cenario, lancamentoId: number, payload: Record<string, unknown> = {}) {
  return c.t.app.inject({
    method: 'POST',
    url: `/lancamentos/${lancamentoId}/estorno`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function lancamentosNoBanco(c: Cenario) {
  return c.t.database.db.select().from(lancamento).all();
}

function partidasNoBanco(c: Cenario) {
  return c.t.database.db.select().from(partida).all();
}

function eventosDe(c: Cenario, acao: string) {
  return c.t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

/** Payload de lançamento padrão: D Caixa / C Capital pelo mesmo valor. */
function payloadEquilibrado(c: Cenario, centavos: number, data = '2026-03-15') {
  return {
    data,
    historico: 'Lançamento de teste',
    partidas: [
      { conta_id: c.caixa.id, natureza: 'D', valor_centavos: centavos },
      { conta_id: c.capital.id, natureza: 'C', valor_centavos: centavos },
    ],
  };
}

describe('lançamentos em partidas dobradas (RF-07, CA-13/CA-14/CA-24)', () => {
  test('RF-07 grava lançamento equilibrado com partidas, período resolvido no servidor e auditoria na mesma transação', async () => {
    const c = await prepararCenario('RF-07');
    try {
      const periodo = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 3,
      });

      const resposta = await postLancamento(c, {
        ...payloadEquilibrado(c, 100_000),
        historico: 'Aporte de capital',
      });
      expect(resposta.statusCode).toBe(201);
      const dto = lancamentoSchema.parse(resposta.json());
      expect(dto.empresa_id).toBe(c.empresa.id);
      // período NÃO vem do cliente: resolvido no servidor a partir da data (RF-04)
      expect(dto.periodo_id).toBe(periodo.id);
      expect(dto.data).toBe('2026-03-15');
      expect(dto.estorno_de_id).toBeNull();
      expect(dto.criado_por).toBe(c.contador.id);
      expect(dto.partidas).toEqual([
        { conta_id: c.caixa.id, natureza: 'D', valor_centavos: 100_000 },
        { conta_id: c.capital.id, natureza: 'C', valor_centavos: 100_000 },
      ]);

      // persistido: 1 lançamento + 2 partidas
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(partidasNoBanco(c)).toHaveLength(2);

      // trilha na MESMA transação da escrita (R8/RF-05)
      const criacao = eventosDe(c, 'lancamento.criacao').at(-1);
      expect(criacao).toBeDefined();
      expect(criacao?.usuarioId).toBe(c.contador.id);
      expect(criacao?.empresaId).toBe(c.empresa.id);
      expect(criacao?.objetoId).toBe(String(dto.id));
      expect(criacao?.dados).toMatchObject({
        debitos_centavos: 100_000,
        creditos_centavos: 100_000,
      });
    } finally {
      await c.t.close();
    }
  });

  test('CA-13 desequilíbrio (débitos R$ 100,00 x créditos R$ 90,00) é recusado citando a diferença; nada persistido', async () => {
    const c = await prepararCenario('CA-13');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });

      const resposta = await postLancamento(c, {
        data: '2026-03-15',
        historico: 'Desequilibrado',
        partidas: [
          { conta_id: c.caixa.id, natureza: 'D', valor_centavos: 10_000 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: 9_000 },
        ],
      });
      expect(resposta.statusCode).toBe(400);
      const erro = erroResponseSchema.parse(resposta.json()).erro;
      expect(erro).toMatch(/desequilibrado/i);
      expect(erro).toMatch(/diferença/i);
      // a mensagem cita os totais e a diferença de R$ 10,00
      expect(erro).toMatch(/100,00/);
      expect(erro).toMatch(/90,00/);
      expect(erro).toMatch(/10,00/);

      // nada persistido: o razão permanece sem o lançamento (CE-1)
      expect(lancamentosNoBanco(c)).toHaveLength(0);
      expect(partidasNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'lancamento.criacao')).toHaveLength(0);

      // controle: o MESMO lançamento equilibrado é aceito (a recusa não deixou lixo)
      const correcao = await postLancamento(c, {
        data: '2026-03-15',
        historico: 'Corrigido',
        partidas: [
          { conta_id: c.caixa.id, natureza: 'D', valor_centavos: 10_000 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: 10_000 },
        ],
      });
      expect(correcao.statusCode).toBe(201);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-14 recusas: uma partida, valor zero, valor negativo, partida sem conta, conta inexistente e data inválida — nada persistido', async () => {
    const c = await prepararCenario('CA-14');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });
      criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 2,
        encerradoEm: '2026-03-05T12:00:00.000Z',
      });

      // (a) apenas uma partida
      const umaPartida = await postLancamento(c, {
        data: '2026-03-10',
        historico: 'Uma partida só',
        partidas: [{ conta_id: c.caixa.id, natureza: 'D', valor_centavos: 10_000 }],
      });
      expect(umaPartida.statusCode).toBe(400);
      expect(erroResponseSchema.parse(umaPartida.json()).erro).toMatch(/duas partidas/i);

      // (b) valor zero
      const valorZero = await postLancamento(c, {
        data: '2026-03-10',
        historico: 'Valor zero',
        partidas: [
          { conta_id: c.caixa.id, natureza: 'D', valor_centavos: 0 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: 0 },
        ],
      });
      expect(valorZero.statusCode).toBe(400);
      expect(erroResponseSchema.parse(valorZero.json()).erro).toMatch(/maior que zero/i);

      // (c) valor negativo
      const valorNegativo = await postLancamento(c, {
        data: '2026-03-10',
        historico: 'Valor negativo',
        partidas: [
          { conta_id: c.caixa.id, natureza: 'D', valor_centavos: -500 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: -500 },
        ],
      });
      expect(valorNegativo.statusCode).toBe(400);
      expect(erroResponseSchema.parse(valorNegativo.json()).erro).toMatch(/maior que zero/i);

      // (d) partida sem conta
      const semConta = await postLancamento(c, {
        data: '2026-03-10',
        historico: 'Sem conta',
        partidas: [
          { natureza: 'D', valor_centavos: 10_000 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: 10_000 },
        ],
      });
      expect(semConta.statusCode).toBe(400);
      expect(erroResponseSchema.parse(semConta.json()).erro).toMatch(/conta/i);

      // (d') conta inexistente na empresa (CE-2)
      const contaInexistente = await postLancamento(c, {
        data: '2026-03-10',
        historico: 'Conta inexistente',
        partidas: [
          { conta_id: 999_999, natureza: 'D', valor_centavos: 10_000 },
          { conta_id: c.capital.id, natureza: 'C', valor_centavos: 10_000 },
        ],
      });
      expect(contaInexistente.statusCode).toBe(404);
      expect(erroResponseSchema.parse(contaInexistente.json()).erro).toMatch(/não existe nesta empresa/i);

      // (e) data em formato inválido
      const dataComBarra = await postLancamento(c, {
        ...payloadEquilibrado(c, 10_000),
        data: '15/03/2026',
      });
      expect(dataComBarra.statusCode).toBe(400);
      expect(erroResponseSchema.parse(dataComBarra.json()).erro).toMatch(/AAAA-MM-DD/i);
      const dataCurta = await postLancamento(c, {
        ...payloadEquilibrado(c, 10_000),
        data: '2026-3-5',
      });
      expect(dataCurta.statusCode).toBe(400);

      // (f) data em período encerrado (ver CA-24 para o caso completo)
      const periodoEncerrado = await postLancamento(c, {
        ...payloadEquilibrado(c, 10_000),
        data: '2026-02-15',
      });
      expect(periodoEncerrado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(periodoEncerrado.json()).erro).toMatch(/encerrado/i);

      // nenhuma das recusas persistiu algo
      expect(lancamentosNoBanco(c)).toHaveLength(0);
      expect(partidasNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'lancamento.criacao')).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('CA-24 período M encerrado: lançamento e estorno com data em M recusados com mensagem de período encerrado; data em M+1 aceita', async () => {
    const c = await prepararCenario('CA-24');
    try {
      // M = 03/2026 encerrado; M+1 = 04/2026 aberto
      criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 3,
        encerradoEm: '2026-04-01T12:00:00.000Z',
      });
      const abril = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 4,
      });

      // lançamento com data em M+1 (aberto) é aceito
      const emAberto = await postLancamento(c, payloadEquilibrado(c, 50_000, '2026-04-10'));
      expect(emAberto.statusCode).toBe(201);
      const original = lancamentoSchema.parse(emAberto.json());

      // lançamento com data em M (encerrado) é recusado (CE-3)
      const emEncerrado = await postLancamento(c, payloadEquilibrado(c, 50_000, '2026-03-15'));
      expect(emEncerrado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(emEncerrado.json()).erro).toMatch(/encerrado/i);

      // estorno com data em M (encerrado) também é recusado — inclusive estorno (RF-09)
      const estornoEncerrado = await postEstorno(c, original.id, { data: '2026-03-20' });
      expect(estornoEncerrado.statusCode).toBe(409);
      expect(erroResponseSchema.parse(estornoEncerrado.json()).erro).toMatch(/encerrado/i);
      expect(lancamentosNoBanco(c).some((linha) => linha.estornoDeId === original.id)).toBe(false);
      const recusa = eventosDe(c, 'lancamento.estorno_recusado').at(-1);
      expect(recusa?.dados).toMatchObject({ motivo: 'periodo_encerrado', data: '2026-03-20' });

      // estorno com data em M+1 (aberto) é aceito
      const estornoAberto = await postEstorno(c, original.id, { data: '2026-04-20' });
      expect(estornoAberto.statusCode).toBe(201);
      const estorno = lancamentoSchema.parse(estornoAberto.json());
      expect(estorno.estorno_de_id).toBe(original.id);
      expect(estorno.data).toBe('2026-04-20');
      expect(estorno.periodo_id).toBe(abril.id);

      // estado final: original + estorno, 4 partidas
      expect(lancamentosNoBanco(c)).toHaveLength(2);
      expect(partidasNoBanco(c)).toHaveLength(4);
    } finally {
      await c.t.close();
    }
  });

  test('CA-24 no banco: com dados reais gravados enquanto aberto, o INSERT direto em lançamento no período depois encerrado é abortado pelo trigger lancamento_no_periodo_encerrado', async () => {
    const c = await prepararCenario('CA-24-banco');
    try {
      // período M (03/2026) ABERTO + lançamento real gravado pelo caminho de
      // produção (serviço) — pré-condição comprovada, não banco vazio
      const periodo = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 3,
      });
      const real = await postLancamento(c, payloadEquilibrado(c, 100_000));
      expect(real.statusCode).toBe(201);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(partidasNoBanco(c)).toHaveLength(2);

      // transição legítima de estado (fixture: mesmo caminho de estado do
      // produto — UPDATE da marca com o período ainda aberto)
      encerrarPeriodoTeste(c.t.database.db, periodo.id);

      // INSERT direto (fora da aplicação) no período encerrado é abortado NO
      // BANCO com a mensagem específica do trigger 0006 — vale mesmo com bug
      // de aplicação (RF-08/RF-09 invariante no banco)
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO lancamento (empresa_id, periodo_id, data, historico, estorno_de_id, criado_por, criado_em)
             VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            c.empresa.id,
            periodo.id,
            '2026-03-25',
            'INSERT direto em período encerrado',
            c.contador.id,
            new Date().toISOString(),
          ),
      ).toThrow(/periodo encerrado/i);

      // estado inalterado: só o lançamento real gravado enquanto aberto
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(partidasNoBanco(c)).toHaveLength(2);
      expect(lancamentosNoBanco(c)[0]?.historico).toBe('Lançamento de teste');
    } finally {
      await c.t.close();
    }
  });
});

describe('imutabilidade e estorno (RF-08, R9, CA-25/CA-26/CA-29)', () => {
  test('CA-25 lançamento gravado não pode ser editado nem excluído: rotas recusam orientando ao estorno e triggers abortam UPDATE/DELETE diretos', async () => {
    const c = await prepararCenario('CA-25');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });
      const criado = await postLancamento(c, payloadEquilibrado(c, 100_000));
      expect(criado.statusCode).toBe(201);
      const dto = lancamentoSchema.parse(criado.json());

      // não existe ação no produto que edite/exclua: PATCH e DELETE recusam
      // com orientação ao estorno (RK-4) e auditam a tentativa
      const patch = await c.t.app.inject({
        method: 'PATCH',
        url: `/lancamentos/${dto.id}`,
        headers: { cookie: c.cookie },
        payload: { empresa_id: c.empresa.id, historico: 'editado' },
      });
      expect(patch.statusCode).toBe(405);
      expect(erroResponseSchema.parse(patch.json()).erro).toMatch(/estorno/i);

      const del = await c.t.app.inject({
        method: 'DELETE',
        url: `/lancamentos/${dto.id}?empresa_id=${c.empresa.id}`,
        headers: { cookie: c.cookie },
      });
      expect(del.statusCode).toBe(405);
      expect(erroResponseSchema.parse(del.json()).erro).toMatch(/estorno/i);
      expect(eventosDe(c, 'lancamento.alteracao_recusada')).toHaveLength(1);
      expect(eventosDe(c, 'lancamento.exclusao_recusada')).toHaveLength(1);

      // tentativa DIRETA no banco (fora do produto): triggers abortam (CA-25/R9)
      expect(() =>
        c.t.database.sqlite
          .prepare('UPDATE lancamento SET historico = ? WHERE id = ?')
          .run('hackeado', dto.id),
      ).toThrow(/imutavel/i);
      expect(() =>
        c.t.database.sqlite.prepare('DELETE FROM lancamento WHERE id = ?').run(dto.id),
      ).toThrow(/imutavel/i);
      expect(() =>
        c.t.database.sqlite
          .prepare('UPDATE partida SET valor_centavos = 1 WHERE lancamento_id = ?')
          .run(dto.id),
      ).toThrow(/imutavel/i);
      expect(() =>
        c.t.database.sqlite.prepare('DELETE FROM partida WHERE lancamento_id = ?').run(dto.id),
      ).toThrow(/imutavel/i);

      // após todas as tentativas, lançamento e partidas permanecem intactos
      const linha = lancamentosNoBanco(c).find((item) => item.id === dto.id);
      expect(linha?.historico).toBe('Lançamento de teste');
      const partidas = partidasNoBanco(c).filter((p) => p.lancamentoId === dto.id);
      expect(partidas.map((p) => p.valorCentavos).sort()).toEqual([100_000, 100_000]);
    } finally {
      await c.t.close();
    }
  });

  test('CA-26 estorno é único por origem: estornar lançamento já estornado é recusado; dois lançamentos distintos do mesmo período estornam normalmente', async () => {
    const c = await prepararCenario('CA-26');
    try {
      const periodo = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.empresa.id,
        ano: 2026,
        mes: 3,
      });

      const l1 = lancamentoSchema.parse(
        (await postLancamento(c, payloadEquilibrado(c, 100_000, '2026-03-10'))).json(),
      );
      const l2 = lancamentoSchema.parse(
        (await postLancamento(c, payloadEquilibrado(c, 30_000, '2026-03-12'))).json(),
      );

      // estornar L1: lançamento inverso vinculado (naturezas trocadas, mesmos valores)
      const estorno1 = await postEstorno(c, l1.id, { data: '2026-03-20' });
      expect(estorno1.statusCode).toBe(201);
      const dtoEstorno = lancamentoSchema.parse(estorno1.json());
      expect(dtoEstorno.estorno_de_id).toBe(l1.id);
      expect(dtoEstorno.partidas).toEqual([
        { conta_id: c.caixa.id, natureza: 'C', valor_centavos: 100_000 },
        { conta_id: c.capital.id, natureza: 'D', valor_centavos: 100_000 },
      ]);

      // estornar L1 de novo: recusado com mensagem (CE-5)
      const estornoRepetido = await postEstorno(c, l1.id, { data: '2026-03-21' });
      expect(estornoRepetido.statusCode).toBe(409);
      expect(erroResponseSchema.parse(estornoRepetido.json()).erro).toMatch(/estornado/i);
      expect(eventosDe(c, 'lancamento.estorno_recusado').at(-1)?.dados).toMatchObject({
        motivo: 'ja_estornado',
      });
      expect(lancamentosNoBanco(c).filter((linha) => linha.estornoDeId === l1.id)).toHaveLength(1);

      // retrocesso no BANCO: o índice único `lancamento_estorno_de_uk` impede
      // um segundo estorno mesmo por caminho direto (CA-26 + corrida)
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO lancamento (empresa_id, periodo_id, data, historico, estorno_de_id, criado_por, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            c.empresa.id,
            periodo.id,
            '2026-03-22',
            'estorno duplicado direto',
            l1.id,
            c.contador.id,
            new Date().toISOString(),
          ),
      ).toThrow(/UNIQUE/i);

      // estornar L2 (outro lançamento do MESMO período): funciona normalmente
      const estorno2 = await postEstorno(c, l2.id, { data: '2026-03-23' });
      expect(estorno2.statusCode).toBe(201);
      expect(lancamentoSchema.parse(estorno2.json()).estorno_de_id).toBe(l2.id);

      // 4 lançamentos (2 originais + 2 estornos) e 8 partidas
      expect(lancamentosNoBanco(c)).toHaveLength(4);
      expect(partidasNoBanco(c)).toHaveLength(8);
    } finally {
      await c.t.close();
    }
  });

  test('CA-29 falha de banco no meio da gravação: mensagem de erro ao usuário e nenhum registro parcial ou duplicado após restaurar', async () => {
    const c = await prepararCenario('CA-29');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });

      // injeta falha de banco: trigger aborta o INSERT da partidas com 999999
      c.t.database.sqlite.exec(
        `CREATE TRIGGER partida_falha_injetada BEFORE INSERT ON partida
         WHEN NEW.valor_centavos = 999999
         BEGIN SELECT RAISE(ABORT, 'falha simulada de banco de dados'); END`,
      );

      const comFalha = await postLancamento(c, payloadEquilibrado(c, 999_999));
      expect(comFalha.statusCode).toBe(500);
      expect(erroResponseSchema.parse(comFalha.json()).erro).toMatch(/erro/i);

      // a transação desfez TUDO: nem lançamento, nem partidas, nem trilha órfã
      expect(lancamentosNoBanco(c)).toHaveLength(0);
      expect(partidasNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'lancamento.criacao')).toHaveLength(0);

      // "restaurar a dependência" e reenviar: grava exatamente UMA vez
      c.t.database.sqlite.exec('DROP TRIGGER partida_falha_injetada');
      const semFalha = await postLancamento(c, payloadEquilibrado(c, 999_999));
      expect(semFalha.statusCode).toBe(201);
      expect(lancamentosNoBanco(c)).toHaveLength(1);
      expect(partidasNoBanco(c)).toHaveLength(2);
      expect(eventosDe(c, 'lancamento.criacao')).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('partida sem lançamento é recusada pela foreign key do banco', async () => {
    const c = await prepararCenario('FK');
    try {
      criarPeriodoTeste(c.t.database.db, { empresaId: c.empresa.id, ano: 2026, mes: 3 });

      // SQL direto: partida apontando para lançamento inexistente é abortada
      // pela FK `partida.lancamento_id -> lancamento.id` (T014-F-1: a
      // integridade do par é garantida NO BANCO, não só pela aplicação)
      expect(() =>
        c.t.database.sqlite
          .prepare(
            'INSERT INTO partida (lancamento_id, conta_id, natureza, valor_centavos) VALUES (?, ?, ?, ?)',
          )
          .run(999_999, c.caixa.id, 'D', 1_000),
      ).toThrow(/FOREIGN KEY/i);

      // o mesmo caminho via Drizzle (por onde passam os serviços)
      expect(() =>
        c.t.database.db
          .insert(partida)
          .values({ lancamentoId: 999_999, contaId: c.caixa.id, natureza: 'D', valorCentavos: 1_000 })
          .run(),
      ).toThrow(/FOREIGN KEY/i);

      // nenhuma das tentativas persistiu algo
      expect(partidasNoBanco(c)).toHaveLength(0);
      expect(lancamentosNoBanco(c)).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });
});
