import { encerramentoPeriodoResponseSchema, erroResponseSchema } from '@sistema-contabil/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { auditEvent, lancamento, partida, periodoContabil, type Conta } from '../../src/db/schema.ts';
import { criarLancamento } from '../../src/services/lancamentos.ts';
import { criarPeriodoTeste } from '../fixtures/contas.ts';
import { criarFix01, type Fix01 } from '../fixtures/fix-01.ts';
import { criarUsuarioTeste, fazerLogin, type UsuarioTeste } from '../fixtures/seguranca.ts';
import { createTestApp, type TestApp } from '../harness.ts';

/**
 * Encerramento de período e exercício (RF-09/H12, TASK-015; CA-31/CA-32).
 *
 * Semântica UNIFICADA (decisão humana de 2026-10-21 — `TASK-015.json`): TODO
 * encerramento (mês comum ou 12º) gera o lançamento que zera as contas de
 * resultado e leva o resultado líquido à conta de PL (`conta_resultado_id`),
 * datado no último dia do período, com o período **ainda aberto** — o CA-31 e
 * o CA-32 usam o mesmo verbo ("zera as contas de resultado") e por isso a
 * mesma coluna é assertada nos dois (`acumulado_centavos = 0`). Período sem
 * resultado fecha sem lançamento (nada a transferir).
 *
 * O **exercício** (12º período do ano-calendário — H12) é o fechamento que,
 * além disso: exige os 11 períodos anteriores encerrados, audita
 * `exercicio.encerramento` e devolve `exercicio_encerrado: true`.
 *
 * Ambiguidade CA-24 x CA-32: a ação de encerramento é uma **operação atômica**
 * — grava o lançamento de encerramento com o período ainda aberto e só então
 * o marca como encerrado, tudo numa única transação (`services/encerramento.ts`
 * e `TASK-015.json:assumptions`). Depois de fechado, o trigger
 * `lancamento_no_periodo_encerrado` (0006) aborta qualquer INSERT novo; o
 * teste "CA-24 no banco" de lancamentos.test.ts prova isso com dados reais
 * anteriores.
 */

interface CenarioEncerramento {
  t: TestApp;
  f: Fix01;
  admin: UsuarioTeste;
  adminCookie: string;
}

/** FIX-01 + administrador sem atribuição (para a variação de permissão F13). */
async function preparar(t: TestApp, opcoes: { mes?: number } = {}): Promise<CenarioEncerramento> {
  const f = await criarFix01(t.app, t.database.db, { mes: opcoes.mes ?? 3 });
  const admin = await criarUsuarioTeste(t.database.db, {
    email: 'admin-encerramento@escritorio.test',
    papel: 'administrador',
  });
  const { cookie: adminCookie } = await fazerLogin(t.app, admin.email);
  return { t, f, admin, adminCookie };
}

function postEncerramento(
  c: CenarioEncerramento,
  periodoId: number,
  payload: Record<string, unknown>,
  cookie = c.f.cookie,
) {
  return c.t.app.inject({
    method: 'POST',
    url: `/periodos/${periodoId}/encerramento`,
    headers: { cookie },
    payload: { empresa_id: c.f.empresa.id, ...payload },
  });
}

function eventosDe(c: CenarioEncerramento, acao: string) {
  return c.t.database.db
    .select()
    .from(auditEvent)
    .all()
    .filter((evento) => evento.acao === acao);
}

function periodosNoBanco(c: CenarioEncerramento) {
  return c.t.database.db.select().from(periodoContabil).all();
}

/** Linha do balancete para uma conta (ou `undefined` quando sem movimento). */
function linhaNoBalancete(
  json: { linhas: { conta_id: number; acumulado_centavos: number }[] },
  conta: Conta,
) {
  return json.linhas.find((linha) => linha.conta_id === conta.id);
}

