import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  apuracaoDas,
  configMultaJuros,
  conta,
  partida,
  regimeFiscalTabela,
  tabelaImposto,
  titulo,
  tituloTabelaImposto,
  lancamento as lancamentoTabela,
  type ApuracaoDas,
  type ConfigMultaJuros,
  type Natureza,
  type RegimeFiscal,
  type RegimeFiscalTabela,
  type TabelaImposto,
  type TituloTabelaImposto,
} from '../db/schema.ts';
import { calcularDas } from '../domain/fiscal.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';
import { buscarContaNaEmpresa } from './contas.ts';
import { exigirPeriodoAberto, inserirLancamentoComPartidas } from './lancamentos.ts';
import { periodoDeData } from './periodos.ts';

/**
 * Fiscal configurável (RF-20..23, H17/H18/H19, CA-45..49/54; TASK-017):
 * tabelas de imposto e associação a títulos, configuração de multa/juros com
 * override por título e apuração/geração do DAS do Simples Nacional.
 *
 * Regras sustentadas aqui:
 * - **configuração fiscal é configuração administrativa auditada, não escrita
 *   contábil** (RF-02/RF-20/CA-54): o guard `exigirConfiguracaoFiscal` rota as
 *   rotas de config; cada alteração grava valores antigo/novo na trilha;
 * - **geração do lançamento do DAS é escrita contábil** (T017-F-2): rota com
 *   `exigirEscritaContabil`; a consulta/apuração é leitura;
 * - associação tabela↔título é escrita financeira (T017-F-2: mesmo guard de
 *   escrita contábil);
 * - base do DAS = receitas lançadas no período (H17): Σ créditos − débitos em
 *   contas de tipo `receita` dos lançamentos do período (estornos valem no
 *   período da própria data — hipótese T017);
 * - toda recusa de apuração/geração é auditada (CE-19: nada calculado nem
 *   gravado sem regime; CA-49);
 * - escritas de configuração/apuração usam `transacaoComAuditoria` (R8):
 *   dado + trilha nascem e morrem juntos.
 */

/** Centavos → "R$ 1.234,56" para as mensagens de recusa (padrão do projeto). */
function reaisDe(centavos: number): string {
  const comSeparador = (centavos / 100).toFixed(2).replace('.', ',');
  return `R$ ${comSeparador}`;
}

function rotuloDoPeriodo(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

function dataDoMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/* -------------------------------------------------------------------------- */
/* Tabelas de imposto (RF-20, CA-45/CA-54)                                      */
/* -------------------------------------------------------------------------- */

/** Tabela por id DENTRO da empresa (R7; predicado NO WHERE — S-T014-1). */
export async function buscarTabelaImpostoNaEmpresa(
  db: AppDb,
  tabelaId: number,
  empresaId: number,
): Promise<TabelaImposto | undefined> {
  const linhas = await db
    .select()
    .from(tabelaImposto)
    .where(and(eq(tabelaImposto.id, tabelaId), eq(tabelaImposto.empresaId, empresaId)))
    .limit(1);
  return linhas[0];
}

/** Tabelas de imposto da empresa em ordem de criação. */
export async function listarTabelasImposto(db: AppDb, empresaId: number): Promise<TabelaImposto[]> {
  return db
    .select()
    .from(tabelaImposto)
    .where(eq(tabelaImposto.empresaId, empresaId))
    .orderBy(asc(tabelaImposto.id));
}

/**
 * Cria tabela de imposto (CA-45): nome + alíquota não negativa (a recusa de
 * alíquota negativa/não numérica acontece na camada de entrada — Zod — com
 * mensagem; o CHECK do banco é o retrocesso). Conta de retenção é opcional
 * aqui (CA-45 é nome + alíquota), mas a associação/baixa exige a conta.
 */
export async function criarTabelaImposto(
  db: AppDb,
  entrada: {
    empresaId: number;
    nome: string;
    aliquotaCentavos: number;
    contaRetencaoId?: number | null | undefined;
    ativa?: boolean | undefined;
  },
  atorId: number,
): Promise<TabelaImposto> {
  if (entrada.contaRetencaoId !== undefined && entrada.contaRetencaoId !== null) {
    await exigirContaNaEmpresa(
      db,
      entrada.contaRetencaoId,
      entrada.empresaId,
      atorId,
      'fiscal.tabela_imposto_criacao_recusada',
    );
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const inserida = tx
      .insert(tabelaImposto)
      .values({
        empresaId: entrada.empresaId,
        nome: entrada.nome,
        aliquotaCentavos: entrada.aliquotaCentavos,
        contaRetencaoId: entrada.contaRetencaoId ?? null,
        ativa: entrada.ativa ?? true,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'fiscal.tabela_imposto_criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'tabela_imposto',
      objetoId: String(inserida.id),
      dados: {
        nome: inserida.nome,
        aliquota_centavos: inserida.aliquotaCentavos,
        conta_retencao_id: inserida.contaRetencaoId,
        ativa: inserida.ativa,
      },
    });

    return inserida;
  });
}

