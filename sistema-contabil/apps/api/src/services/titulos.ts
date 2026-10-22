import { and, asc, eq, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  baixa,
  titulo,
  type Baixa,
  type Natureza,
  type SituacaoTitulo,
  type TipoTitulo,
  type Titulo,
} from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';
import { buscarContaNaEmpresa } from './contas.ts';
import {
  ehViolacaoDeEstornoUnico,
  exigirPeriodoAberto,
  inserirLancamentoComPartidas,
  partidasDoLancamento,
} from './lancamentos.ts';
import { periodoDeData } from './periodos.ts';

/**
 * Títulos a pagar/receber, baixa total/parcial, cancelamento e estorno de
 * baixa (RF-13/RF-14/RF-15/RF-24, H8, CA-06/07/16/41/42/43/55; TASK-016).
 *
 * Regras sustentadas aqui:
 * - `valor_centavos` do título é o total; `saldo_centavos` é o residual
 *   abatido por baixas. Situação **derivada**: `aberto` (saldo = total),
 *   `parcial` (0 < saldo < total), `pago` (saldo 0); `cancelado` só pelo
 *   cancelamento;
 * - **D1 (2026-10-22):** `baixa.valor_centavos` é o **bruto abatido do
 *   saldo` — "valor maior que o saldo" (CA-16) é literalmente sobre o bruto;
 *   retenção/encargos são colunas próprias (default 0; entrada e cálculo de
 *   CA-47/CA-48 são T017). O somatório "lançamentos vinculados somam o valor
 *   total do título" (CA-41) vale para baixa **sem** encargos/retenção;
 * - toda baixa e todo estorno de baixa geram lançamento **na mesma
 *   transação** que altera o título e grava a trilha (RF-15/R8): falha no
 *   meio desfaz tudo, sem estado parcial;
 * - **CA-55/T016-F-4:** a recusa de estorno de baixa em período encerrado é
 *   regra de SERVIÇO sobre o **período da baixa** (o estorno seria datado de
 *   hoje e passaria pelo trigger da 0006); o evento de auditoria é gravado
 *   **fora** da transação que abortaria — por isso a tentativa persiste na
 *   trilha;
 * - **D3 (hipótese):** "em aberto" = não quitado nem cancelado; cancelar é
 *   escrita do contador, **não gera lançamento**, zera o saldo residual com
 *   auditoria e preserva os lançamentos das baixas parciais (imutabilidade
 *   R9);
 * - vínculos baixa ↔ título ↔ lançamento são garantidos **NO BANCO** por FKs
 *   compostas `(…, empresa_id)` (S-T014-6); o serviço nunca monta vínculo
 *   alheio à empresa;
 * - **D-R1 (2026-10-22):** as escritas sobre `titulo` (baixa, estorno de
 *   baixa, cancelamento) usam **predicado otimista** no `UPDATE` — o estado
 *   lido (saldo/situação) é exigido no WHERE; `changes !== 1` vira 409
 *   auditado **fora** da transação abortada. Corrida nunca grava saldo
 *   derivado de leitura velha (CA-16); sem `BEGIN IMMEDIATE` nem trigger
 *   (veto humano: a corrida de estorno duplicado é retrocedida pelo índice
 *   único `lancamento_estorno_de_uk`, com match exato de constraint).
 */

/** Centavos → "R$ 1.234,56" para as mensagens de recusa (CA-16 cita valores). */
function reaisDe(centavos: number): string {
  const comSeparador = (centavos / 100).toFixed(2).replace('.', ',');
  return `R$ ${comSeparador}`;
}

