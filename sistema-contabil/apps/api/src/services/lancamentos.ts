import { and, eq, or } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  baixa,
  lancamento,
  partida,
  type Lancamento,
  type Natureza,
  type Partida,
  type PeriodoContabil,
} from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import {
  registrarEvento,
  transacaoComAuditoria,
  type DbTransacao,
} from './auditoria.ts';
import { buscarContaNaEmpresa } from './contas.ts';
import { periodoDeData } from './periodos.ts';

/**
 * Lançamentos em partidas dobradas, imutabilidade e estorno (RF-07/RF-08,
 * R9/RK-4, CA-13/14/24/25/26/29, TASK-014).
 *
 * Regras sustentadas aqui:
 * - lançamento só é gravado com ≥2 partidas, valores > 0 (H7), Σ débitos =
 *   Σ créditos (CA-13/CE-1), contas existentes na empresa (CE-2) e data em
 *   período contábil **aberto** (CA-24/CE-3);
 * - lançamento gravado é **imutável**: nenhuma função deste módulo edita ou
 *   exclui — o produto só expõe o caminho de correção por **estorno** (CA-25,
 *   RK-4: as mensagens orientam a ele); triggers no banco abortam UPDATE/
 *   DELETE diretos (migração 0005);
 * - estorno = novo lançamento **inverso** (naturezas trocadas, mesmos valores)
 *   vinculado por `estorno_de_id`, com data em período aberto; **uma única vez
 *   por origem** (validação de serviço + índice único `lancamento_estorno_de_uk`
 *   como retrocesso — CA-26/CE-5);
 * - lançamento + partidas + trilha são gravados na MESMA transação (R8/CA-29):
 *   falha de banco no meio desfaz tudo, sem registro parcial;
 * - **D2 (T016):** lançamento **vinculado a baixa** (o da própria baixa ou o do
 *   seu estorno) NÃO é estornável por esta rota — o estorno direto reverteria
 *   o efeito contábil sem reabrir o título; a recusa orienta ao estorno de
 *   baixa e é auditada (ver `estornarLancamento`).
 */

/**
 * Violação de UNICIDADE **específica** do estorno (S-T014-3, TASK-016): só o
 * `UNIQUE` de `lancamento.estorno_de_id` (`lancamento_estorno_de_uk`) vira 409
 * "já estornado". Antes, **qualquer** `SQLITE_CONSTRAINT*` era mascarado como
 * esse 409 — um bug real (CHECK, FK, trigger) aparecia como estorno duplicado.
 * Todo o resto é propagado ao chamador. Exportado: o estorno de baixa
 * (`titulos.ts`) insere estorno com o MESMO `estorno_de_id` e usa o matcher
 * para a corrida de dois estornos da mesma baixa (T016 rodada de correção).
 */
export function ehViolacaoDeEstornoUnico(erro: unknown): boolean {
  const candidato = erro as { code?: unknown; message?: unknown } | null;
  if (typeof candidato?.code !== 'string' || candidato.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
    return false;
  }
  if (typeof candidato.message !== 'string') return false;
  return (
    candidato.message.includes('lancamento.estorno_de_id') ||
    candidato.message.includes('lancamento_estorno_de_uk')
  );
}

/** Centavos → "R$ 1.234,56" para as mensagens de recusa (CA-13 cita a diferença). */
function reaisDe(centavos: number): string {
  const comSeparador = (centavos / 100).toFixed(2).replace('.', ',');
  return `R$ ${comSeparador}`;
}

