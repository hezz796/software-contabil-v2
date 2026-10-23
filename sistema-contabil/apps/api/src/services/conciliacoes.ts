import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  conciliacao,
  lancamento,
  titulo,
  type Conciliacao,
  type ObjetoConciliacaoBanco,
} from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';
import { itemExtratoOu404 } from './extrato.ts';
import { buscarLancamentoNaEmpresa } from './lancamentos.ts';
import { buscarTituloNaEmpresa } from './titulos.ts';

/**
 * Conciliação bancária item a item (RF-16, CA-08/CA-28/CA-44; TASK-018).
 *
 * Regras sustentadas aqui:
 * - **um objeto por vez** por conciliação (T018-F-2): `objeto_tipo` define se
 *   `titulo_id` ou `lancamento_id` é preenchido (CHECK no banco);
 * - **UMA linha por item** (`conciliacao_item_uk` total): desconciliar é
 *   UPDATE que preenche `desconciliado_em` — nunca DELETE (história
 *   preservada na linha + trilha, CA-28); reconciliar REATIVA a mesma linha;
 * - **exclusividade do objeto entre vigentes**: dois itens não conciliam o
 *   mesmo título/lançamento até o primeiro ser desconciliado (índices
 *   únicos parciais + pré-check com 409 auditado);
 * - **corrida = D-R1** (ADR-0008): o UPDATE de reativação exige
 *   `desconciliado_em IS NOT NULL` e o da desconciliação exige
 *   `desconciliado_em IS NULL`; `changes !== 1` vira o MESMO 409 do caminho
 *   sequencial, com a recusa auditada FORA da transação abortada;
 * - recusa com id alheio devolve o MESMO 404 do inexistente (sem oráculo);
 *   a trilha só registra a tentativa alheia real;
 * - o estorno de baixa consulta `conciliacao` direto (CA-44) para não criar
 *   import circular de serviço.
 */

/** Violation matcher (padrão S-T014-3): só as unicidades da `conciliacao` viram 409. */
function ehViolacaoDeConciliacaoUnica(erro: unknown): boolean {
  const candidato = erro as { code?: unknown; message?: unknown } | null;
  if (typeof candidato?.code !== 'string' || candidato.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
    return false;
  }
  if (typeof candidato.message !== 'string') return false;
  return (
    candidato.message.includes('conciliacao_item_uk') ||
    candidato.message.includes('conciliacao_titulo_uk') ||
    candidato.message.includes('conciliacao_lancamento_uk')
  );
}

/** Conciliação por id DENTRO da empresa (R7: nunca devolve alheia). */
async function buscarConciliacaoNaEmpresa(
  db: AppDb,
  conciliacaoId: number,
  empresaId: number,
): Promise<Conciliacao | undefined> {
  const linhas = await db
    .select()
    .from(conciliacao)
    .where(and(eq(conciliacao.id, conciliacaoId), eq(conciliacao.empresaId, empresaId)));
  return linhas[0];
}

/** Título da empresa ou 404 idêntico (inexistente × alheio); trilha só no alheio. */
async function tituloOu404Auditado(
  db: AppDb,
  tituloId: number,
  empresaId: number,
  atorId: number,
): Promise<number> {
  const linha = await buscarTituloNaEmpresa(db, tituloId, empresaId);
  if (linha) return linha.id;
  const alheio = await db
    .select({ empresaId: titulo.empresaId })
    .from(titulo)
    .where(eq(titulo.id, tituloId));
  if (alheio[0]) {
    registrarEvento(db, {
      acao: 'conciliacao.criacao_recusada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'conciliacao',
      dados: { motivo: 'empresa_diferente', empresa_do_titulo: alheio[0].empresaId },
    });
  }
  throw new ErroAplicacao(404, 'Título não encontrado nesta empresa.', 'titulo_nao_encontrado');
}

/** Lançamento da empresa ou 404 idêntico (inexistente × alheio); trilha só no alheio. */
async function lancamentoOu404Auditado(
  db: AppDb,
  lancamentoId: number,
  empresaId: number,
  atorId: number,
): Promise<number> {
  const linha = await buscarLancamentoNaEmpresa(db, lancamentoId, empresaId);
  if (linha) return linha.id;
  const alheio = await db
    .select({ empresaId: lancamento.empresaId })
    .from(lancamento)
    .where(eq(lancamento.id, lancamentoId));
  if (alheio[0]) {
    registrarEvento(db, {
      acao: 'conciliacao.criacao_recusada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'conciliacao',
      dados: { motivo: 'empresa_diferente', empresa_do_lancamento: alheio[0].empresaId },
    });
  }
  throw new ErroAplicacao(
    404,
    'Lançamento não encontrado nesta empresa.',
    'lancamento_nao_encontrado',
  );
}