function rotuloDoPeriodo(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/** Situação derivada do saldo (RF-13): quitado → pago; parcial → parcial. */
function situacaoPorSaldo(valorCentavos: number, saldoCentavos: number): SituacaoTitulo {
  if (saldoCentavos <= 0) return 'pago';
  if (saldoCentavos >= valorCentavos) return 'aberto';
  return 'parcial';
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Título por id DENTRO da empresa (nunca devolve título alheio — R7; predicado
 * NO WHERE, mesmo padrão de `contas.ts`/S-T014-1).
 */
export async function buscarTituloNaEmpresa(
  db: AppDb,
  tituloId: number,
  empresaId: number,
): Promise<Titulo | undefined> {
  const linhas = await db
    .select()
    .from(titulo)
    .where(and(eq(titulo.id, tituloId), eq(titulo.empresaId, empresaId)))
    .limit(1);
  return linhas[0];
}

/**
 * Título para um ATO DE ESCRITA, com trilha de tentativa cruzada de tenant
 * (mesma semântica de `lancamentoParaEscritaOu404` — S-T014-2): "não existe" e
 * "existe em outra empresa" são distinguíveis só internamente; a resposta é o
 * MESMO 404 nos dois casos (sem oráculo — R7/CA-22).
 */
async function tituloParaEscritaOu404(
  db: AppDb,
  tituloId: number,
  empresaId: number,
  atorId: number,
): Promise<Titulo> {
  const encontrado = await buscarTituloNaEmpresa(db, tituloId, empresaId);
  if (encontrado) return encontrado;

  const alheio = await db
    .select({ id: titulo.id, empresaId: titulo.empresaId })
    .from(titulo)
    .where(eq(titulo.id, tituloId))
    .limit(1);
  if (alheio.length > 0) {
    registrarEvento(db, {
      acao: 'titulo.tentativa_negada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloId),
      dados: { motivo: 'empresa_diferente', empresa_do_titulo: alheio[0]!.empresaId },
    });
  }

  throw new ErroAplicacao(404, 'Título não encontrado nesta empresa.', 'titulo_nao_encontrado');
}

export interface FiltroTitulos {
  tipo?: TipoTitulo | undefined;
  situacao?: SituacaoTitulo | undefined;
}

/** Títulos da empresa em ordem de vencimento (mais antigo primeiro). */
export async function listarTitulos(
  db: AppDb,
  empresaId: number,
  filtro: FiltroTitulos = {},
): Promise<Titulo[]> {
  const condicoes = [eq(titulo.empresaId, empresaId)];
  if (filtro.tipo) condicoes.push(eq(titulo.tipo, filtro.tipo));
  if (filtro.situacao) condicoes.push(eq(titulo.situacao, filtro.situacao));
  return db
    .select()
    .from(titulo)
    .where(and(...condicoes))
    .orderBy(asc(titulo.vencimento), asc(titulo.id));
}

/** Baixas de um título em ordem de gravação (rastreabilidade RF-15). */
export async function listarBaixasDoTitulo(db: AppDb, tituloId: number): Promise<Baixa[]> {
  return db.select().from(baixa).where(eq(baixa.tituloId, tituloId)).orderBy(asc(baixa.id));
}

/** Baixa por id DENTRO da empresa (R7; predicado NO WHERE). */
async function buscarBaixaNaEmpresa(
  db: AppDb,
  baixaId: number,
  empresaId: number,
): Promise<Baixa | undefined> {
  const linhas = await db
    .select()
    .from(baixa)
    .where(and(eq(baixa.id, baixaId), eq(baixa.empresaId, empresaId)))
    .limit(1);
  return linhas[0];
}

async function baixaParaEscritaOu404(
  db: AppDb,
  baixaId: number,
  empresaId: number,
  atorId: number,
): Promise<Baixa> {
  const encontrada = await buscarBaixaNaEmpresa(db, baixaId, empresaId);
  if (encontrada) return encontrada;

  const alheia = await db
    .select({ id: baixa.id, empresaId: baixa.empresaId })
    .from(baixa)
    .where(eq(baixa.id, baixaId))
    .limit(1);
  if (alheia.length > 0) {
    registrarEvento(db, {
      acao: 'baixa.tentativa_negada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaId),
      dados: { motivo: 'empresa_diferente', empresa_da_baixa: alheia[0]!.empresaId },
    });
  }

  throw new ErroAplicacao(404, 'Baixa não encontrada nesta empresa.', 'baixa_nao_encontrada');
}

/* -------------------------------------------------------------------------- */
/* Criação de título (RF-13/RF-14)                                             */
/* -------------------------------------------------------------------------- */

export interface EntradaTitulo {
  empresaId: number;
  tipo: TipoTitulo;
  contraparte: string;
  descricao?: string | null | undefined;
  /** `YYYY-MM-DD` já validado na camada de entrada. */
  vencimento: string;
  valorCentavos: number;
  contaId: number;
}

/**
 * Cria um título a pagar/receber (CA-06/CA-07): nasce `aberto` com saldo =
 * valor total. A conta contábil precisa existir DENTRO da empresa (CE-2). Em
 * qualquer recusa nada é persistido (a escrita e a trilha compartilham a
 * transação; as validações vêm antes dela).
 */
export async function criarTitulo(db: AppDb, entrada: EntradaTitulo, atorId: number): Promise<Titulo> {
  if (entrada.valorCentavos <= 0) {
    throw new ErroAplicacao(400, 'O valor deve ser maior que zero (em centavos).', 'valor_invalido');
  }
  const contaDoTitulo = await buscarContaNaEmpresa(db, entrada.contaId, entrada.empresaId);
  if (!contaDoTitulo) {
    // Recusa auditada como as irmãs do fluxo (mesmo padrão de
    // `titulo.baixa_recusada`): conta precisa existir DENTRO da empresa (CE-2).
    registrarEvento(db, {
      acao: 'titulo.criacao_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      dados: { motivo: 'conta_nao_encontrada', conta_id: entrada.contaId },
    });
    throw new ErroAplicacao(
      404,
      `A conta ${entrada.contaId} não existe nesta empresa.`,
      'conta_nao_encontrada',
    );
  }

  return transacaoComAuditoria(db, (tx, auditoria) => {
    const inserido = tx
      .insert(titulo)
      .values({
        empresaId: entrada.empresaId,
        tipo: entrada.tipo,
        contraparte: entrada.contraparte,
        descricao: entrada.descricao ?? null,
        vencimento: entrada.vencimento,
        valorCentavos: entrada.valorCentavos,
        contaId: entrada.contaId,
        situacao: 'aberto',
        saldoCentavos: entrada.valorCentavos,
        criadoPor: atorId,
      })
      .returning()
      .all()[0]!;

    auditoria.registrar({
      acao: 'titulo.criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(inserido.id),
      dados: {
        tipo: inserido.tipo,
        contraparte: inserido.contraparte,
        vencimento: inserido.vencimento,
        valor_centavos: inserido.valorCentavos,
        conta_id: inserido.contaId,
        situacao: inserido.situacao,
        saldo_centavos: inserido.saldoCentavos,
      },
    });

    return inserido;
  });
}

/* -------------------------------------------------------------------------- */
/* Cancelamento (RF-13/F11; D3 — sem CA correspondente)                        */
/* -------------------------------------------------------------------------- */

/**
 * Cancela um título **em aberto** (não quitado nem cancelado — hipótese D3):
 * zera o saldo residual, muda para `cancelado` e audita. **Não gera
 * lançamento**; os lançamentos das baixas parciais permanecem (R9). Título
 * pago ou já cancelado é recusado com 409 auditado.
 */
export async function cancelarTitulo(
  db: AppDb,
  alvo: { tituloId: number; empresaId: number },
  atorId: number,
): Promise<Titulo> {
  const atual = await tituloParaEscritaOu404(db, alvo.tituloId, alvo.empresaId, atorId);

  if (atual.situacao === 'pago' || atual.situacao === 'cancelado') {
    registrarEvento(db, {
      acao: 'titulo.cancelamento_recusado',
      usuarioId: atorId,
      empresaId: alvo.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(atual.id),
      dados: { motivo: atual.situacao === 'pago' ? 'titulo_quitado' : 'titulo_ja_cancelado' },
    });
    throw new ErroAplicacao(
      409,
      atual.situacao === 'pago'
        ? 'Título quitado não pode ser cancelado: cancele apenas títulos em aberto (RF-13).'
        : 'Título já cancelado: o cancelamento é uma ação única (RF-13).',
      atual.situacao === 'pago' ? 'titulo_quitado' : 'titulo_ja_cancelado',
    );
  }

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      // Predicado otimista (D-R1): só cancela se a situação ainda é a lida
      // antes da transação; `changes !== 1` = corrida → 409 (nada gravado).
      const linhasAtualizadas = tx
        .update(titulo)
        .set({ situacao: 'cancelado', saldoCentavos: 0, atualizadoEm: new Date().toISOString() })
        .where(and(eq(titulo.id, atual.id), eq(titulo.situacao, atual.situacao)))
        .returning()
        .all();
      if (linhasAtualizadas.length !== 1) {
        throw new ErroAplicacao(
          409,
          MENSAGEM_TITULO_MODIFICADO_CONCORRENTEMENTE,
          'titulo_modificado_concorrentemente',
        );
      }
      const cancelado = linhasAtualizadas[0]!;

      auditoria.registrar({
        acao: 'titulo.cancelamento',
        usuarioId: atorId,
        empresaId: alvo.empresaId,
        objetoTipo: 'titulo',
        objetoId: String(cancelado.id),
        dados: {
          saldo_anterior_centavos: atual.saldoCentavos,
          saldo_centavos: cancelado.saldoCentavos,
          situacao: cancelado.situacao,
          gerou_lancamento: false,
        },
      });

      return cancelado;
    });
  } catch (erro) {
    if (erro instanceof ErroAplicacao && erro.codigo === 'titulo_modificado_concorrentemente') {
      // Trilha da recusa FORA da transação abortada (a de dentro foi
      // desfeita pelo rollback — R8: sem escrita, sem evento interno).
      registrarEvento(db, {
        acao: 'titulo.cancelamento_recusado',
        usuarioId: atorId,
        empresaId: alvo.empresaId,
        objetoTipo: 'titulo',
        objetoId: String(atual.id),
        dados: { motivo: 'titulo_modificado_concorrentemente', situacao_lida: atual.situacao },
      });
    }
    throw erro;
  }
}

