import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import {
  conciliacao,
  contaBancaria,
  importacaoExtrato,
  itemExtrato,
  type ContaBancaria,
  type ImportacaoExtrato,
  type ItemExtrato,
} from '../db/schema.ts';
import { parsearExtrato, type FormatoExtrato } from '../domain/extrato.ts';
import { ErroAplicacao } from '../errors.ts';
import { registrarEvento, transacaoComAuditoria } from './auditoria.ts';

/**
 * Conta bancária, item de extrato e importação de arquivo (RF-16, CA-53;
 * TASK-018).
 *
 * Regras sustentadas aqui:
 * - escrita é do CONTADOR atribuído (guard de escrita contábil na rota; F13);
 * - `valor_centavos` ASSINADO: + entrada, − saída (sinal é a entrada/saída
 *   do RF-16);
 * - item importado concilia **como o manual** (CA-53): o estado conciliado
 *   deriva de `conciliacao` vigente, nunca de coluna do item;
 * - importação: parse/validação ANTES da transação; registro + itens + trilha
 *   na MESMA transação (R8) — recusa de arquivo nunca deixa item órfão;
 * - duplicata idêntica (`arquivo_hash` sha256 dos bytes, UNIQUE por conta)
 *   é 409 auditado FORA da transação (T018-F-2);
 * - recusa com id alheio devolve o MESMO 404 do inexistente (sem oráculo);
 *   a trilha `*_tentativa_negada` só registra a tentativa alheia real.
 */

/* -------------------------------------------------------------------------- */
/* Lookups e "ou 404"                                                          */
/* -------------------------------------------------------------------------- */

/** Conta bancária por id DENTRO da empresa (R7: nunca devolve alheia). */
export async function buscarContaBancariaNaEmpresa(
  db: AppDb,
  contaBancariaId: number,
  empresaId: number,
): Promise<ContaBancaria | undefined> {
  const linhas = await db
    .select()
    .from(contaBancaria)
    .where(and(eq(contaBancaria.id, contaBancariaId), eq(contaBancaria.empresaId, empresaId)));
  return linhas[0];
}

/**
 * Conta bancária da empresa para ESCRITA: inexistente e alheio respondem o
 * MESMO 404 (sem oráculo); a tentativa alheia real fica na trilha.
 */
export async function contaBancariaOu404(
  db: AppDb,
  contaBancariaId: number,
  empresaId: number,
  atorId: number,
): Promise<ContaBancaria> {
  const linha = await buscarContaBancariaNaEmpresa(db, contaBancariaId, empresaId);
  if (linha) return linha;
  const alheia = await db
    .select({ empresaId: contaBancaria.empresaId })
    .from(contaBancaria)
    .where(eq(contaBancaria.id, contaBancariaId));
  if (alheia[0]) {
    registrarEvento(db, {
      acao: 'conta_bancaria.tentativa_negada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'conta_bancaria',
      objetoId: String(contaBancariaId),
      dados: { motivo: 'empresa_diferente', empresa_da_conta_bancaria: alheia[0].empresaId },
    });
  }
  throw new ErroAplicacao(
    404,
    'Conta bancária não encontrada nesta empresa.',
    'conta_bancaria_nao_encontrada',
  );
}

/**
 * Item de extrato da empresa para ESCRITA: mesmo padrão de
 * `contaBancariaOu404` (404 idêntico; trilha só no alheio real).
 */
export async function itemExtratoOu404(
  db: AppDb,
  itemExtratoId: number,
  empresaId: number,
  atorId: number,
): Promise<ItemExtrato> {
  const linhas = await db
    .select()
    .from(itemExtrato)
    .where(and(eq(itemExtrato.id, itemExtratoId), eq(itemExtrato.empresaId, empresaId)));
  if (linhas[0]) return linhas[0];
  const alheio = await db
    .select({ empresaId: itemExtrato.empresaId })
    .from(itemExtrato)
    .where(eq(itemExtrato.id, itemExtratoId));
  if (alheio[0]) {
    registrarEvento(db, {
      acao: 'item_extrato.tentativa_negada',
      usuarioId: atorId,
      empresaId,
      objetoTipo: 'item_extrato',
      objetoId: String(itemExtratoId),
      dados: { motivo: 'empresa_diferente', empresa_do_item: alheio[0].empresaId },
    });
  }
  throw new ErroAplicacao(
    404,
    'Item de extrato não encontrado nesta empresa.',
    'item_extrato_nao_encontrado',
  );
}

