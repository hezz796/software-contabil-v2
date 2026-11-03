import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { baixaSchema } from '@sistema-contabil/shared';
import type { AppDb } from '../../src/db/index.ts';
import { baixa as baixaTable, titulo as tituloTable } from '../../src/db/schema.ts';
import type {
  Baixa,
  Conta,
  ContaBancaria,
  Empresa,
  PeriodoContabil,
  Titulo,
} from '../../src/db/schema.ts';
import { criarContaBancaria } from '../../src/services/extrato.ts';
import { criarContaTeste, criarPeriodoTeste } from './contas.ts';
import { criarEmpresaTeste } from './empresas.ts';
import { criarUsuarioTeste, fazerLogin, type UsuarioTeste } from './seguranca.ts';

/**
 * FIX-FLUXO — cenário canônico do CA-09 (`docs/requirements/SISTEMA-CONTABIL.md`):
 * saldo inicial de R$ 10.000,00 na data D−2, um título a receber de
 * R$ 1.500,00 **já recebido (baixa realizada)** em D−2, um título a receber de
 * R$ 2.000,00 em aberto com vencimento D+5 e um título a pagar de R$ 3.000,00
 * em aberto com vencimento D+10 — de modo que
 * `saldo final = 10.000,00 + 1.500,00 + 2.000,00 − 3.000,00 = R$ 10.500,00`.
 *
 * D = 2026-03-10 fixo: D−2 = 2026-03-08, D+5 = 2026-03-15, D+10 = 2026-03-20.
 * Tudo é gravado pelo caminho de produção: conta bancária pelo serviço da
 * RF-16, títulos e baixa pelas rotas da TASK-016 (período 03/2026 aberto).
 *
 * Os valores canônicos NÃO moram aqui como asserts: cada teste afirma os
 * números do requisito com literais próprios (mesmo critério de FIX-01).
 */

/** D−2: saldo inicial declarado e recebimento de R$ 1.500,00. */
export const D_MENOS_2 = '2026-03-08';
/** Dia central do cenário CA-09. */
export const D = '2026-03-10';
/** D+5: vencimento do título a receber em aberto. */
export const D_MAIS_5 = '2026-03-15';
/** D+10: vencimento do título a pagar em aberto. */
export const D_MAIS_10 = '2026-03-20';

export interface FixFluxo {
  empresa: Empresa;
  contador: UsuarioTeste;
  /** Cookie de sessão do contador atribuído (escritas e leituras via HTTP). */
  cookie: string;
  caixa: Conta;
  cliente: Conta;
  fornecedor: Conta;
  /** Conta "impostos/retenções a recolher" (prova do valor líquido — F-3). */
  contaRetencao: Conta;
  periodo: PeriodoContabil;
  contaBancaria: ContaBancaria;
  titulos: {
    /** Título de R$ 1.500,00 recebido em D−2 (entrada realizada). */
    recebido: Titulo;
    /** Título a receber em aberto, vencimento D+5 (entrada prevista). */
    receber: Titulo;
    /** Título a pagar em aberto, vencimento D+10 (saída prevista). */
    pagar: Titulo;
  };
  /** Baixa do título recebido em D−2 (RF-15; vigente, sem estorno). */
  baixaRecebimento: Baixa;
}

/** Cria o cenário do CA-09 (empresa, contas, período, caixa e títulos). */
export async function criarFixFluxo(app: FastifyInstance, db: AppDb): Promise<FixFluxo> {
  const empresa = criarEmpresaTeste(db, { razaoSocial: 'Empresa São João Contabilidade Ltda' });
  const contador = await criarUsuarioTeste(db, {
    email: 'contador-fluxo@escritorio.test',
    papel: 'contador',
    empresas: [empresa.id],
  });
  const { cookie } = await fazerLogin(app, contador.email);

  const conta = (codigo: string, descricao: string, tipo: Conta['tipo']): Conta =>
    criarContaTeste(db, { empresaId: empresa.id, codigo, descricao, tipo });

  const caixa = conta('1.1.1', 'Caixa', 'ativo');
  const cliente = conta('1.1.2', 'Clientes', 'ativo');
  const fornecedor = conta('2.1.1', 'Fornecedores', 'passivo');
  const contaRetencao = conta('2.1.2', 'Impostos a recolher', 'passivo');

  const periodo = criarPeriodoTeste(db, { empresaId: empresa.id, ano: 2026, mes: 3 });

  // R$ 10.000,00 declarado em D−2 (F-1: só contas com data_saldo_inicial <= de).
  const contaBancaria = await criarContaBancaria(
    db,
    {
      empresaId: empresa.id,
      nome: 'Banco do Brasil - CA-09',
      saldoInicialCentavos: 1_000_000,
      dataSaldoInicial: D_MENOS_2,
    },
    contador.id,
  );

  const criarTitulo = async (entrada: {
    tipo: 'receber' | 'pagar';
    contraparte: string;
    vencimento: string;
    valorCentavos: number;
    contaId: number;
  }): Promise<Titulo> => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/titulos',
      headers: { cookie },
      payload: {
        empresa_id: empresa.id,
        tipo: entrada.tipo,
        contraparte: entrada.contraparte,
        vencimento: entrada.vencimento,
        valor_centavos: entrada.valorCentavos,
        conta_id: entrada.contaId,
      },
    });
    if (resposta.statusCode !== 201) {
      throw new Error(`criação de título falhou (${resposta.statusCode}): ${resposta.body}`);
    }
    const { id } = resposta.json() as { id: number };
    return db.select().from(tituloTable).where(eq(tituloTable.id, id)).all()[0]!;
  };

  const recebido = await criarTitulo({
    tipo: 'receber',
    contraparte: 'Cliente CA-09',
    vencimento: D_MENOS_2,
    valorCentavos: 150_000,
    contaId: cliente.id,
  });
  const receber = await criarTitulo({
    tipo: 'receber',
    contraparte: 'Cliente previsto CA-09',
    vencimento: D_MAIS_5,
    valorCentavos: 200_000,
    contaId: cliente.id,
  });
  const pagar = await criarTitulo({
    tipo: 'pagar',
    contraparte: 'Fornecedor CA-09',
    vencimento: D_MAIS_10,
    valorCentavos: 300_000,
    contaId: fornecedor.id,
  });

  const respostaBaixa = await app.inject({
    method: 'POST',
    url: `/titulos/${recebido.id}/baixas`,
    headers: { cookie },
    payload: {
      empresa_id: empresa.id,
      data: D_MENOS_2,
      valor_centavos: 150_000,
      conta_contrapartida_id: caixa.id,
    },
  });
  if (respostaBaixa.statusCode !== 201) {
    throw new Error(`baixa de título falhou (${respostaBaixa.statusCode}): ${respostaBaixa.body}`);
  }
  const { id: baixaId } = baixaSchema.parse(respostaBaixa.json());
  const baixaRecebimento = db
    .select()
    .from(baixaTable)
    .where(eq(baixaTable.id, baixaId))
    .all()[0]!;

  return {
    empresa,
    contador,
    cookie,
    caixa,
    cliente,
    fornecedor,
    contaRetencao,
    periodo,
    contaBancaria,
    titulos: { recebido, receber, pagar },
    baixaRecebimento,
  };
}