/* -------------------------------------------------------------------------- */
/* Baixa total/parcial (RF-13/RF-14/RF-15, CA-06/07/16/41)                     */
/* -------------------------------------------------------------------------- */

export interface EntradaBaixa {
  tituloId: number;
  empresaId: number;
  /** `YYYY-MM-DD` já validado na camada de entrada. */
  data: string;
  /** Bruto abatido do saldo (D1). */
  valorCentavos: number;
  /** Conta do outro lado do lançamento vinculado (caixa/banco). */
  contaContrapartidaId: number;
}

export interface ResultadoBaixa {
  titulo: Titulo;
  baixa: Baixa;
}

/**
 * Registra uma baixa total ou parcial (CA-06/CA-07/CA-41):
 *
 * - recusas ANTES da transação (CA-16): valor ≤ 0; valor > saldo (mensagem
 *   com os dois valores); título pago/cancelado; conta inexistente; data em
 *   período **não cadastrado ou encerrado** (check antes do INSERT — é o que
 *   evita o abort do trigger da 0006 no meio da operação, T016-F-4);
 * - dentro da MESMA transação: lançamento vinculado (RF-15) + baixa +
 *   atualização do título + trilha (`lancamento.criacao` e `titulo.baixa`);
 * - contrapartida: `pagar` = D conta do título / C contrapartida; `receber` =
 *   D contrapartida / C conta do título.
 */