/** Conciliação VIGENTE (não desfeita) de um item. */
async function conciliacaoVigenteDoItem(
  db: AppDb,
  itemExtratoId: number,
): Promise<Conciliacao | undefined> {
  const linhas = await db
    .select()
    .from(conciliacao)
    .where(and(eq(conciliacao.itemExtratoId, itemExtratoId), isNull(conciliacao.desconciliadoEm)));
  return linhas[0];
}

/** Conciliação VIGENTE sobre um objeto (título ou lançamento). */
async function conciliacaoVigenteDoObjeto(
  db: AppDb,
  empresaId: number,
  objetoTipo: ObjetoConciliacaoBanco,
  objetoId: number,
): Promise<Conciliacao | undefined> {
  const condicao =
    objetoTipo === 'titulo'
      ? eq(conciliacao.tituloId, objetoId)
      : eq(conciliacao.lancamentoId, objetoId);
  const linhas = await db
    .select()
    .from(conciliacao)
    .where(
      and(
        eq(conciliacao.empresaId, empresaId),
        isNull(conciliacao.desconciliadoEm),
        condicao,
      ),
    );
  return linhas[0];
}

export interface EntradaConciliacao {
  empresaId: number;
  itemExtratoId: number;
  objetoTipo: ObjetoConciliacaoBanco;
  tituloId: number | null;
  lancamentoId: number | null;
}

/**
 * Mensagem única da recusa "item de extrato já conciliado": o pré-check
 * sequencial e a CORRIDA (D-R1) respondem exatamente a mesma coisa — o
 * cliente não distingue o caminho, a trilha tampouco precisa.
 */
const MENSAGEM_ITEM_JA_CONCILIADO =
  'Este item de extrato já está conciliado: desconcilie a conciliação atual antes ' +
  'de vincular o item a outro objeto (CA-28).';

/**
 * Cria (ou REATIVA) a conciliação do item com o título/lançamento (CA-08/28).
 *
 * Pré-checks com recusa auditada `conciliacao.criacao_recusada`: item já
 * conciliado (`item_ja_conciliado`), objeto já conciliado a outro item
 * (`objeto_ja_conciliado`). A corrida entre pré-check e gravação é
 * retrocedida pelo índice único E pelo predicado otimista (D-R1) e vira o
 * MESMO 409, auditado fora da transação abortada.
 */