function rotuloDoPeriodo(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/**
 * Exige período contábil existente e **aberto** para a data (CA-24/CE-3).
 * Nenhum lançamento — inclusive estorno — é aceito com data em período
 * encerrado (RF-09); sem período cadastrado a recusa orienta a criá-lo.
 * Exportado: as baixas (T016) usam a MESMA regra para a data da baixa.
 */
export async function exigirPeriodoAberto(
  db: AppDb,
  empresaId: number,
  data: string,
): Promise<PeriodoContabil> {
  const periodo = await periodoDeData(db, empresaId, data);
  if (!periodo) {
    throw new ErroAplicacao(
      404,
      `Não existe período contábil para a data ${data}. Crie o período (ano/mês) antes de lançar.`,
      'periodo_nao_encontrado',
    );
  }
  if (periodo.encerradoEm !== null) {
    throw new ErroAplicacao(
      409,
      `O período ${rotuloDoPeriodo(periodo.ano, periodo.mes)} está encerrado: nada é lançado ou estornado com data nele. ` +
        'O caminho de correção é gravar/estornar em um período aberto.',
      'periodo_encerrado',
    );
  }
  return periodo;
}

/**
 * Lançamento por id DENTRO da empresa (nunca devolve lançamento alheio — R7).
 *
 * S-T014-1 (TASK-016): o predicado de empresa está **no WHERE** (mesmo padrão
 * de `buscarContaNaEmpresa` em `contas.ts`), não em checagem de JS depois —
 * a linha alheia jamais entra no caminho de leitura normal.
 */
export async function buscarLancamentoNaEmpresa(
  db: AppDb,
  lancamentoId: number,
  empresaId: number,
): Promise<Lancamento | undefined> {
  const linhas = await db
    .select()
    .from(lancamento)
    .where(and(eq(lancamento.id, lancamentoId), eq(lancamento.empresaId, empresaId)))
    .limit(1);
  return linhas[0];
}

/**
 * Localiza o lançamento para um ATO DE ESCRITA, com trilha de tentativa
 * cruzada de tenant (S-T014-2, R7): "não existe" e "existe em outra empresa"
 * são distinguíveis **só internamente** — a segunda grava
 * `lancamento.tentativa_negada` na trilha; a RESPOSTA é idêntica nos dois
 * casos (404 sem oráculo de existência — CA-22/R7).
 */
async function lancamentoParaEscritaOu404(
  db: AppDb,
  lancamentoId: number,
  empresaId: number,
  atorId: number,
): Promise<Lancamento> {
  const encontrado = await buscarLancamentoNaEmpresa(db, lancamentoId, empresaId);
  if (encontrado) return encontrado;

  // Segunda consulta (só no caminho de falha) para distinguir os casos.
  const alheio = await db
    .select({ id: lancamento.id, empresaId: lancamento.empresaId })
    .from(lancamento)
    .where(eq(lancamento.id, lancamentoId))
    .limit(1);
  if (alheio.length > 0) {
    registrarEvento(db, {
      acao: 'lancamento.tentativa_negada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(lancamentoId),
      dados: { motivo: 'empresa_diferente', empresa_do_lancamento: alheio[0]!.empresaId },
    });
  }

  throw new ErroAplicacao(404, 'Lançamento não encontrado nesta empresa.', 'lancamento_nao_encontrado');
}

/** Partidas de um lançamento em ordem de gravação. */
export async function partidasDoLancamento(db: AppDb, lancamentoId: number): Promise<Partida[]> {
  return db.select().from(partida).where(eq(partida.lancamentoId, lancamentoId)).orderBy(partida.id);
}

/**
 * Insere lançamento + partidas **dentro da transação corrente** (R8/CA-29).
 * Compartilhado pelo caminho normal (T014) e pelas baixas/estornos de baixa
 * (T016): assim a baixa, seu lançamento e a trilha nascem e morrem juntos.
 * NÃO grava auditoria — quem chama decide a ação.
 */
export function inserirLancamentoComPartidas(
  tx: DbTransacao,
  dados: {
    empresaId: number;
    periodoId: number;
    data: string;
    historico: string;
    /** `NULL` = original; id do original quando este lançamento é um estorno. */
    estornoDeId: number | null;
    criadoPor: number;
    partidas: EntradaPartida[];
  },
): LancamentoComPartidas {
  const inserido = tx
    .insert(lancamento)
    .values({
      empresaId: dados.empresaId,
      periodoId: dados.periodoId,
      data: dados.data,
      historico: dados.historico,
      estornoDeId: dados.estornoDeId,
      criadoPor: dados.criadoPor,
    })
    .returning()
    .all()[0]!;

  tx.insert(partida)
    .values(
      dados.partidas.map((item) => ({
        lancamentoId: inserido.id,
        contaId: item.contaId,
        natureza: item.natureza,
        valorCentavos: item.valorCentavos,
      })),
    )
    .prepare()
    .run();

  const partidasInseridas = tx
    .select()
    .from(partida)
    .where(eq(partida.lancamentoId, inserido.id))
    .all();

  return { lancamento: inserido, partidas: partidasInseridas };
}

export interface EntradaPartida {
  contaId: number;
  natureza: Natureza;
  valorCentavos: number;
}

export interface EntradaLancamento {
  empresaId: number;
  /** `YYYY-MM-DD` já validado na camada de entrada. */
  data: string;
  historico: string;
  partidas: EntradaPartida[];
}

export interface LancamentoComPartidas {
  lancamento: Lancamento;
  partidas: Partida[];
}

/**
 * Grava um lançamento válido (RF-07, CA-13/CA-14/CA-24) com partidas e trilha
 * na mesma transação. Todas as recusas acontecem ANTES da transação — em
 * qualquer recusa nada é persistido (CE-1/CE-2/CE-3).
 */
export async function criarLancamento(
  db: AppDb,
  entrada: EntradaLancamento,
  atorId: number,
): Promise<LancamentoComPartidas> {
  if (entrada.partidas.length < 2) {
    throw new ErroAplicacao(
      400,
      'O lançamento deve ter ao menos duas partidas (uma de débito e outra de crédito).',
      'lancamento_sem_partidas',
    );
  }

  const periodo = await exigirPeriodoAberto(db, entrada.empresaId, entrada.data);

  // Contas precisam existir DENTRO da empresa (CE-2: conta inexistente).
  for (const [indice, item] of entrada.partidas.entries()) {
    const contaLancada = await buscarContaNaEmpresa(db, item.contaId, entrada.empresaId);
    if (!contaLancada) {
      throw new ErroAplicacao(
        404,
        `Partida ${indice + 1}: a conta ${item.contaId} não existe nesta empresa.`,
        'conta_nao_encontrada',
      );
    }
  }

  const somaDebitos = entrada.partidas
    .filter((item) => item.natureza === 'D')
    .reduce((total, item) => total + item.valorCentavos, 0);
  const somaCreditos = entrada.partidas
    .filter((item) => item.natureza === 'C')
    .reduce((total, item) => total + item.valorCentavos, 0);
  if (somaDebitos !== somaCreditos) {
    // CE-1/CA-13: a mensagem cita os totais E a diferença.
    throw new ErroAplicacao(
      400,
      `Lançamento desequilibrado: débitos somam ${reaisDe(somaDebitos)} e créditos somam ${reaisDe(somaCreditos)} ` +
        `(diferença de ${reaisDe(Math.abs(somaDebitos - somaCreditos))}). ` +
        'Ajuste as partidas para que os totais confiram.',
      'lancamento_desequilibrado',
    );
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const { lancamento: inserido, partidas: partidasInseridas } = inserirLancamentoComPartidas(
      tx,
      {
        empresaId: entrada.empresaId,
        periodoId: periodo.id,
        data: entrada.data,
        historico: entrada.historico,
        estornoDeId: null,
        criadoPor: atorId,
        partidas: entrada.partidas,
      },
    );

    auditoria.registrar({
      acao: 'lancamento.criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(inserido.id),
      dados: {
        data: inserido.data,
        historico: inserido.historico,
        periodo_id: inserido.periodoId,
        partidas: partidasInseridas.map((p) => ({
          conta_id: p.contaId,
          natureza: p.natureza,
          valor_centavos: p.valorCentavos,
        })),
        debitos_centavos: somaDebitos,
        creditos_centavos: somaCreditos,
      },
    });

    return { lancamento: inserido, partidas: partidasInseridas };
  });
}