/**
 * Altera tabela de imposto (CA-54b): o novo valor (ex.: alíquota) passa a
 * valer para as associações/baixas seguintes e a ação fica auditada com os
 * valores antigo/novo. Tabela de OUTRA empresa responde o mesmo 404 do
 * inexistente, com tentativa na trilha (S-T014-2/R7).
 */
export async function atualizarTabelaImposto(
  db: AppDb,
  entrada: {
    tabelaId: number;
    empresaId: number;
    nome?: string | undefined;
    aliquotaCentavos?: number | undefined;
    contaRetencaoId?: number | null | undefined;
    ativa?: boolean | undefined;
  },
  atorId: number,
): Promise<TabelaImposto> {
  const atual = await buscarTabelaImpostoNaEmpresa(db, entrada.tabelaId, entrada.empresaId);
  if (!atual) {
    const alheia = await db
      .select({ id: tabelaImposto.id, empresaId: tabelaImposto.empresaId })
      .from(tabelaImposto)
      .where(eq(tabelaImposto.id, entrada.tabelaId))
      .limit(1);
    if (alheia.length > 0) {
      registrarEvento(db, {
        acao: 'fiscal.tabela_imposto_tentativa_negada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'tabela_imposto',
        objetoId: String(entrada.tabelaId),
        dados: { motivo: 'empresa_diferente', empresa_da_tabela: alheia[0]!.empresaId },
      });
    }
    throw new ErroAplicacao(
      404,
      'Tabela de imposto não encontrada nesta empresa.',
      'tabela_imposto_nao_encontrada',
    );
  }

  if (entrada.contaRetencaoId !== undefined && entrada.contaRetencaoId !== null) {
    await exigirContaNaEmpresa(
      db,
      entrada.contaRetencaoId,
      entrada.empresaId,
      atorId,
      'fiscal.tabela_imposto_alteracao_recusada',
      atual.id,
    );
  }

  const nome = entrada.nome ?? atual.nome;
  const aliquota = entrada.aliquotaCentavos ?? atual.aliquotaCentavos;
  const contaRetencao =
    entrada.contaRetencaoId === undefined ? atual.contaRetencaoId : entrada.contaRetencaoId;
  const ativa = entrada.ativa ?? atual.ativa;

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const atualizada = tx
      .update(tabelaImposto)
      .set({
        nome,
        aliquotaCentavos: aliquota,
        contaRetencaoId: contaRetencao,
        ativa,
        atualizadoEm: new Date().toISOString(),
      })
      .where(and(eq(tabelaImposto.id, atual.id), eq(tabelaImposto.empresaId, entrada.empresaId)))
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'fiscal.tabela_imposto_alteracao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'tabela_imposto',
      objetoId: String(atualizada.id),
      dados: {
        antes: {
          nome: atual.nome,
          aliquota_centavos: atual.aliquotaCentavos,
          conta_retencao_id: atual.contaRetencaoId,
          ativa: atual.ativa,
        },
        depois: {
          nome: atualizada.nome,
          aliquota_centavos: atualizada.aliquotaCentavos,
          conta_retencao_id: atualizada.contaRetencaoId,
          ativa: atualizada.ativa,
        },
      },
    });

    return atualizada;
  });
}

/* -------------------------------------------------------------------------- */
/* Associação tabela ↔ título (RF-13/RF-20, CA-45; T017-F-2)                    */
/* -------------------------------------------------------------------------- */

/** Associações de um título (rastreabilidade RF-15). */
export async function listarTabelasDoTitulo(
  db: AppDb,
  tituloId: number,
): Promise<TituloTabelaImposto[]> {
  return db
    .select()
    .from(tituloTabelaImposto)
    .where(eq(tituloTabelaImposto.tituloId, tituloId))
    .orderBy(asc(tituloTabelaImposto.tabelaImpostoId));
}