describe('encerramento de período — fechamento mensal (RF-09, CA-31)', () => {
  test('CA-31 fechamento zera contas de resultado no balancete seguinte (acumulado = 0, discriminado contra o caso sem encerramento) e mantém permanentes; admin recusado 403 auditado nada alterado; contador executa; re-encerrar 409', async () => {
    const t = await createTestApp();
    const c = await preparar(t, { mes: 3 });
    try {
      // Período seguinte criado ANTES do encerramento: permite medir o
      // balancete de abril COM e SEM o encerramento no mesmo teste.
      const abril = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.f.empresa.id,
        ano: 2026,
        mes: 4,
      });
      const balanceteDeAbril = async () => {
        const resposta = await c.t.app.inject({
          method: 'GET',
          url: `/relatorios/balancete?empresa_id=${c.f.empresa.id}&periodo_id=${abril.id}`,
          headers: { cookie: c.f.cookie },
        });
        expect(resposta.statusCode).toBe(200);
        return resposta.json();
      };

      // ---- PRÉ-CONDIÇÃO COMPROVADA: balancete de abril ANTES do encerramento
      // mostra as contas de resultado com saldo a zerar (CA-31 exige zerar;
      // se estes valores não existissem, "zerar" seria trivial) ----
      const antes = await balanceteDeAbril();
      expect(linhaNoBalancete(antes, c.f.despesas)?.acumulado_centavos).toBe(60_000); // 600,00 (D)
      expect(linhaNoBalancete(antes, c.f.receita)?.acumulado_centavos).toBe(-70_000); // 700,00 (C)

      // ---- variação de permissão: administrador é recusado (F13/RF-09) ----
      const tentativaAdmin = await postEncerramento(
        c,
        c.f.periodo.id,
        { conta_resultado_id: c.f.contaResultado.id },
        c.adminCookie,
      );
      expect(tentativaAdmin.statusCode).toBe(403);
      expect(erroResponseSchema.parse(tentativaAdmin.json()).erro).toMatch(
        /administrador não possui escrita contábil/i,
      );

      // auditada: tentativa negada registrada com motivo específico
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1);
      expect(negada).toBeDefined();
      expect(negada?.usuarioId).toBe(c.admin.id);
      expect(negada?.empresaId).toBe(c.f.empresa.id);
      expect(negada?.objetoTipo).toBe('periodo_contabil');
      expect(negada?.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });

      // nada alterado: período ainda aberto, nenhum lançamento novo, balancete
      // de abril continua com os saldos pré-existentes (60.000 / −70.000)
      const periodoAposAdmin = periodosNoBanco(c).find((p) => p.id === c.f.periodo.id);
      expect(periodoAposAdmin?.encerradoEm).toBeNull();
      const lancamentosAposAdmin = c.t.database.db.select().from(lancamento).all();
      expect(lancamentosAposAdmin).toHaveLength(5); // apenas L1..L5
      expect(lancamentosAposAdmin.some((l) => l.historico.includes('Encerramento'))).toBe(false);
      const aindaAntes = await balanceteDeAbril();
      expect(linhaNoBalancete(aindaAntes, c.f.despesas)?.acumulado_centavos).toBe(60_000);
      expect(linhaNoBalancete(aindaAntes, c.f.receita)?.acumulado_centavos).toBe(-70_000);

      // ---- contador com escrita ativa executa normalmente ----
      const encerramento = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.contaResultado.id,
      });
      expect(encerramento.statusCode).toBe(200);
      const corpo = encerramentoPeriodoResponseSchema.parse(encerramento.json());
      expect(corpo.periodo.situacao).toBe('encerrado');
      expect(corpo.exercicio_encerrado).toBe(false); // mês 3 não é exercício
      // resultado: Σ(D−C) das contas de resultado = 600 − 700 = −100,00 (lucro)
      expect(corpo.resultado_centavos).toBe(-10_000);
      // fechamento gera o lançamento que zera o resultado e transfere ao PL
      expect(corpo.lancamento_encerramento_id).not.toBeNull();

      // auditada (RF-05): encerramento registrado com o contador e a transferência
      const evento = eventosDe(c, 'periodo.encerramento').at(-1);
      expect(evento).toBeDefined();
      expect(evento?.usuarioId).toBe(c.f.contador.id);
      expect(evento?.empresaId).toBe(c.f.empresa.id);
      expect(evento?.dados).toMatchObject({
        ano: 2026,
        mes: 3,
        exercicio: false,
        transferiu_resultado: true,
        resultado_centavos: -10_000,
        lancamento_encerramento_id: corpo.lancamento_encerramento_id,
      });

      // o lançamento de encerramento fecha em ZERO: débitos = créditos
      // (Receita debitada 700,00 = Despesas creditada 600,00 + PL creditado 100,00)
      const partidasEncerramento = c.t.database.db
        .select()
        .from(partida)
        .all()
        .filter((p) => p.lancamentoId === corpo.lancamento_encerramento_id);
      const somar = (natureza: 'D' | 'C'): number =>
        partidasEncerramento
          .filter((p) => p.natureza === natureza)
          .reduce((total, p) => total + p.valorCentavos, 0);
      expect(somar('D')).toBe(70_000);
      expect(somar('C')).toBe(70_000);
      const de = (conta: Conta) => partidasEncerramento.find((p) => p.contaId === conta.id);
      expect(de(c.f.despesas)).toMatchObject({ natureza: 'C', valorCentavos: 60_000 });
      expect(de(c.f.receita)).toMatchObject({ natureza: 'D', valorCentavos: 70_000 });
      expect(de(c.f.contaResultado)).toMatchObject({ natureza: 'C', valorCentavos: 10_000 });

      // datado no último dia do período (03/2026), lançado com período aberto
      const lancamentoEncerramento = c.t.database.db
        .select()
        .from(lancamento)
        .all()
        .find((l) => l.id === corpo.lancamento_encerramento_id);
      expect(lancamentoEncerramento?.data).toBe('2026-03-31');
      expect(lancamentoEncerramento?.periodoId).toBe(c.f.periodo.id);

      // 6 lançamentos: L1..L5 + encerramento
      const lancamentosAposEncerramento = c.t.database.db.select().from(lancamento).all();
      expect(lancamentosAposEncerramento).toHaveLength(6);

      // ---- balancete do mês seguinte (04/2026) DEPOIS do encerramento:
      // contas de resultado com acumulado ZERO (CA-31) — o mesmo valor que a
      // asserção acima mostrou como 60.000/−70.000 SEM o encerramento ----
      const depois = await balanceteDeAbril();
      expect(linhaNoBalancete(depois, c.f.despesas)?.acumulado_centavos).toBe(0);
      expect(linhaNoBalancete(depois, c.f.receita)?.acumulado_centavos).toBe(0);
      // permanentes mantidos (CA-31: Caixa 900,00; Cliente 400,00; Fornecedor
      // 200,00; Capital 1.000,00)
      expect(linhaNoBalancete(depois, c.f.caixa)?.acumulado_centavos).toBe(90_000);
      expect(linhaNoBalancete(depois, c.f.cliente)?.acumulado_centavos).toBe(40_000);
      expect(linhaNoBalancete(depois, c.f.fornecedor)?.acumulado_centavos).toBe(-20_000);
      expect(linhaNoBalancete(depois, c.f.capital)?.acumulado_centavos).toBe(-100_000);
      // a conta de PL recebeu o lucro de 100,00 (crédito → acumulado −10.000)
      expect(linhaNoBalancete(depois, c.f.contaResultado)?.acumulado_centavos).toBe(-10_000);

      // re-encerrar é recusado (encerramento é uma ação única — RF-09)
      const repetido = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.contaResultado.id,
      });
      expect(repetido.statusCode).toBe(409);
      expect(erroResponseSchema.parse(repetido.json()).erro).toMatch(/já está encerrado/i);
      expect(eventosDe(c, 'periodo.encerramento_recusado').at(-1)?.dados).toMatchObject({
        motivo: 'ja_encerrado',
      });
    } finally {
      await t.close();
    }
  });

  test('resultado líquido zero COM movimento: encerramento gera lançamento que zera as contas de resultado no balancete seguinte, fecha em zero sem linha de PL e dispensa conta_resultado_id; período sem movimento algum continua sem lançamento', async () => {
    const t = await createTestApp();
    const c = await preparar(t, { mes: 3 });
    try {
      // FIX-01: Despesas 600,00 (D) e Receita 700,00 (C) => líquido −100,00.
      // Um lançamento adicional de Despesas 100,00 iguala as duas contas:
      // Receita 700,00 (C) = Despesas 700,00 (D) => LÍQUIDO ZERO, mas as duas
      // contas de resultado seguem com acumulado NÃO nulo — é o caso que o
      // CA-31 manda zerar no balancete seguinte.
      await criarLancamento(
        c.t.database.db,
        {
          empresaId: c.f.empresa.id,
          data: '2026-03-28',
          historico: 'Despesa adicional que zera o resultado líquido',
          partidas: [
            { contaId: c.f.despesas.id, natureza: 'D', valorCentavos: 10_000 },
            { contaId: c.f.fornecedor.id, natureza: 'C', valorCentavos: 10_000 },
          ],
        },
        c.f.contador.id,
      );

      // Período seguinte criado ANTES do encerramento (mesma técnica do CA-31:
      // medir antes e depois na mesma execução).
      const abril = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.f.empresa.id,
        ano: 2026,
        mes: 4,
      });
      const balanceteDeAbril = async () => {
        const resposta = await c.t.app.inject({
          method: 'GET',
          url: `/relatorios/balancete?empresa_id=${c.f.empresa.id}&periodo_id=${abril.id}`,
          headers: { cookie: c.f.cookie },
        });
        expect(resposta.statusCode).toBe(200);
        return resposta.json();
      };

      // PRÉ-CONDIÇÃO comprovada: líquido zero (70.000 − 70.000), mas as DUAS
      // contas de resultado têm acumulado bruto não nulo — se não existissem,
      // "zerar" seria trivial.
      const antes = await balanceteDeAbril();
      expect(linhaNoBalancete(antes, c.f.despesas)?.acumulado_centavos).toBe(70_000); // 700,00 (D)
      expect(linhaNoBalancete(antes, c.f.receita)?.acumulado_centavos).toBe(-70_000); // 700,00 (C)

      // líquido zero => encerra SEM conta_resultado_id (não há o que transferir)
      const encerramento = await postEncerramento(c, c.f.periodo.id, {});
      expect(encerramento.statusCode).toBe(200);
      const corpo = encerramentoPeriodoResponseSchema.parse(encerramento.json());
      expect(corpo.resultado_centavos).toBe(0);
      // o lançamento de encerramento EXISTE mesmo com líquido zero (zeragem)
      expect(corpo.lancamento_encerramento_id).not.toBeNull();

      // o lançamento fecha em zero SEM linha de PL: só as inversões das duas
      // contas de resultado (débitos 700,00 = créditos 700,00)
      const partidasEncerramento = c.t.database.db
        .select()
        .from(partida)
        .all()
        .filter((p) => p.lancamentoId === corpo.lancamento_encerramento_id);
      expect(partidasEncerramento).toHaveLength(2); // nenhuma linha de PL
      const somar = (natureza: 'D' | 'C'): number =>
        partidasEncerramento
          .filter((p) => p.natureza === natureza)
          .reduce((total, p) => total + p.valorCentavos, 0);
      expect(somar('D')).toBe(70_000);
      expect(somar('C')).toBe(70_000);
      const de = (conta: Conta) => partidasEncerramento.find((p) => p.contaId === conta.id);
      expect(de(c.f.despesas)).toMatchObject({ natureza: 'C', valorCentavos: 70_000 });
      expect(de(c.f.receita)).toMatchObject({ natureza: 'D', valorCentavos: 70_000 });
      // ausência da linha de PL: a contaResultado não tem nenhuma partida
      expect(partidasEncerramento.some((p) => p.contaId === c.f.contaResultado.id)).toBe(false);

      // DEPOIS: balancete de abril zera as DUAS contas de resultado (discrimina:
      // acima medido como 70.000/−70.000 no MESMO teste)
      const depois = await balanceteDeAbril();
      expect(linhaNoBalancete(depois, c.f.despesas)?.acumulado_centavos).toBe(0);
      expect(linhaNoBalancete(depois, c.f.receita)?.acumulado_centavos).toBe(0);
      // conta de PL sem movimento algum: fora do balancete (nenhuma linha)
      expect(linhaNoBalancete(depois, c.f.contaResultado)).toBeUndefined();

      // 7 lançamentos: L1..L5 + ajuste + encerramento
      expect(c.t.database.db.select().from(lancamento).all()).toHaveLength(7);

      // outro lado da moeda: período SEM movimento algum => continua sem
      // lançamento (nada a zerar), ainda que o fechamento ocorra
      const vazio = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.f.empresa.id,
        ano: 2025,
        mes: 9,
      });
      const encerramentoVazio = await postEncerramento(c, vazio.id, {});
      expect(encerramentoVazio.statusCode).toBe(200);
      const corpoVazio = encerramentoPeriodoResponseSchema.parse(encerramentoVazio.json());
      expect(corpoVazio.resultado_centavos).toBe(0);
      expect(corpoVazio.lancamento_encerramento_id).toBeNull();
      expect(
        c.t.database.db.select().from(lancamento).all().filter((l) => l.periodoId === vazio.id),
      ).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  test('com resultado, o fechamento de um mês comum também exige conta de PL (ausente ou tipo inválido = recusa específica e nada alterado); período sem resultado fecha sem lançamento', async () => {
    const t = await createTestApp();
    const c = await preparar(t, { mes: 3 });
    try {
      // sem conta de destino e COM resultado: recusa específica (nada alterado)
      const semConta = await postEncerramento(c, c.f.periodo.id, {});
      expect(semConta.statusCode).toBe(400);
      expect(erroResponseSchema.parse(semConta.json()).erro).toMatch(/conta_resultado_id/i);
      expect(periodosNoBanco(c).find((p) => p.id === c.f.periodo.id)?.encerradoEm).toBeNull();
      expect(c.t.database.db.select().from(lancamento).all()).toHaveLength(5);

      // conta de destino de tipo inválido (despesa): recusa citando patrimônio líquido
      const tipoInvalido = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.despesas.id,
      });
      expect(tipoInvalido.statusCode).toBe(400);
      expect(erroResponseSchema.parse(tipoInvalido.json()).erro).toMatch(
        /patrimônio líquido/i,
      );
      expect(periodosNoBanco(c).find((p) => p.id === c.f.periodo.id)?.encerradoEm).toBeNull();

      // período SEM movimento algum (ano anterior ao FIX-01): resultado zero,
      // fecha sem lançamento (nada a transferir)
      const vazio = criarPeriodoTeste(c.t.database.db, {
        empresaId: c.f.empresa.id,
        ano: 2025,
        mes: 7,
      });
      const encerramentoVazio = await postEncerramento(c, vazio.id, {});
      expect(encerramentoVazio.statusCode).toBe(200);
      const corpo = encerramentoPeriodoResponseSchema.parse(encerramentoVazio.json());
      expect(corpo.resultado_centavos).toBe(0);
      expect(corpo.lancamento_encerramento_id).toBeNull();
      const lancamentosVazio = c.t.database.db
        .select()
        .from(lancamento)
        .all()
        .filter((l) => l.periodoId === vazio.id);
      expect(lancamentosVazio).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  test('encerramento do banco: o lançamento entra com o período aberto; depois de fechado, trigger periodo_encerramento_unico aborta a marca e trigger lancamento_no_periodo_encerrado aborta INSERT direto', async () => {
    const t = await createTestApp();
    const c = await preparar(t, { mes: 3 });
    try {
      const encerramento = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.contaResultado.id,
      });
      expect(encerramento.statusCode).toBe(200);
      const corpo = encerramentoPeriodoResponseSchema.parse(encerramento.json());
      // o lançamento de encerramento foi gravado DENTRO do período (só é
      // possível porque a operação o grava antes de marcar `encerrado_em`)
      expect(corpo.lancamento_encerramento_id).not.toBeNull();
      const lancamentos = c.t.database.db.select().from(lancamento).all();
      expect(lancamentos).toHaveLength(6); // L1..L5 + encerramento

      // reabrir/alterar a marca por caminho direto é abortado NO BANCO
      expect(() =>
        c.t.database.db
          .update(periodoContabil)
          .set({ encerradoEm: null })
          .where(eq(periodoContabil.id, c.f.periodo.id))
          .run(),
      ).toThrow(/ja encerrado/i);

      // INSERT direto de lançamento no período encerrado é abortado NO BANCO
      // (mesmo caminho do estorno, que também é INSERT em `lancamento`)
      expect(() =>
        c.t.database.sqlite
          .prepare(
            `INSERT INTO lancamento (empresa_id, periodo_id, data, historico, estorno_de_id, criado_por, criado_em)
             VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(
            c.f.empresa.id,
            c.f.periodo.id,
            '2026-03-30',
            'INSERT direto no período encerrado',
            c.f.contador.id,
            new Date().toISOString(),
          ),
      ).toThrow(/periodo encerrado/i);

      // estado permanece consistente: 6 lançamentos (L1..L5 + encerramento)
      const total = c.t.database.db.select().from(lancamento).all();
      expect(total).toHaveLength(6);
    } finally {
      await t.close();
    }
  });
});

describe('encerramento do exercício (RF-09/H12, CA-32)', () => {
  test('CA-32 encerramento do 12º período transfere o resultado (R$ 100,00) ao PL, zera resultado, PL = R$ 1.100,00 e balanço em 31/12 equilibrado; admin recusado e auditado', async () => {
    const t = await createTestApp();
    // FIX-01 lançado no 12º período (dezembro/2026)
    const f = await criarFix01(t.app, t.database.db, { mes: 12 });
    const admin = await criarUsuarioTeste(t.database.db, {
      email: 'admin-exercicio@escritorio.test',
      papel: 'administrador',
    });
    const { cookie: adminCookie } = await fazerLogin(t.app, admin.email);
    const c: CenarioEncerramento = { t, f, admin, adminCookie };
    try {
      // meses 1..11 do ano-calendário já encerrados (pré-condição do exercício)
      for (let mes = 1; mes <= 11; mes += 1) {
        criarPeriodoTeste(t.database.db, {
          empresaId: f.empresa.id,
          ano: 2026,
          mes,
          encerradoEm: '2027-01-05T12:00:00.000Z',
        });
      }

      // tentativa do ADMIN é recusada com mensagem de permissão e auditada (F13)
      const tentativaAdmin = await postEncerramento(
        c,
        f.periodo.id,
        { conta_resultado_id: f.contaResultado.id },
        adminCookie,
      );
      expect(tentativaAdmin.statusCode).toBe(403);
      expect(erroResponseSchema.parse(tentativaAdmin.json()).erro).toMatch(
        /administrador não possui escrita contábil/i,
      );
      expect(eventosDe(c, 'escopo.tentativa_negada').at(-1)?.dados).toMatchObject({
        motivo: 'administrador_sem_escrita_contabil',
      });
      expect(periodosNoBanco(c).find((p) => p.id === f.periodo.id)?.encerradoEm).toBeNull();

      // contador encerra o 12º período => exercício encerrado (H12)
      const encerramento = await postEncerramento(c, f.periodo.id, {
        conta_resultado_id: f.contaResultado.id,
      });
      expect(encerramento.statusCode).toBe(200);
      const corpo = encerramentoPeriodoResponseSchema.parse(encerramento.json());
      expect(corpo.exercicio_encerrado).toBe(true);
      expect(corpo.resultado_centavos).toBe(-10_000); // lucro de R$ 100,00
      expect(corpo.lancamento_encerramento_id).not.toBeNull();

      // trilha de RF-05: encerramento do exercício registrado
      const eventoExercicio = eventosDe(c, 'exercicio.encerramento').at(-1);
      expect(eventoExercicio).toBeDefined();
      expect(eventoExercicio?.usuarioId).toBe(f.contador.id);
      expect(eventoExercicio?.dados).toMatchObject({ ano: 2026, resultado_centavos: -10_000 });

      // contas de resultado zeradas (balancete de dezembro, acumulado) — o
      // MESMO verbo e a MESMA coluna do CA-31
      const balancete = await t.app.inject({
        method: 'GET',
        url: `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${f.periodo.id}`,
        headers: { cookie: f.cookie },
      });
      const acumuladoDe = (conta: Conta): number | undefined =>
        balancete
          .json()
          .linhas.find((linha: { conta_id: number }) => linha.conta_id === conta.id)
          ?.acumulado_centavos;
      expect(acumuladoDe(f.despesas)).toBe(0);
      expect(acumuladoDe(f.receita)).toBe(0);

      // balanço em 31/12: ativo 1.300,00 = passivo 200,00 + PL 1.100,00
      const balanco = await t.app.inject({
        method: 'GET',
        url: `/relatorios/balanco?empresa_id=${f.empresa.id}&data=2026-12-31`,
        headers: { cookie: f.cookie },
      });
      expect(balanco.statusCode).toBe(200);
      const totais = balanco.json().totais;
      expect(totais.ativo_centavos).toBe(130_000);
      expect(totais.passivo_centavos).toBe(20_000);
      expect(totais.patrimonio_liquido_centavos).toBe(110_000); // PL = 1.100,00
      expect(totais.confere).toBe(true);
      expect(
        totais.ativo_centavos - totais.passivo_centavos - totais.patrimonio_liquido_centavos,
      ).toBe(0);

      // PL = Capital 1.000,00 + resultado transferido 100,00
      const pl = balanco.json().patrimonio_liquido.linhas as { conta_id: number; saldo_centavos: number }[];
      expect(pl.find((linha) => linha.conta_id === f.capital.id)?.saldo_centavos).toBe(100_000);
      expect(pl.find((linha) => linha.conta_id === f.contaResultado.id)?.saldo_centavos).toBe(10_000);

      // H12/2026-12-31: a transferência entra no MESMO dia do fechamento (último
      // dia do período) — é por isso que o balanço em 31/12 já a inclui; não há
      // lançamento datado de 2027 "fechando" o ano
      const transferencia = t.database.db
        .select()
        .from(lancamento)
        .all()
        .find((l) => l.id === corpo.lancamento_encerramento_id);
      expect(transferencia?.data).toBe('2026-12-31');
    } finally {
      await t.close();
    }
  });

  test('encerramento do 12º período exige os 11 anteriores do ano-calendário encerrados (RF-09/H12); depois de encerrados, o exercício é concluído', async () => {
    const t = await createTestApp();
    const c = await preparar(t, { mes: 12 });
    try {
      // sem os meses 1..11: recusa específica e nada alterado
      const semAnteriores = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.contaResultado.id,
      });
      expect(semAnteriores.statusCode).toBe(409);
      expect(erroResponseSchema.parse(semAnteriores.json()).erro).toMatch(
        /11 períodos anteriores/i,
      );
      expect(periodosNoBanco(c).find((p) => p.id === c.f.periodo.id)?.encerradoEm).toBeNull();

      // encerra os 11 anteriores (períodos sem movimento: sem lançamento de encerramento)
      for (let mes = 1; mes <= 11; mes += 1) {
        const periodo = criarPeriodoTeste(c.t.database.db, {
          empresaId: c.f.empresa.id,
          ano: 2026,
          mes,
        });
        const encerrado = await postEncerramento(c, periodo.id, {});
        expect(encerrado.statusCode).toBe(200);
      }

      // agora o exercício fecha normalmente
      const encerramento = await postEncerramento(c, c.f.periodo.id, {
        conta_resultado_id: c.f.contaResultado.id,
      });
      expect(encerramento.statusCode).toBe(200);
      expect(encerramentoPeriodoResponseSchema.parse(encerramento.json()).exercicio_encerrado).toBe(
        true,
      );
    } finally {
      await t.close();
    }
  });
});