/* -------------------------------------------------------------------------- */
/* Conta bancária                                                              */
/* -------------------------------------------------------------------------- */

export interface EntradaContaBancaria {
  empresaId: number;
  nome: string;
  saldoInicialCentavos: number;
  dataSaldoInicial: string;
}

/** Violation matcher (padrão S-T014-3): só a constraint esperada vira 409. */
function ehViolacaoDeNomeDuplicado(erro: unknown): boolean {
  const candidato = erro as { code?: unknown; message?: unknown } | null;
  if (typeof candidato?.code !== 'string' || candidato.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
    return false;
  }
  return (
    typeof candidato.message === 'string' &&
    (candidato.message.includes('conta_bancaria_empresa_nome_uk') ||
      candidato.message.includes('conta_bancaria.nome'))
  );
}

/** Cadastro MÍNIMO de conta bancária (RF-16/Q-UI-2): pré-condição do extrato. */
export async function criarContaBancaria(
  db: AppDb,
  entrada: EntradaContaBancaria,
  atorId: number,
): Promise<ContaBancaria> {
  const duplicada = await db
    .select({ id: contaBancaria.id })
    .from(contaBancaria)
    .where(
      and(eq(contaBancaria.empresaId, entrada.empresaId), eq(contaBancaria.nome, entrada.nome)),
    );
  if (duplicada[0]) {
    throw new ErroAplicacao(
      409,
      'Já existe uma conta bancária com este nome nesta empresa.',
      'nome_conta_duplicado',
    );
  }

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const [criada] = tx
        .insert(contaBancaria)
        .values({
          empresaId: entrada.empresaId,
          nome: entrada.nome,
          saldoInicialCentavos: entrada.saldoInicialCentavos,
          dataSaldoInicial: entrada.dataSaldoInicial,
          criadoPor: atorId,
        })
        .returning()
        .all();
      auditoria.registrar({
        acao: 'conta_bancaria.criacao',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'conta_bancaria',
        objetoId: String(criada!.id),
        dados: {
          conta_bancaria_id: criada!.id,
          nome: entrada.nome,
          saldo_inicial_centavos: entrada.saldoInicialCentavos,
          data_saldo_inicial: entrada.dataSaldoInicial,
        },
      });
      return criada!;
    });
  } catch (erro) {
    // Corrida entre o pré-check e o INSERT: a constraint única responde.
    if (ehViolacaoDeNomeDuplicado(erro)) {
      throw new ErroAplicacao(
        409,
        'Já existe uma conta bancária com este nome nesta empresa.',
        'nome_conta_duplicado',
      );
    }
    throw erro;
  }
}

/** Contas bancárias da empresa em ordem de criação. */
export async function listarContasBancarias(
  db: AppDb,
  empresaId: number,
): Promise<ContaBancaria[]> {
  return db
    .select()
    .from(contaBancaria)
    .where(eq(contaBancaria.empresaId, empresaId))
    .orderBy(asc(contaBancaria.id));
}

/* -------------------------------------------------------------------------- */
/* Item de extrato                                                             */
/* -------------------------------------------------------------------------- */

export interface EntradaItemExtrato {
  contaBancariaId: number;
  empresaId: number;
  data: string;
  descricao: string;
  valorCentavos: number;
}

/** Lançamento manual de item de extrato (RF-16) — conciliável como os importados. */
export async function criarItemExtrato(
  db: AppDb,
  entrada: EntradaItemExtrato,
  atorId: number,
): Promise<ItemExtrato> {
  await contaBancariaOu404(db, entrada.contaBancariaId, entrada.empresaId, atorId);
  return transacaoComAuditoria(db, (tx, auditoria) => {
    const [criado] = tx
      .insert(itemExtrato)
      .values({
        contaBancariaId: entrada.contaBancariaId,
        empresaId: entrada.empresaId,
        data: entrada.data,
        descricao: entrada.descricao,
        valorCentavos: entrada.valorCentavos,
        origem: 'manual',
        importacaoId: null,
        identificador: null,
        criadoPor: atorId,
      })
      .returning()
      .all();
    auditoria.registrar({
      acao: 'item_extrato.criacao',
      usuarioId: atorId,
      empresaId: entrada.empresaId,
      objetoTipo: 'item_extrato',
      objetoId: String(criado!.id),
      dados: {
        item_extrato_id: criado!.id,
        conta_bancaria_id: entrada.contaBancariaId,
        data: entrada.data,
        valor_centavos: entrada.valorCentavos,
        origem: 'manual',
      },
    });
    return criado!;
  });
}