export async function criarBaixa(db: AppDb, entrada: EntradaBaixa, atorId: number): Promise<ResultadoBaixa> {
  const tituloAtual = await tituloParaEscritaOu404(db, entrada.tituloId, entrada.empresaId, atorId);

  if (entrada.valorCentavos <= 0) {
    registrarEvento(db, {
      acao: 'titulo.baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloAtual.id),
      dados: { motivo: 'valor_nao_positivo', valor_centavos: entrada.valorCentavos },
    });
    throw new ErroAplicacao(400, 'O valor deve ser maior que zero (em centavos).', 'valor_invalido');
  }

  if (tituloAtual.situacao === 'pago' || tituloAtual.situacao === 'cancelado') {
    registrarEvento(db, {
      acao: 'titulo.baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloAtual.id),
      dados: {
        motivo: tituloAtual.situacao === 'pago' ? 'titulo_quitado' : 'titulo_cancelado',
        situacao: tituloAtual.situacao,
      },
    });
    throw new ErroAplicacao(
      409,
      tituloAtual.situacao === 'pago'
        ? 'Título quitado não aceita nova baixa (RF-13/CA-16).'
        : 'Título cancelado não aceita nova baixa (RF-13/CA-16).',
      tituloAtual.situacao === 'pago' ? 'titulo_quitado' : 'titulo_cancelado',
    );
  }

  // CA-16: valor bruto maior que o saldo do título é recusado (D1: literal
  // sobre o bruto), citando os dois valores na mensagem.
  if (entrada.valorCentavos > tituloAtual.saldoCentavos) {
    registrarEvento(db, {
      acao: 'titulo.baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloAtual.id),
      dados: {
        motivo: 'valor_maior_que_saldo',
        valor_centavos: entrada.valorCentavos,
        saldo_centavos: tituloAtual.saldoCentavos,
      },
    });
    throw new ErroAplicacao(
      400,
      `Valor da baixa (${reaisDe(entrada.valorCentavos)}) maior que o saldo do título ` +
        `(${reaisDe(tituloAtual.saldoCentavos)}). Informe um valor até o saldo em aberto.`,
      'valor_maior_que_saldo',
    );
  }

  const contrapartida = await buscarContaNaEmpresa(
    db,
    entrada.contaContrapartidaId,
    entrada.empresaId,
  );
  if (!contrapartida) {
    // Recusa auditada como as irmãs da mesma função (CE-2: conta precisa
    // existir DENTRO da empresa).
    registrarEvento(db, {
      acao: 'titulo.baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloAtual.id),
      dados: { motivo: 'conta_nao_encontrada', conta_id: entrada.contaContrapartidaId },
    });
    throw new ErroAplicacao(
      404,
      `A conta de contrapartida ${entrada.contaContrapartidaId} não existe nesta empresa.`,
      'conta_nao_encontrada',
    );
  }

  // Período da DATA DA BAIXA precisa existir e estar aberto — checado ANTES
  // da transação (T016-F-4): assim o INSERT do lançamento nunca chega a ser
  // abortado pelo trigger da 0006 no meio da operação. Recusa auditada.
  let periodoId: number;
  try {
    periodoId = (await exigirPeriodoAberto(db, entrada.empresaId, entrada.data)).id;
  } catch (erro) {
    registrarEvento(db, {
      acao: 'titulo.baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'titulo',
      objetoId: String(tituloAtual.id),
      dados: {
        motivo: erro instanceof ErroAplicacao ? erro.codigo : 'periodo_invalido',
        data: entrada.data,
        valor_centavos: entrada.valorCentavos,
      },
    });
    throw erro;
  }

  const direcao = tituloAtual.tipo === 'pagar' ? ('D' as Natureza) : ('C' as Natureza);
  const contraparteNatureza: Natureza = direcao === 'D' ? 'C' : 'D';
  const historico = `Baixa do título #${tituloAtual.id}: ${tituloAtual.contraparte}`.slice(0, 200);

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const { lancamento: lancamentoBaixa } = inserirLancamentoComPartidas(tx, {
        empresaId: entrada.empresaId,
        periodoId,
        data: entrada.data,
        historico,
        estornoDeId: null,
        criadoPor: atorId,
        partidas: [
          { contaId: tituloAtual.contaId, natureza: direcao, valorCentavos: entrada.valorCentavos },
          {
            contaId: contrapartida.id,
            natureza: contraparteNatureza,
            valorCentavos: entrada.valorCentavos,
          },
        ],
      });

      const criada = tx
        .insert(baixa)
        .values({
          empresaId: entrada.empresaId,
          tituloId: tituloAtual.id,
          lancamentoId: lancamentoBaixa.id,
          estornoLancamentoId: null,
          data: entrada.data,
          valorCentavos: entrada.valorCentavos,
          retencaoCentavos: 0,
          encargosCentavos: 0,
          criadoPor: atorId,
        })
        .returning()
        .all()[0]!;

      // Predicado otimista (D-R1, 2026-10-22): o UPDATE só passa se o título
      // ainda está EXATAMENTE no estado lido antes da transação (mesma
      // semântica do `isNull(baixa.estornoLancamentoId)` do estorno abaixo).
      // `changes !== 1` = corrida (dois POST /baixas simultâneos) → 409; o
      // throw desfaz por rollback o lançamento e a baixa já inseridos aqui.
      const novoSaldo = tituloAtual.saldoCentavos - entrada.valorCentavos;
      const linhasAtualizadas = tx
        .update(titulo)
        .set({
          saldoCentavos: novoSaldo,
          situacao: situacaoPorSaldo(tituloAtual.valorCentavos, novoSaldo),
          atualizadoEm: new Date().toISOString(),
        })
        .where(
          and(
            eq(titulo.id, tituloAtual.id),
            eq(titulo.saldoCentavos, tituloAtual.saldoCentavos),
            eq(titulo.situacao, tituloAtual.situacao),
          ),
        )
        .returning()
        .all();
      if (linhasAtualizadas.length !== 1) {
        throw new ErroAplicacao(
          409,
          MENSAGEM_TITULO_MODIFICADO_CONCORRENTEMENTE,
          'titulo_modificado_concorrentemente',
        );
      }
      const atualizado = linhasAtualizadas[0]!;

      auditoria.registrar({
        acao: 'lancamento.criacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'lancamento',
        objetoId: String(lancamentoBaixa.id),
        dados: {
          origem: 'baixa',
          baixa_id: criada.id,
          titulo_id: tituloAtual.id,
          data: lancamentoBaixa.data,
          historico: lancamentoBaixa.historico,
          periodo_id: lancamentoBaixa.periodoId,
          debitos_centavos: entrada.valorCentavos,
          creditos_centavos: entrada.valorCentavos,
        },
      });
      auditoria.registrar({
        acao: 'titulo.baixa',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'baixa',
        objetoId: String(criada.id),
        dados: {
          titulo_id: tituloAtual.id,
          lancamento_id: lancamentoBaixa.id,
          data: criada.data,
          valor_centavos: criada.valorCentavos,
          retencao_centavos: criada.retencaoCentavos,
          encargos_centavos: criada.encargosCentavos,
          saldo_centavos: atualizado.saldoCentavos,
          situacao: atualizado.situacao,
        },
      });

      return { titulo: atualizado, baixa: criada };
    });
  } catch (erro) {
    if (erro instanceof ErroAplicacao && erro.codigo === 'titulo_modificado_concorrentemente') {
      // Trilha da recusa FORA da transação abortada (a de dentro foi
      // desfeita pelo rollback — lançamento, baixa e evento interno juntos).
      registrarEvento(db, {
        acao: 'titulo.baixa_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'titulo',
        objetoId: String(tituloAtual.id),
        dados: {
          motivo: 'titulo_modificado_concorrentemente',
          saldo_lido_centavos: tituloAtual.saldoCentavos,
          situacao_lida: tituloAtual.situacao,
          valor_centavos: entrada.valorCentavos,
        },
      });
    }
    throw erro;
  }
}