/**
 * Associa uma tabela de imposto a um título (RF-13/RF-20/RF-22; CA-45
 * "disponível para associação"). Recusas auditadas ANTES da escrita:
 * título/tabela inexistente na empresa, tabela inativa, tabela sem conta de
 * retenção (a baixa não teria para onde creditar o valor retido — H19) e
 * associação duplicada (PK `(titulo_id, tabela_imposto_id)`).
 */
export async function associarTabelaAoTitulo(
  db: AppDb,
  entrada: { tituloId: number; empresaId: number; tabelaImpostoId: number },
  atorId: number,
): Promise<TituloTabelaImposto> {
  const recusar: (
    motivo: string,
    mensagem: string,
    codigo: string,
    status: number,
  ) => never = (motivo, mensagem, codigo, status) => {
    registrarEvento(db, {
      acao: 'fiscal.tabela_associacao_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo_tabela_imposto',
      objetoId: `${entrada.tituloId}:${entrada.tabelaImpostoId}`,
      dados: { motivo, titulo_id: entrada.tituloId, tabela_imposto_id: entrada.tabelaImpostoId },
    });
    throw new ErroAplicacao(status, mensagem, codigo);
  };

  const tituloExiste = await db
    .select({ id: titulo.id })
    .from(titulo)
    .where(and(eq(titulo.id, entrada.tituloId), eq(titulo.empresaId, entrada.empresaId)))
    .limit(1);
  if (tituloExiste.length === 0) {
    recusar(
      'titulo_nao_encontrado',
      `O título ${entrada.tituloId} não existe nesta empresa.`,
      'titulo_nao_encontrado',
      404,
    );
  }

  const tabela = await buscarTabelaImpostoNaEmpresa(db, entrada.tabelaImpostoId, entrada.empresaId);
  if (!tabela) {
    recusar(
      'tabela_nao_encontrada',
      `A tabela de imposto ${entrada.tabelaImpostoId} não existe nesta empresa.`,
      'tabela_imposto_nao_encontrada',
      404,
    );
  }
  if (!tabela.ativa) {
    recusar(
      'tabela_inativa',
      `A tabela de imposto "${tabela.nome}" está inativa: reative-a antes de associá-la a títulos.`,
      'tabela_imposto_inativa',
      409,
    );
  }
  if (tabela.contaRetencaoId === null) {
    recusar(
      'tabela_sem_conta_retencao',
      `A tabela de imposto "${tabela.nome}" não tem conta de retenção configurada: ` +
        'informe a conta de "impostos/retenções a recolher" na tabela antes de associá-la a títulos.',
      'tabela_sem_conta_retencao',
      409,
    );
  }

  const duplicada = await db
    .select()
    .from(tituloTabelaImposto)
    .where(
      and(
        eq(tituloTabelaImposto.tituloId, entrada.tituloId),
        eq(tituloTabelaImposto.tabelaImpostoId, entrada.tabelaImpostoId),
      ),
    )
    .limit(1);
  if (duplicada.length > 0) {
    recusar(
      'associacao_ja_existente',
      'Esta tabela de imposto já está associada ao título.',
      'associacao_duplicada',
      409,
    );
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const inserida = tx
      .insert(tituloTabelaImposto)
      .values({
        tituloId: entrada.tituloId,
        tabelaImpostoId: entrada.tabelaImpostoId,
        empresaId: entrada.empresaId,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'fiscal.tabela_associada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo_tabela_imposto',
      objetoId: `${inserida.tituloId}:${inserida.tabelaImpostoId}`,
      dados: {
        titulo_id: inserida.tituloId,
        tabela_imposto_id: inserida.tabelaImpostoId,
        aliquota_centavos: tabela.aliquotaCentavos,
        conta_retencao_id: tabela.contaRetencaoId,
      },
    });

    return inserida;
  });
}

/**
 * Tabelas ATIVAS associadas a um título, com a alíquota VIGENTE (lida do
 * banco no ato da baixa — CA-54b: o valor novo vale para as operações
 * seguintes; RF-22: retenção conforme tabela configurável).
 */
export async function retencaoVigenteDoTitulo(
  db: AppDb,
  tituloId: number,
  empresaId: number,
): Promise<
  { tabelaId: number; nome: string; aliquotaCentavos: number; contaRetencaoId: number | null }[]