/**
 * Itens da conta com o estado `conciliado` DERIVADO da conciliação vigente
 * (CA-08/CA-28: desconciliação devolve o item a pendente — nunca coluna).
 */
export async function listarItensExtrato(
  db: AppDb,
  contaBancariaId: number,
  empresaId: number,
): Promise<Array<ItemExtrato & { conciliado: boolean }>> {
  const itens = await db
    .select()
    .from(itemExtrato)
    .where(
      and(
        eq(itemExtrato.contaBancariaId, contaBancariaId),
        eq(itemExtrato.empresaId, empresaId),
      ),
    )
    .orderBy(asc(itemExtrato.data), asc(itemExtrato.id));
  if (itens.length === 0) return [];
  const vigentes = await db
    .select({ itemExtratoId: conciliacao.itemExtratoId })
    .from(conciliacao)
    .where(
      and(
        eq(conciliacao.empresaId, empresaId),
        isNull(conciliacao.desconciliadoEm),
        inArray(
          conciliacao.itemExtratoId,
          itens.map((item) => item.id),
        ),
      ),
    );
  const conciliados = new Set(vigentes.map((linha) => linha.itemExtratoId));
  return itens.map((item) => ({ ...item, conciliado: conciliados.has(item.id) }));
}

/* -------------------------------------------------------------------------- */
/* Importação de arquivo                                                       */
/* -------------------------------------------------------------------------- */

function ehViolacaoDeHashDuplicado(erro: unknown): boolean {
  const candidato = erro as { code?: unknown; message?: unknown } | null;
  if (typeof candidato?.code !== 'string' || candidato.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
    return false;
  }
  return (
    typeof candidato.message === 'string' &&
    (candidato.message.includes('importacao_conta_hash_uk') ||
      candidato.message.includes('importacao_extrato.arquivo_hash'))
  );
}

export interface EntradaImportacao {
  contaBancariaId: number;
  empresaId: number;
  nomeArquivo: string | null;
  /** Bytes BRUTOS do arquivo (o charset é resolvido pelo parser). */
  bytes: Uint8Array;
}

export interface ResultadoImportacao {
  importacao: ImportacaoExtrato;
  itens: ItemExtrato[];
  formato: FormatoExtrato;
}

/**
 * Linhas por INSERT dos itens da importação. O SQLite limita os placeholders
 * de uma única instrução a `SQLITE_MAX_VARIABLE_NUMBER = 32766`; a tabela
 * `item_extrato` usa 10 colunas (10 placeholders por linha), então um INSERT
 * único só cabe até 3.276 linhas — arquivo VÁLIDO de 3.277..10.000 transações
 * (abaixo do teto `arquivo_grande_demais`) respondia 500 "too many SQL
 * variables" sem evento `importacao.recusada` (FIX-T018-R3). Lote de 1.000:
 * 1.000 × 10 = 10.000 placeholders≪ 32.766 — folga de ~3,3× até o limite,
 * inclusive se a tabela ganhar colunas. TODOS os lotes rodam na MESMA
 * transação: a atomicidade do CA-53 permanece (ou todos os itens, ou nenhum).
 */
const TAMANHO_LOTE_ITENS_IMPORTACAO = 1_000;

/**
 * Importa extrato OFX/CSV na conta (CA-53): parse estrito ANTES da
 * transação; registro + itens + trilha na MESMA transação; duplicata
 * idêntica (sha256 por conta) é 409 auditado fora.
 */