export interface EntradaEstorno {
  lancamentoId: number;
  empresaId: number;
  /** `YYYY-MM-DD` — a rota resolve o padrão (hoje, UTC) antes de chamar. */
  data: string;
}

/** Mensagem única da recusa de estorno duplicado (CE-5). */
const MENSAGEM_JA_ESTORONADO =
  'Este lançamento já foi estornado: um lançamento só pode ser estornado uma vez. ' +
  'Para corrigir, grave um novo lançamento.';

/**
 * Estorna um lançamento (RF-08, CA-24/CA-26): cria novo lançamento **inverso**
 * (naturezas trocadas, mesmos valores) vinculado por `estorno_de_id`, com data
 * em período aberto. Recusas auditadas (ADR-0001: estorno recusado é evento de
 * trilha); estorno duplicado é recusado pelo serviço e retrocedido pelo índice
 * único em corrida.
 */
export async function estornarLancamento(
  db: AppDb,
  entrada: EntradaEstorno,
  atorId: number,
): Promise<LancamentoComPartidas> {
  const original = await lancamentoParaEscritaOu404(db, entrada.lancamentoId, entrada.empresaId, atorId);

  // D2 (T016): lançamento gerado por BAIXA (ou o estorno da baixa) não é
  // estornável por aqui — o estorno direto reverteria o efeito contábil SEM
  // reabrir o título (RF-15 × RF-24 divergiriam em silêncio). Recusa auditada
  // orientando ao estorno de baixa; a impossibilidade de o banco distinguir os
  // dois INSERTs (ambos `estorno_de_id = baixa.lancamento_id`) está registrada
  // em `TASK-016.json:assumptions` — esta rota é a fronteira.
  const baixasVinculadas = await db
    .select({ id: baixa.id })
    .from(baixa)
    .where(
      and(
        eq(baixa.empresaId, entrada.empresaId),
        or(eq(baixa.lancamentoId, original.id), eq(baixa.estornoLancamentoId, original.id)),
      ),
    )
    .limit(1);
  if (baixasVinculadas.length > 0) {
    registrarEvento(db, {
      acao: 'lancamento.estorno_recusado',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(original.id),
      dados: {
        motivo: 'vinculado_a_baixa',
        baixa_id: baixasVinculadas[0]!.id,
        orientacao: 'estorno_de_baixa',
        data: entrada.data,
      },
    });
    throw new ErroAplicacao(
      409,
      'Este lançamento foi gerado por uma baixa de título e não pode ser estornado diretamente: ' +
        'o caminho de correção é o estorno de baixa (POST /baixas/{id}/estorno), que desfaz a baixa ' +
        'e reabre o título (RF-24). O estorno direto aqui reverteria o efeito contábil sem reabrir o título.',
      'lancamento_vinculado_a_baixa',
    );
  }

  const jaEstornados = await db
    .select()
    .from(lancamento)
    .where(eq(lancamento.estornoDeId, original.id))
    .limit(1);
  if (jaEstornados.length > 0) {
    registrarEvento(db, {
      acao: 'lancamento.estorno_recusado',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(original.id),
      dados: { motivo: 'ja_estornado', estorno_id: jaEstornados[0]!.id, data: entrada.data },
    });
    throw new ErroAplicacao(409, MENSAGEM_JA_ESTORONADO, 'lancamento_ja_estornado');
  }

  let periodo: PeriodoContabil;
  try {
    periodo = await exigirPeriodoAberto(db, entrada.empresaId, entrada.data);
  } catch (erro) {
    // ADR-0001: tentativa de estorno recusada fica registrada na trilha.
    registrarEvento(db, {
      acao: 'lancamento.estorno_recusado',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'lancamento',
      objetoId: String(original.id),
      dados: {
        motivo: erro instanceof ErroAplicacao ? erro.codigo : 'periodo_invalido',
        data: entrada.data,
      },
    });
    throw erro;
  }

  const partidasOriginais = await partidasDoLancamento(db, original.id);
  const inversas = partidasOriginais.map((p) => ({
    contaId: p.contaId,
    natureza: (p.natureza === 'D' ? 'C' : 'D') as Natureza,
    valorCentavos: p.valorCentavos,
  }));

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const { lancamento: inserido, partidas: partidasInseridas } = inserirLancamentoComPartidas(
        tx,
        {
          empresaId: entrada.empresaId,
          periodoId: periodo.id,
          data: entrada.data,
          historico: `Estorno do lançamento #${original.id}: ${original.historico}`,
          estornoDeId: original.id,
          criadoPor: atorId,
          partidas: inversas,
        },
      );

      auditoria.registrar({
        acao: 'lancamento.estorno',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'lancamento',
        objetoId: String(inserido.id),
        dados: {
          estorno_de_id: original.id,
          data: inserido.data,
          partidas: partidasInseridas.map((p) => ({
            conta_id: p.contaId,
            natureza: p.natureza,
            valor_centavos: p.valorCentavos,
          })),
        },
      });

      return { lancamento: inserido, partidas: partidasInseridas };
    });
  } catch (erro) {
    if (ehViolacaoDeEstornoUnico(erro)) {
      // Corrida (dois estornos simultâneos): o índice único é o retrocesso (CA-26).
      registrarEvento(db, {
        acao: 'lancamento.estorno_recusado',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'lancamento',
        objetoId: String(original.id),
        dados: { motivo: 'estorno_duplicado_concorrente', data: entrada.data },
      });
      throw new ErroAplicacao(409, MENSAGEM_JA_ESTORONADO, 'lancamento_ja_estornado');
    }
    // S-T014-3 (corrigida): qualquer OUTRA violação (FK, CHECK, trigger) é
    // bug real e segue adiante CRUA (500) — nunca mascarada como "já
    // estornado".
    throw erro;
  }
}