export async function criarConciliacao(
  db: AppDb,
  entrada: EntradaConciliacao,
  atorId: number,
): Promise<Conciliacao> {
  // Item da empresa (404 idêntico; trilha só no alheio real)
  await itemExtratoOu404(db, entrada.itemExtratoId, entrada.empresaId, atorId);

  const recusarCriacao = (motivo: string, dados: Record<string, unknown>, erro: ErroAplicacao): never => {
    registrarEvento(db, {
      acao: 'conciliacao.criacao_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'conciliacao',
      dados: { motivo, item_extrato_id: entrada.itemExtratoId, ...dados },
    });
    throw erro;
  };

  const vigenteDoItem = await conciliacaoVigenteDoItem(db, entrada.itemExtratoId);
  if (vigenteDoItem) {
    recusarCriacao(
      'item_ja_conciliado',
      { conciliacao_id: vigenteDoItem.id },
      new ErroAplicacao(409, MENSAGEM_ITEM_JA_CONCILIADO, 'item_ja_conciliado'),
    );
  }

  const objetoId =
    entrada.objetoTipo === 'titulo'
      ? await tituloOu404Auditado(db, entrada.tituloId!, entrada.empresaId, atorId)
      : await lancamentoOu404Auditado(db, entrada.lancamentoId!, entrada.empresaId, atorId);

  const vigenteDoObjeto = await conciliacaoVigenteDoObjeto(
    db,
    entrada.empresaId,
    entrada.objetoTipo,
    objetoId,
  );
  if (vigenteDoObjeto) {
    recusarCriacao(
      'objeto_ja_conciliado',
      { objeto_tipo: entrada.objetoTipo, objeto_id: objetoId, conciliacao_id: vigenteDoObjeto.id },
      new ErroAplicacao(
        409,
        `Este ${entrada.objetoTipo === 'titulo' ? 'título' : 'lançamento'} já está conciliado a ` +
          'outro item de extrato: desconcilie o item atual antes de conciliar outro (CA-28).',
        'objeto_ja_conciliado',
      ),
    );
  }

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      // Uma linha por item (histórico): se existe (desfeita), REATIVA;
      // senão, insere. O estado "desconciliado" é sempre UPDATE, nunca DELETE.
      const existente = tx
        .select({ id: conciliacao.id, desconciliadoEm: conciliacao.desconciliadoEm })
        .from(conciliacao)
        .where(eq(conciliacao.itemExtratoId, entrada.itemExtratoId))
        .get();

      // Corrida (D-R1): o pré-check viu a linha desfeita/ausente, mas outra
      // requisição a REATIVOU/criou enquanto esta era processada — recusar em
      // vez de sobrescrever o vínculo recém-criado (a violência do CA-28).
      if (existente?.desconciliadoEm === null) {
        throw new ErroAplicacao(409, MENSAGEM_ITEM_JA_CONCILIADO, 'item_ja_conciliado');
      }

      const agora = new Date().toISOString();
      let linha: Conciliacao;
      if (existente) {
        // Predicado otimista (D-R1): só REATIVA quem AINDA está desconciliado;
        // `length !== 1` = corrida → a transação aborta e a recusa é auditada
        // FORA dela (no catch), sem gravar a reativação.
        const reativadas = tx
          .update(conciliacao)
          .set({
            objetoTipo: entrada.objetoTipo,
            tituloId: entrada.objetoTipo === 'titulo' ? objetoId : null,
            lancamentoId: entrada.objetoTipo === 'lancamento' ? objetoId : null,
            conciliadoPor: atorId,
            conciliadoEm: agora,
            desconciliadoPor: null,
            desconciliadoEm: null,
          })
          .where(and(eq(conciliacao.id, existente.id), isNotNull(conciliacao.desconciliadoEm)))
          .returning()
          .all();
        if (reativadas.length !== 1) {
          throw new ErroAplicacao(409, MENSAGEM_ITEM_JA_CONCILIADO, 'item_ja_conciliado');
        }
        linha = reativadas[0]!;
      } else {
        linha = tx
          .insert(conciliacao)
          .values({
            empresaId: entrada.empresaId,
            itemExtratoId: entrada.itemExtratoId,
            objetoTipo: entrada.objetoTipo,
            tituloId: entrada.objetoTipo === 'titulo' ? objetoId : null,
            lancamentoId: entrada.objetoTipo === 'lancamento' ? objetoId : null,
            conciliadoPor: atorId,
          })
          .returning()
          .get()!;
      }

      auditoria.registrar({
        acao: 'conciliacao.criacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        objetoId: String(linha.id),
        dados: {
          conciliacao_id: linha.id,
          item_extrato_id: entrada.itemExtratoId,
          objeto_tipo: entrada.objetoTipo,
          objeto_id: objetoId,
        },
      });
      return linha;
    });
  } catch (erro) {
    // Corrida: dois itens disputando o MESMO objeto (ou o mesmo item) — o
    // índice único parcial retrocede; a recusa é auditada FORA da transação.
    if (ehViolacaoDeConciliacaoUnica(erro)) {
      const motivo =
        typeof (erro as { message?: unknown }).message === 'string' &&
        (erro as { message: string }).message.includes('conciliacao_item_uk')
          ? 'item_ja_conciliado'
          : 'objeto_ja_conciliado';
      registrarEvento(db, {
        acao: 'conciliacao.criacao_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        dados: {
          motivo,
          item_extrato_id: entrada.itemExtratoId,
          objeto_tipo: entrada.objetoTipo,
          objeto_id: objetoId,
        },
      });
      throw new ErroAplicacao(
        409,
        motivo === 'item_ja_conciliado'
          ? MENSAGEM_ITEM_JA_CONCILIADO
          : `Este ${entrada.objetoTipo === 'titulo' ? 'título' : 'lançamento'} já está conciliado ` +
              'a outro item de extrato: desconcilie o item atual antes de conciliar outro (CA-28).',
        motivo,
      );
    }
    // Corrida (D-R1): a linha do item ficou VIGENTE entre o pré-check e a
    // transação; a escrita abortou no predicado e a trilha da recusa é
    // gravada AQUI, fora da transação desfeita (R8: sem escrita, sem evento
    // interno) — mesmo motivo e mesma mensagem do caminho sequencial.
    if (erro instanceof ErroAplicacao && erro.codigo === 'item_ja_conciliado') {
      registrarEvento(db, {
        acao: 'conciliacao.criacao_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        dados: {
          motivo: 'item_ja_conciliado',
          item_extrato_id: entrada.itemExtratoId,
          objeto_tipo: entrada.objetoTipo,
          objeto_id: objetoId,
        },
      });
    }
    throw erro;
  }
}