export async function importarExtrato(
  db: AppDb,
  entrada: EntradaImportacao,
  atorId: number,
): Promise<ResultadoImportacao> {
  await contaBancariaOu404(db, entrada.contaBancariaId, entrada.empresaId, atorId);

  const arquivoHash = createHash('sha256').update(entrada.bytes).digest('hex');
  const contextoRecusa = {
    usuarioId: atorId,
    empresaId: entrada.empresaId,
    objetoTipo: 'importacao',
    dados: {
      conta_bancaria_id: entrada.contaBancariaId,
      arquivo_hash: arquivoHash,
      nome_arquivo: entrada.nomeArquivo,
    },
  };

  const duplicada = await db
    .select({ id: importacaoExtrato.id })
    .from(importacaoExtrato)
    .where(
      and(
        eq(importacaoExtrato.contaBancariaId, entrada.contaBancariaId),
        eq(importacaoExtrato.arquivoHash, arquivoHash),
      ),
    );
  if (duplicada[0]) {
    registrarEvento(db, {
      ...contextoRecusa,
      acao: 'importacao.recusada',
      dados: { ...contextoRecusa.dados, motivo: 'arquivo_ja_importado' },
    });
    throw new ErroAplicacao(
      409,
      'Este arquivo já foi importado nesta conta bancária: a reimportação idêntica é recusada ' +
        'para não duplicar itens (o mesmo arquivo em outra conta continua permitido).',
      'arquivo_ja_importado',
    );
  }

  let parse;
  try {
    parse = parsearExtrato(entrada.bytes);
  } catch (erro) {
    if (erro instanceof ErroAplicacao) {
      registrarEvento(db, {
        ...contextoRecusa,
        acao: 'importacao.recusada',
        dados: { ...contextoRecusa.dados, motivo: erro.codigo },
      });
    }
    throw erro;
  }

  try {
    return transacaoComAuditoria(db, (tx, auditoria) => {
      const [importacao] = tx
        .insert(importacaoExtrato)
        .values({
          contaBancariaId: entrada.contaBancariaId,
          empresaId: entrada.empresaId,
          nomeArquivo: entrada.nomeArquivo,
          arquivoHash,
          quantidadeItens: parse.transacoes.length,
          criadoPor: atorId,
        })
        .returning()
        .all();
      const itensInseridos: ItemExtrato[] = [];
      for (let inicio = 0; inicio < parse.transacoes.length; inicio += TAMANHO_LOTE_ITENS_IMPORTACAO) {
        const lote = parse.transacoes.slice(inicio, inicio + TAMANHO_LOTE_ITENS_IMPORTACAO);
        const inseridos = tx
          .insert(itemExtrato)
          .values(
            lote.map((transacao) => ({
              contaBancariaId: entrada.contaBancariaId,
              empresaId: entrada.empresaId,
              data: transacao.data,
              descricao: transacao.descricao,
              valorCentavos: transacao.valorCentavos,
              origem: 'importacao' as const,
              importacaoId: importacao!.id,
              identificador: transacao.identificador,
              criadoPor: atorId,
            })),
          )
          .returning()
          .all();
        itensInseridos.push(...inseridos);
      }
      auditoria.registrar({
        acao: 'importacao.concluida',
        usuarioId: atorId,
        empresaId: entrada.empresaId,
        objetoTipo: 'importacao',
        objetoId: String(importacao!.id),
        dados: {
          importacao_id: importacao!.id,
          conta_bancaria_id: entrada.contaBancariaId,
          quantidade_itens: parse.transacoes.length,
          formato: parse.formato,
        },
      });
      return { importacao: importacao!, itens: itensInseridos, formato: parse.formato };
    });
  } catch (erro) {
    // Corrida entre o pré-check e o INSERT: a constraint única responde e a
    // transação já desfez registro + itens; a recusa fica na trilha AQUI.
    if (ehViolacaoDeHashDuplicado(erro)) {
      registrarEvento(db, {
        ...contextoRecusa,
        acao: 'importacao.recusada',
        dados: { ...contextoRecusa.dados, motivo: 'arquivo_ja_importado' },
      });
      throw new ErroAplicacao(
        409,
        'Este arquivo já foi importado nesta conta bancária: a reimportação idêntica é recusada ' +
          'para não duplicar itens (o mesmo arquivo em outra conta continua permitido).',
        'arquivo_ja_importado',
      );
    }
    throw erro;
  }
}