> {
  const linhas = await db
    .select({
      tabelaId: tabelaImposto.id,
      nome: tabelaImposto.nome,
      aliquotaCentavos: tabelaImposto.aliquotaCentavos,
      contaRetencaoId: tabelaImposto.contaRetencaoId,
    })
    .from(tituloTabelaImposto)
    .innerJoin(tabelaImposto, eq(tituloTabelaImposto.tabelaImpostoId, tabelaImposto.id))
    .where(
      and(
        eq(tituloTabelaImposto.tituloId, tituloId),
        eq(tituloTabelaImposto.empresaId, empresaId),
        eq(tabelaImposto.empresaId, empresaId),
        eq(tabelaImposto.ativa, true),
      ),
    )
    .orderBy(asc(tituloTabelaImposto.tabelaImpostoId));
  return linhas.map((linha) => ({
    tabelaId: linha.tabelaId,
    nome: linha.nome,
    aliquotaCentavos: linha.aliquotaCentavos,
    contaRetencaoId: linha.contaRetencaoId,
  }));
}

/* -------------------------------------------------------------------------- */
/* Multa/juros (RF-23, CA-48)                                                  */
/* -------------------------------------------------------------------------- */

/** Configurações de multa/juros da empresa (padrão + overrides). */
export async function listarConfigMultaJuros(
  db: AppDb,
  empresaId: number,
): Promise<ConfigMultaJuros[]> {
  return db
    .select()
    .from(configMultaJuros)
    .where(eq(configMultaJuros.empresaId, empresaId))
    .orderBy(asc(configMultaJuros.id));
}

/**
 * Configuração de multa/juros aplicável a um título: **override por título
 * vence o padrão da empresa** (RF-23: "por título e/ou contrato"; não existe
 * entidade "contrato" no MVP — hipótese T017). `undefined` = sem
 * configuração (baixa sem multa/juros).
 */
export async function configMultaJurosDoTitulo(
  db: AppDb,
  empresaId: number,
  tituloId: number,
): Promise<ConfigMultaJuros | undefined> {
  const override = await db
    .select()
    .from(configMultaJuros)
    .where(and(eq(configMultaJuros.empresaId, empresaId), eq(configMultaJuros.tituloId, tituloId)))
    .limit(1);
  if (override[0]) return override[0];

  const padrao = await db
    .select()
    .from(configMultaJuros)
    .where(and(eq(configMultaJuros.empresaId, empresaId), isNull(configMultaJuros.tituloId)))
    .limit(1);
  return padrao[0];
}

/**
 * Configura (upsert) multa/juros: `titulo_id` ausente/null = padrão da
 * empresa; preenchido = override por título. Campos omitidos mantêm o valor
 * atual (update) ou nascem em 0/null (insert). Auditado com antigo/novo.
 */
export async function configurarMultaJuros(
  db: AppDb,
  entrada: {
    empresaId: number;
    tituloId?: number | null | undefined;
    multaCentavos?: number | undefined;
    jurosMensalCentavos?: number | undefined;
    contaEncargosId?: number | null | undefined;
  },
  atorId: number,
): Promise<ConfigMultaJuros> {
  const tituloId = entrada.tituloId ?? null;

  if (tituloId !== null) {
    const tituloExiste = await db
      .select({ id: titulo.id })
      .from(titulo)
      .where(and(eq(titulo.id, tituloId), eq(titulo.empresaId, entrada.empresaId)))
      .limit(1);
    if (tituloExiste.length === 0) {
      registrarEvento(db, {
        acao: 'fiscal.multa_juros_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'config_multa_juros',
        dados: { motivo: 'titulo_nao_encontrado', titulo_id: tituloId },
      });
      throw new ErroAplicacao(404, `O título ${tituloId} não existe nesta empresa.`, 'titulo_nao_encontrado');
    }
  }

  if (entrada.contaEncargosId !== undefined && entrada.contaEncargosId !== null) {
    await exigirContaNaEmpresa(db, entrada.contaEncargosId, entrada.empresaId, atorId, 'fiscal.multa_juros_recusada');
  }

  const atual = await db
    .select()
    .from(configMultaJuros)
    .where(
      tituloId === null
        ? and(eq(configMultaJuros.empresaId, entrada.empresaId), isNull(configMultaJuros.tituloId))
        : and(eq(configMultaJuros.empresaId, entrada.empresaId), eq(configMultaJuros.tituloId, tituloId)),
    )
    .limit(1);

  return transacaoComAuditoria(db, (tx, auditoria) => {
    if (atual[0]) {
      const atualizada = tx
        .update(configMultaJuros)
        .set({
          multaCentavos: entrada.multaCentavos ?? atual[0].multaCentavos,
          jurosMensalCentavos: entrada.jurosMensalCentavos ?? atual[0].jurosMensalCentavos,
          contaEncargosId:
            entrada.contaEncargosId === undefined ? atual[0].contaEncargosId : entrada.contaEncargosId,
          atualizadoEm: new Date().toISOString(),
        })
        .where(eq(configMultaJuros.id, atual[0].id))
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'fiscal.multa_juros_alteracao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'config_multa_juros',
        objetoId: String(atualizada.id),
        dados: {
          titulo_id: atualizada.tituloId,
          antes: {
            multa_centavos: atual[0].multaCentavos,
            juros_mensal_centavos: atual[0].jurosMensalCentavos,
            conta_encargos_id: atual[0].contaEncargosId,
          },
          depois: {
            multa_centavos: atualizada.multaCentavos,
            juros_mensal_centavos: atualizada.jurosMensalCentavos,
            conta_encargos_id: atualizada.contaEncargosId,
          },
        },
      });
      return atualizada;
    }

    const criada = tx
      .insert(configMultaJuros)
      .values({
        empresaId: entrada.empresaId,
        tituloId,
        multaCentavos: entrada.multaCentavos ?? 0,
        jurosMensalCentavos: entrada.jurosMensalCentavos ?? 0,
        contaEncargosId: entrada.contaEncargosId ?? null,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'fiscal.multa_juros_criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'config_multa_juros',
      objetoId: String(criada.id),
      dados: {
        titulo_id: criada.tituloId,
        multa_centavos: criada.multaCentavos,
        juros_mensal_centavos: criada.jurosMensalCentavos,
        conta_encargos_id: criada.contaEncargosId,
      },
    });
    return criada;
  });
}