/* -------------------------------------------------------------------------- */
/* Estorno de baixa (RF-24/F14, CA-42/43/55)                                   */
/* -------------------------------------------------------------------------- */

/** Mensagem única da recusa de estorno de baixa já estornada (RF-24). */
const MENSAGEM_BAIXA_JA_ESTORNADA =
  'Esta baixa já foi estornada: cada baixa só pode ser estornada uma vez (RF-24). ' +
  'Para corrigir, registre uma nova baixa.';

/**
 * Mensagem única da recusa por CORRIDA (D-R1, 2026-10-22): o título mudou
 * entre a leitura de validação e o `UPDATE` com predicado otimista — a
 * operação inteira (lançamento, baixa/estorno e trilha interna) é desfeita
 * por rollback e a recusa é auditada FORA da transação abortada.
 */
const MENSAGEM_TITULO_MODIFICADO_CONCORRENTEMENTE =
  'Este título foi alterado por outra operação enquanto esta era processada: nada foi ' +
  'gravado para não corromper o saldo (CA-16). Tente novamente.';

/**
 * Estorna uma baixa (CA-42/CA-43/CA-55):
 *
 * - recusas auditadas **antes** da transação: baixa já estornada (única por
 *   baixa); **período da baixa encerrado** (CA-55/T016-F-4 — evento gravado
 *   fora da transação, por isso a tentativa persiste na trilha); título
 *   cancelado (D3); período da data do estorno (hoje) não cadastrado/encerrado;
 * - na MESMA transação: lançamento de estorno **inverso** vinculado ao
 *   lançamento da baixa (`estorno_de_id` + coluna `estorno_lancamento_id` da
 *   baixa, única no banco), restauração do saldo/situação e trilha
 *   (`lancamento.estorno` + `titulo.estorno_baixa`);
 * - título volta a `aberto` (saldo = total) ou `parcial` (0 < saldo < total).
 */