/**
 * Mensagem única da recusa "conciliação já desfeita": o pré-check sequencial
 * e a CORRIDA (D-R1) respondem exatamente a mesma coisa.
 */
const MENSAGEM_CONCILIACAO_JA_DESFEITA =
  'Esta conciliação já foi desfeita anteriormente: nada há a desconciliar novamente ' +
  '(o histórico permanece na trilha — CA-28).';

/**
 * Desfaz uma conciliação (CA-28): UPDATE de `desconciliado_*` — a linha e a
 * trilha ficam como história; o item volta a pendente e o objeto é liberado.
 * Já desfeita é 409 auditado (`conciliacao_ja_desfeita`); a CORRIDA entre
 * leitura e UPDATE (D-R1) cai no mesmo 409, auditado fora da transação.
 */
export async function desconciliarConciliacao(
  db: AppDb,
  entrada: { conciliacaoId: number; empresaId: number },
  atorId: number,
): Promise<Conciliacao> {
  const linha = await buscarConciliacaoNaEmpresa(db, entrada.conciliacaoId, entrada.empresaId);
  if (!linha) {
    const alheia = await db
      .select({ empresaId: conciliacao.empresaId })
      .from(conciliacao)
      .where(eq(conciliacao.id, entrada.conciliacaoId));
    if (alheia[0]) {
      registrarEvento(db, {
        acao: 'conciliacao.tentativa_negada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        objetoId: String(entrada.conciliacaoId),
        dados: { motivo: 'empresa_diferente', empresa_da_conciliacao: alheia[0].empresaId },
      });
    }
    throw new ErroAplicacao(
      404,
      'Conciliação não encontrada nesta empresa.',
      'conciliacao_nao_encontrada',
    );
  }

  if (linha.desconciliadoEm !== null) {
    registrarEvento(db, {
      acao: 'conciliacao.desconciliacao_recusada',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'conciliacao',
      objetoId: String(linha.id),
      dados: {
        motivo: 'conciliacao_ja_desfeita',
        conciliacao_id: linha.id,
        item_extrato_id: linha.itemExtratoId,
      },
    });
    throw new ErroAplicacao(409, MENSAGEM_CONCILIACAO_JA_DESFEITA, 'conciliacao_ja_desfeita');
  }

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      // Predicado otimista (D-R1): só desconcilia quem AINDA está vigente;
      // `length !== 1` = corrida (a linha foi desfeita entre esta leitura e
      // este UPDATE) → a transação aborta SEM gravar a desconciliação e a
      // recusa é auditada FORA dela (no catch).
      const atualizadas = tx
        .update(conciliacao)
        .set({ desconciliadoPor: atorId, desconciliadoEm: new Date().toISOString() })
        .where(and(eq(conciliacao.id, linha.id), isNull(conciliacao.desconciliadoEm)))
        .returning()
        .all();
      if (atualizadas.length !== 1) {
        throw new ErroAplicacao(409, MENSAGEM_CONCILIACAO_JA_DESFEITA, 'conciliacao_ja_desfeita');
      }
      auditoria.registrar({
        acao: 'conciliacao.desconciliacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        objetoId: String(linha.id),
        dados: { conciliacao_id: linha.id, item_extrato_id: linha.itemExtratoId },
      });
      return atualizadas[0]!;
    });
  } catch (erro) {
    // Corrida (D-R1): outra requisição desfez a MESMA conciliação entre esta
    // leitura e este UPDATE — o evento da recusa é gravado AQUI, fora da
    // transação abortada (R8), com o MESMO motivo do caminho sequencial.
    if (erro instanceof ErroAplicacao && erro.codigo === 'conciliacao_ja_desfeita') {
      registrarEvento(db, {
        acao: 'conciliacao.desconciliacao_recusada',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conciliacao',
        objetoId: String(linha.id),
        dados: {
          motivo: 'conciliacao_ja_desfeita',
          conciliacao_id: linha.id,
          item_extrato_id: linha.itemExtratoId,
        },
      });
    }
    throw erro;
  }
}

/** Histórico de conciliações da empresa (vigentes e desfeitas — trilha do CA-28). */
export async function listarConciliacoes(
  db: AppDb,
  empresaId: number,
): Promise<Conciliacao[]> {
  return db
    .select()
    .from(conciliacao)
    .where(eq(conciliacao.empresaId, empresaId))
    .orderBy(asc(conciliacao.id));
}