/* -------------------------------------------------------------------------- */
/* Regime fiscal e apuração do DAS (RF-21, H17, CA-46/CA-49; T017-F-2)          */
/* -------------------------------------------------------------------------- */

/** Regime fiscal da empresa; `undefined` = sem regime (CA-49). */
export async function buscarRegimeFiscal(
  db: AppDb,
  empresaId: number,
): Promise<RegimeFiscalTabela | undefined> {
  const linhas = await db
    .select()
    .from(regimeFiscalTabela)
    .where(eq(regimeFiscalTabela.empresaId, empresaId))
    .limit(1);
  return linhas[0];
}

/**
 * Configura (upsert) o regime fiscal da empresa (RF-21/CA-46): um registro
 * por empresa; reconfigurar é UPDATE (alíquota nova vale para as apurações
 * seguintes). Contas do lançamento de DAS precisam existir na empresa.
 */
export async function configurarRegimeFiscal(
  db: AppDb,
  entrada: {
    empresaId: number;
    regime?: RegimeFiscal | undefined;
    aliquotaCentavos: number;
    contaDespesaId: number;
    contaPassivoId: number;
    ativa?: boolean | undefined;
  },
  atorId: number,
): Promise<RegimeFiscalTabela> {
  await exigirContaNaEmpresa(db, entrada.contaDespesaId, entrada.empresaId, atorId, 'fiscal.regime_recusada');
  await exigirContaNaEmpresa(db, entrada.contaPassivoId, entrada.empresaId, atorId, 'fiscal.regime_recusada');

  const atual = await buscarRegimeFiscal(db, entrada.empresaId);

  return transacaoComAuditoria(db, (tx, auditoria) => {
    if (atual) {
      const atualizado = tx
        .update(regimeFiscalTabela)
        .set({
          regime: entrada.regime ?? atual.regime,
          aliquotaCentavos: entrada.aliquotaCentavos,
          contaDespesaId: entrada.contaDespesaId,
          contaPassivoId: entrada.contaPassivoId,
          ativa: entrada.ativa ?? atual.ativa,
          atualizadoEm: new Date().toISOString(),
        })
        .where(eq(regimeFiscalTabela.id, atual.id))
        .returning()
        .all()[0]!;

      auditoria.registrar({
        acao: 'fiscal.regime_alteracao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'regime_fiscal',
        objetoId: String(atualizado.id),
        dados: {
          antes: {
            regime: atual.regime,
            aliquota_centavos: atual.aliquotaCentavos,
            ativa: atual.ativa,
          },
          depois: {
            regime: atualizado.regime,
            aliquota_centavos: atualizado.aliquotaCentavos,
            ativa: atualizado.ativa,
          },
        },
      });
      return atualizado;
    }

    const criado = tx
      .insert(regimeFiscalTabela)
      .values({
        empresaId: entrada.empresaId,
        regime: entrada.regime ?? 'simples_nacional',
        aliquotaCentavos: entrada.aliquotaCentavos,
        contaDespesaId: entrada.contaDespesaId,
        contaPassivoId: entrada.contaPassivoId,
        ativa: entrada.ativa ?? true,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'fiscal.regime_criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'regime_fiscal',
      objetoId: String(criado.id),
      dados: {
        regime: criado.regime,
        aliquota_centavos: criado.aliquotaCentavos,
        conta_das_despesa_id: criado.contaDespesaId,
        conta_das_passivo_id: criado.contaPassivoId,
        ativa: criado.ativa,
      },
    });
    return criado;
  });
}