export async function estornarBaixa(
  db: AppDb,
  entrada: { baixaId: number; empresaId: number; data: string },
  atorId: number,
): Promise<ResultadoBaixa> {
  const baixaAtual = await baixaParaEscritaOu404(db, entrada.baixaId, entrada.empresaId, atorId);

  if (baixaAtual.estornoLancamentoId !== null) {
    registrarEvento(db, {
      acao: 'titulo.estorno_baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaAtual.id),
      dados: {
        motivo: 'baixa_ja_estornada',
        titulo_id: baixaAtual.tituloId,
        estorno_lancamento_id: baixaAtual.estornoLancamentoId,
      },
    });
    throw new ErroAplicacao(409, MENSAGEM_BAIXA_JA_ESTORNADA, 'baixa_ja_estornada');
  }

  const tituloAtual = await buscarTituloNaEmpresa(db, baixaAtual.tituloId, entrada.empresaId);
  if (!tituloAtual) {
    // Inalcançável por FK composta (baixa ↔ título compartilham empresa_id).
    throw new ErroAplicacao(404, 'Título não encontrado nesta empresa.', 'titulo_nao_encontrado');
  }

  // CA-55: o estorno seria datado de HOJE e passaria pelo trigger da 0006 —
  // a recusa é regra de serviço sobre o PERÍODO DA BAIXA. O evento é gravado
  // AQUI, fora de qualquer transação que pudesse abortar (T016-F-4).
  const periodoDaBaixa = await periodoDeData(db, entrada.empresaId, baixaAtual.data);
  if (!periodoDaBaixa) {
    registrarEvento(db, {
      acao: 'titulo.estorno_baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaAtual.id),
      dados: { motivo: 'periodo_nao_encontrado', titulo_id: baixaAtual.tituloId, data: baixaAtual.data },
    });
    throw new ErroAplicacao(
      404,
      `Não existe período contábil para a data ${baixaAtual.data} da baixa.`,
      'periodo_nao_encontrado',
    );
  }
  if (periodoDaBaixa.encerradoEm !== null) {
    registrarEvento(db, {
      acao: 'titulo.estorno_baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaAtual.id),
      dados: {
        motivo: 'periodo_encerrado',
        titulo_id: baixaAtual.tituloId,
        data_baixa: baixaAtual.data,
        periodo_id: periodoDaBaixa.id,
        ano: periodoDaBaixa.ano,
        mes: periodoDaBaixa.mes,
        data_estorno: entrada.data,
      },
    });
    throw new ErroAplicacao(
      409,
      `A baixa pertence ao período ${rotuloDoPeriodo(periodoDaBaixa.ano, periodoDaBaixa.mes)}, que está ` +
        'encerrado: nada é estornado de período encerrado (RF-08/RF-09). ' +
        'O título permanece inalterado e a tentativa fica registrada na trilha.',
      'periodo_encerrado',
    );
  }

  if (tituloAtual.situacao === 'cancelado') {
    registrarEvento(db, {
      acao: 'titulo.estorno_baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaAtual.id),
      dados: { motivo: 'titulo_cancelado', titulo_id: tituloAtual.id },
    });
    throw new ErroAplicacao(
      409,
      'O título desta baixa foi cancelado: o cancelamento preserva os lançamentos das baixas ' +
        'e o estorno não reabre um título cancelado (RF-13/RF-24).',
      'titulo_cancelado',
    );
  }

  // Data do ESTORNO em período aberto (padrão: hoje) — mesma regra do
  // estorno de lançamento; recusa auditada como tentativa.
  let periodoEstornoId: number;
  try {
    periodoEstornoId = (await exigirPeriodoAberto(db, entrada.empresaId, entrada.data)).id;
  } catch (erro) {
    registrarEvento(db, {
      acao: 'titulo.estorno_baixa_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'baixa',
      objetoId: String(baixaAtual.id),
      dados: {
        motivo: erro instanceof ErroAplicacao ? erro.codigo : 'periodo_invalido',
        titulo_id: baixaAtual.tituloId,
        data_estorno: entrada.data,
      },
    });
    throw erro;
  }

  const partidasOriginais = await partidasDoLancamento(db, baixaAtual.lancamentoId);
  const inversas = partidasOriginais.map((p) => ({
    contaId: p.contaId,
    natureza: (p.natureza === 'D' ? 'C' : 'D') as Natureza,
    valorCentavos: p.valorCentavos,
  }));

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const { lancamento: lancamentoEstorno } = inserirLancamentoComPartidas(tx, {
        empresaId: entrada.empresaId,
        periodoId: periodoEstornoId,
        data: entrada.data,
        historico: `Estorno da baixa #${baixaAtual.id} do título #${tituloAtual.id}: ${tituloAtual.contraparte}`.slice(
          0,
          200,
        ),
        estornoDeId: baixaAtual.lancamentoId,
        criadoPor: atorId,
        partidas: inversas,
      });

      // "Uma única vez por baixa" reforçada NO BANCO: só atualiza se ainda não
      // tem estorno (a coluna é única — `baixa_estorno_lancamento_uk`).
      const atualizacoes = tx
        .update(baixa)
        .set({ estornoLancamentoId: lancamentoEstorno.id })
        .where(and(eq(baixa.id, baixaAtual.id), isNull(baixa.estornoLancamentoId)))
        .run();
      if (atualizacoes.changes !== 1) {
        throw new ErroAplicacao(409, MENSAGEM_BAIXA_JA_ESTORNADA, 'baixa_ja_estornada');
      }

      // Predicado otimista (D-R1, 2026-10-22): a restauração do saldo só
      // passa se o título ainda está no estado lido antes da transação —
      // `changes !== 1` = corrida (ex.: baixa simultânea sobre o mesmo
      // título) → 409; o throw desfaz por rollback o estorno recém-inserido.
      const novoSaldo = tituloAtual.saldoCentavos + baixaAtual.valorCentavos;
      const linhasAtualizadas = tx
        .update(titulo)
        .set({
          saldoCentavos: novoSaldo,
          situacao: situacaoPorSaldo(tituloAtual.valorCentavos, novoSaldo),
          atualizadoEm: new Date().toISOString(),
        })
        .where(
          and(
            eq(titulo.id, tituloAtual.id),
            eq(titulo.saldoCentavos, tituloAtual.saldoCentavos),
            eq(titulo.situacao, tituloAtual.situacao),
          ),
        )
        .returning()
        .all();
      if (linhasAtualizadas.length !== 1) {
        throw new ErroAplicacao(
          409,
          MENSAGEM_TITULO_MODIFICADO_CONCORRENTEMENTE,
          'titulo_modificado_concorrentemente',
        );
      }
      const atualizado = linhasAtualizadas[0]!;

      auditoria.registrar({
        acao: 'lancamento.estorno',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'lancamento',
        objetoId: String(lancamentoEstorno.id),
        dados: {
          origem: 'estorno_de_baixa',
          baixa_id: baixaAtual.id,
          titulo_id: tituloAtual.id,
          estorno_de_id: baixaAtual.lancamentoId,
          data: lancamentoEstorno.data,
          periodo_id: lancamentoEstorno.periodoId,
        },
      });
      auditoria.registrar({
        acao: 'titulo.estorno_baixa',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'baixa',
        objetoId: String(baixaAtual.id),
        dados: {
          titulo_id: tituloAtual.id,
          lancamento_id: baixaAtual.lancamentoId,
          estorno_lancamento_id: lancamentoEstorno.id,
          valor_centavos: baixaAtual.valorCentavos,
          saldo_centavos: atualizado.saldoCentavos,
          situacao: atualizado.situacao,
          data: entrada.data,
        },
      });

      return { titulo: atualizado, baixa: { ...baixaAtual, estornoLancamentoId: lancamentoEstorno.id } };
    });
  } catch (erro) {
    // Corrida de dois estornos da MESMA baixa: o INSERT do estorno (anterior
    // ao UPDATE guardado) viola `lancamento_estorno_de_uk` — sem este catch o
    // SqliteError cru viraria 500 SEM trilha. Com match EXATO de constraint
    // (S-T014-3) vira o MESMO 409 auditado do caminho sequencial; qualquer
    // OUTRA violação é bug real e segue adiante crua.
    if (ehViolacaoDeEstornoUnico(erro)) {
      registrarEvento(db, {
        acao: 'titulo.estorno_baixa_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'baixa',
        objetoId: String(baixaAtual.id),
        dados: {
          motivo: 'baixa_ja_estornada_concorrente',
          titulo_id: baixaAtual.tituloId,
          lancamento_id: baixaAtual.lancamentoId,
        },
      });
      throw new ErroAplicacao(409, MENSAGEM_BAIXA_JA_ESTORNADA, 'baixa_ja_estornada');
    }
    if (erro instanceof ErroAplicacao && erro.codigo === 'titulo_modificado_concorrentemente') {
      // Trilha da recusa FORA da transação abortada (a de dentro foi
      // desfeita pelo rollback — lançamento de estorno e trilha juntos).
      registrarEvento(db, {
        acao: 'titulo.estorno_baixa_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'baixa',
        objetoId: String(baixaAtual.id),
        dados: {
          motivo: 'titulo_modificado_concorrentemente',
          titulo_id: tituloAtual.id,
          saldo_lido_centavos: tituloAtual.saldoCentavos,
          situacao_lida: tituloAtual.situacao,
        },
      });
    }
    throw erro;
  }
}