/**
 * Recusa de edição/exclusão de lançamento gravado (CA-25/CE-4/R9/RK-4).
 *
 * Não existe ação no produto que edite ou exclua lançamento: `PATCH` e
 * `DELETE` existem apenas para responder com orientação — o caminho de
 * correção é o **estorno** — e a tentativa fica auditada. Nada é persistido.
 */
export async function rejeitarEdicaoExclusao(
  db: AppDb,
  alvo: { lancamentoId: number; empresaId: number },
  atorId: number,
  acao: 'alteracao' | 'exclusao',
): Promise<never> {
  // S-T014-2: tentativa sobre `:id` de OUTRA empresa deixa trilha
  // (`lancamento.tentativa_negada`) sem mudar a resposta (404 idêntico).
  const atual = await lancamentoParaEscritaOu404(db, alvo.lancamentoId, alvo.empresaId, atorId);

  registrarEvento(db, {
    acao: `lancamento.${acao}_recusada`,
    usuarioId: atorId,
    empresaId: alvo.empresaId,
    objetoTipo: 'lancamento',
    objetoId: String(atual.id),
    dados: { motivo: 'imutabilidade_rf08', orientacao: 'estorno' },
  });

  throw new ErroAplicacao(
    405,
    'Lançamentos gravados não podem ser editados nem excluídos: o caminho de correção é o estorno (RF-08).',
    'edicao_exclusao_nao_permitida',
  );
}