/**
 * Base do DAS (H17): Σ créditos − Σ débitos em contas de tipo `receita` das
 * partidas cujo LANÇAMENTO tem `periodo_id` deste período. O estorno é um
 * lançamento inverso PRÓPRIO (RF-08): ele altera a base do período da SUA
 * data, não o período do lançamento original — semântica de período herdada
 * da T014/T015 (hipótese T017 sobre H17). Pode devolver valor negativo (mais
 * débitos que créditos em receita no período); quem decide o que fazer com
 * isso é a geração (recusa auditada).
 */
export async function baseDeReceitasDoPeriodo(db: AppDb, periodoId: number): Promise<number> {
  const linhas = await db
    .select({ natureza: partida.natureza, valorCentavos: partida.valorCentavos })
    .from(partida)
    .innerJoin(lancamentoTabela, eq(partida.lancamentoId, lancamentoTabela.id))
    .innerJoin(conta, eq(partida.contaId, conta.id))
    .where(and(eq(lancamentoTabela.periodoId, periodoId), eq(conta.tipo, 'receita')))
    .all();
  return linhas.reduce(
    (total, linha) => total + (linha.natureza === 'C' ? linha.valorCentavos : -linha.valorCentavos),
    0,
  );
}

/** Apuração existente de um período (uma por período — RF-21). */
export async function apuracaoDoPeriodo(
  db: AppDb,
  periodoId: number,
): Promise<ApuracaoDas | undefined> {
  const linhas = await db.select().from(apuracaoDas).where(eq(apuracaoDas.periodoId, periodoId)).limit(1);
  return linhas[0];
}

export interface PreviaDas {
  empresaId: number;
  periodoId: number;
  regime: RegimeFiscal;
  aliquotaCentavos: number;
  baseCentavos: number;
  dasCentavos: number;
}

/**
 * Consulta/apuração do DAS (RF-21 — LEITURA, T017-F-2): sem regime ativo a
 * apuração é **recusada com mensagem** e nada é calculado nem gravado
 * (CA-49/CE-19).
 *
 * Contraparte da geração (F3/FIX-T017-R1): a prévia EXPOE a base CRUA
 * (`baseCentavos`, inclusive negativa) e o DAS apurado — para base negativa o
 * DAS é 0 (limitado abaixo), enquanto a geração recusa 400 auditado
 * (`base_receitas_negativa`); para DAS 0 a prévia responde 200/0 e a geração
 * recusa 400 auditado (`das_valor_zero`). Ou seja: a prévia mostra o valor
 * apurado, a geração de valor zero/inválido é recusada com mensagem — nada é
 * gravado nos dois casos.
 */
export async function consultarApuracaoDas(
  db: AppDb,
  entrada: { empresaId: number; ano: number; mes: number },
): Promise<PreviaDas> {
  const periodo = await periodoDeData(db, entrada.empresaId, dataDoMes(entrada.ano, entrada.mes));
  if (!periodo) {
    throw new ErroAplicacao(
      404,
      `Não existe período contábil ${rotuloDoPeriodo(entrada.ano, entrada.mes)} para esta empresa. ` +
        'Crie o período antes de apurar o DAS.',
      'periodo_nao_encontrado',
    );
  }

  const regime = await exigirRegimeAtivo(db, entrada.empresaId);
  const baseCentavos = await baseDeReceitasDoPeriodo(db, periodo.id);

  return {
    empresaId: entrada.empresaId,
    periodoId: periodo.id,
    regime: regime.regime,
    aliquotaCentavos: regime.aliquotaCentavos,
    // Base CRUA exposta ao cliente (F3): é ela que permite enxergar e corrigir
    // uma base negativa antes de tentar gerar (que seria recusada).
    baseCentavos,
    // DAS da prévia nunca fica negativo; a geração recusa a base negativa.
    dasCentavos: calcularDas(Math.max(0, baseCentavos), regime.aliquotaCentavos),
  };
}

/**
 * Gera a apuração do DAS com o lançamento contábil vinculado (RF-21/RF-15,
 * CA-46) — ESCRITA contábil (T017-F-2: guard da rota). Recusas auditadas ANTES
 * da transação (CA-49: nada gerado sem regime; CE-19):
 * - sem regime ativo → 409 auditado;
 * - período inexistente → 404 auditado; período da data encerrado → 409
 *   auditado (a apuração grava lançamento, então a regra CA-24 vale);
 * - data fora do mês apurado → 400 auditado;
 * - DAS já apurado no período → 409 auditado (correção = estorno do
 *   lançamento, imutabilidade R9);
 * - base negativa (mais débitos que créditos em receita) → 400 auditado
 *   (a prévia do mesmo período responde 200 e EXPOE a base negativa — F3);
 * - DAS calculado = 0 (mês sem receitas ou alíquota vigente 0%) → 400
 *   auditado `das_valor_zero` (CA-14b: lançamento de valor zero não existe;
 *   a prévia responde 200/0) — F2/FIX-T017-R1.
 */
export async function gerarApuracaoDas(
  db: AppDb,
  entrada: { empresaId: number; ano: number; mes: number; data?: string | undefined },
  atorId: number,
): Promise<ApuracaoDas> {
  const recusar: (motivo: string, mensagem: string, codigo: string, status: number) => never = (
    motivo,
    mensagem,
    codigo,
    status,
  ) => {
    registrarEvento(db, {
      acao: 'fiscal.apuracao_das_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'apuracao_das',
      dados: { motivo, ano: entrada.ano, mes: entrada.mes },
    });
    throw new ErroAplicacao(status, mensagem, codigo);
  };

  let regime: RegimeFiscalTabela;
  try {
    regime = await exigirRegimeAtivo(db, entrada.empresaId);
  } catch (erro) {
    // CA-49/CE-19: recusa auditada e NADA gerado (a prévia não persiste).
    recusar(
      'regime_nao_configurado',
      erro instanceof ErroAplicacao
        ? erro.message
        : 'A empresa não tem regime fiscal configurado (Simples Nacional).',
      'regime_nao_configurado',
      409,
    );
  }

  const rotulo = rotuloDoPeriodo(entrada.ano, entrada.mes);
  const data = entrada.data ?? ultimoDiaDoMes(entrada.ano, entrada.mes);

  const periodo = await periodoDeData(db, entrada.empresaId, dataDoMes(entrada.ano, entrada.mes));
  if (!periodo) {
    recusar(
      'periodo_nao_encontrado',
      `Não existe período contábil ${rotulo} para esta empresa: crie o período antes de gerar o DAS.`,
      'periodo_nao_encontrado',
      404,
    );
  }

  if (data.slice(0, 7) !== `${entrada.ano}-${String(entrada.mes).padStart(2, '0')}`) {
    recusar(
      'data_fora_do_periodo',
      `A data ${data} não pertence ao período ${rotulo}: o lançamento do DAS precisa datar do próprio período apurado.`,
      'data_fora_do_periodo',
      400,
    );
  }

  let periodoId: number;
  try {
    periodoId = (await exigirPeriodoAberto(db, entrada.empresaId, data)).id;
  } catch (erro) {
    recusar(
      erro instanceof ErroAplicacao ? erro.codigo : 'periodo_invalido',
      `O período ${rotulo} está indisponível para lançar o DAS: ` +
        (erro instanceof ErroAplicacao ? erro.message : 'período inválido.'),
      erro instanceof ErroAplicacao ? erro.codigo : 'periodo_invalido',
      erro instanceof ErroAplicacao ? erro.statusCode : 400,
    );
  }

  const existente = await apuracaoDoPeriodo(db, periodoId);
  if (existente) {
    recusar(
      'apuracao_ja_existente',
      `O período ${rotulo} já tem apuração de DAS válida (lançamento #${existente.lancamentoId}). ` +
        'Estornar esse lançamento não libera nova apuração — uma apuração por período (RF-21). ' +
        'Consulte a apuração existente.',
      'apuracao_ja_existente',
      409,
    );
  }

  const baseCentavos = await baseDeReceitasDoPeriodo(db, periodoId);
  if (baseCentavos < 0) {
    recusar(
      'base_receitas_negativa',
      `A base de receitas do período ${rotulo} ficou negativa (${reaisDe(baseCentavos)}): ` +
        'confira os lançamentos de receita antes de apurar o DAS.',
      'base_receitas_negativa',
      400,
    );
  }
  const dasCentavos = calcularDas(baseCentavos, regime.aliquotaCentavos);
  if (dasCentavos === 0) {
    // CA-14(b)/CE-19: não existe lançamento de valor zero válido — gerar o DAS
    // de 0 abortaria no CHECK `partida_valor_positivo` (0005) no meio da
    // transação, virando 500 sem auditoria. Dois gatilhos legítimos e distintos:
    // período sem receitas lançadas (base 0) e alíquota vigente 0% (o CHECK
    // `regime_fiscal_aliquota_nao_negativa` permite), além de arredondamento
    // meio-em-cima para 0 em base minúscula. A prévia continua exibindo 0
    // honestamente (consultarApuracaoDas) — quem gera é que precisa decidir.
    recusar(
      'das_valor_zero',
      `O DAS de ${rotulo} apurou valor zero (base de receitas ${reaisDe(baseCentavos)} × alíquota vigente de ` +
        `${(regime.aliquotaCentavos / 100).toFixed(2).replace('.', ',')}% = ${reaisDe(dasCentavos)}): o período pode ` +
        'estar sem receitas lançadas ou a alíquota do regime pode estar em 0%, e um lançamento de valor zero é ' +
        'inválido (CA-14b) — nada foi gerado. Confira as receitas do período e a alíquota do regime antes de gerar.',
      'das_valor_zero',
      400,
    );
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const { lancamento: lancamentoDas } = inserirLancamentoComPartidas(tx, {
      empresaId: entrada.empresaId,
      periodoId,
      data,
      historico: `Apuração do DAS — Simples Nacional ${rotulo}`.slice(0, 200),
      estornoDeId: null,
      criadoPor: atorId,
      partidas: [
        { contaId: regime.contaDespesaId, natureza: 'D' as Natureza, valorCentavos: dasCentavos },
        { contaId: regime.contaPassivoId, natureza: 'C' as Natureza, valorCentavos: dasCentavos },
      ],
    });

    const apurada = tx
      .insert(apuracaoDas)
      .values({
        empresaId: entrada.empresaId,
        regimeId: regime.id,
        periodoId,
        lancamentoId: lancamentoDas.id,
        baseCentavos,
        aliquotaCentavos: regime.aliquotaCentavos,
        dasCentavos,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'lancamento.criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(lancamentoDas.id),
      dados: {
        origem: 'apuracao_das',
        apuracao_id: apurada.id,
        periodo_id: periodoId,
        data,
        base_centavos: baseCentavos,
        aliquota_centavos: regime.aliquotaCentavos,
        das_centavos: dasCentavos,
        debitos_centavos: dasCentavos,
        creditos_centavos: dasCentavos,
      },
    });
    auditoria.registrar({
      acao: 'fiscal.apuracao_das',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'apuracao_das',
      objetoId: String(apurada.id),
      dados: {
        regime_id: regime.id,
        periodo_id: periodoId,
        lancamento_id: lancamentoDas.id,
        base_centavos: baseCentavos,
        aliquota_centavos: regime.aliquotaCentavos,
        das_centavos: dasCentavos,
      },
    });

    return apurada;
  });
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                  */
/* -------------------------------------------------------------------------- */

async function exigirRegimeAtivo(db: AppDb, empresaId: number): Promise<RegimeFiscalTabela> {
  const regime = await buscarRegimeFiscal(db, empresaId);
  if (!regime || !regime.ativa) {
    throw new ErroAplicacao(
      409,
      'A empresa não tem regime fiscal configurado (Simples Nacional) para apurar o DAS (RF-21/CA-49). ' +
        'Configure o regime (alíquota e contas) antes de apurar: nada foi calculado nem gravado.',
      'regime_nao_configurado',
    );
  }
  return regime;
}

/** Conta precisa existir DENTRO da empresa (CE-2); recusa auditada como tentativa. */
async function exigirContaNaEmpresa(
  db: AppDb,
  contaId: number,
  empresaId: number,
  atorId: number,
  acaoRecusa: string,
  objetoId?: number,
): Promise<void> {
  const encontrada = await buscarContaNaEmpresa(db, contaId, empresaId);
  if (encontrada) return;
  registrarEvento(db, {
    acao: acaoRecusa,
    usuarioId: atorId,
    empresaId,
    objetoTipo: 'conta',
    objetoId: objetoId !== undefined ? String(objetoId) : String(contaId),
    dados: { motivo: 'conta_nao_encontrada', conta_id: contaId },
  });
  throw new ErroAplicacao(404, `A conta ${contaId} não existe nesta empresa.`, 'conta_nao_encontrada');
}

/** Último dia do mês (YYYY-MM-DD) — data padrão do lançamento do DAS. */
export function ultimoDiaDoMes(ano: number, mes: number): string {
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}
