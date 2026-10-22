import type { FastifyInstance } from 'fastify';
import { criarLancamento } from '../../src/services/lancamentos.ts';
import type { AppDb } from '../../src/db/index.ts';
import type { Conta, Empresa, PeriodoContabil } from '../../src/db/schema.ts';
import { criarContaTeste, criarPeriodoTeste } from './contas.ts';
import { criarEmpresaTeste } from './empresas.ts';
import { criarUsuarioTeste, fazerLogin, type UsuarioTeste } from './seguranca.ts';

/**
 * FIX-01 — conjunto canônico de lançamentos de referência (SISTEMA-CONTABIL.md
 * §6.0; TASK-015). **Uma única factory** reutilizada por todos os testes de
 * aceite CA-03, CA-04, CA-05, CA-31 e CA-32 (critério de aceite explícito).
 *
 * | #  | Débito            | Crédito           |
 * |----|-------------------|-------------------|
 * | L1 | Caixa — 1.000,00  | Capital — 1.000,00 |
 * | L2 | Despesas — 600,00 | Fornecedor — 600,00 |
 * | L3 | Fornecedor — 400,00 | Caixa — 400,00   |
 * | L4 | Cliente — 700,00  | Receita — 700,00   |
 * | L5 | Caixa — 300,00    | Cliente — 300,00   |
 *
 * Totais: débitos = créditos = 3.000,00. Saldos esperados: Caixa 900,00 (D);
 * Cliente 400,00 (D); Despesas 600,00 (D); Fornecedor 200,00 (C); Capital
 * 1.000,00 (C); Receita 700,00 (C). Os números NÃO moram aqui: cada teste
 * afirma os valores canônicos do requisito nos próprios asserts.
 *
 * A fixture grava via **serviço real** (`criarLancamento`): período aberto
 * resolvido no servidor, equilíbrio e trilha seguem o caminho de produção.
 */

export interface Fix01 {
  empresa: Empresa;
  contador: UsuarioTeste;
  /** Cookie de sessão do contador atribuído (escritas e leituras via HTTP). */
  cookie: string;
  caixa: Conta;
  cliente: Conta;
  despesas: Conta;
  fornecedor: Conta;
  capital: Conta;
  receita: Conta;
  /** Conta de PL que recebe a transferência do resultado no encerramento (CA-31/CA-32). */
  contaResultado: Conta;
  periodo: PeriodoContabil;
  /** Ids dos lançamentos L1..L5, em ordem cronológica. */
  lancamentos: { l1: number; l2: number; l3: number; l4: number; l5: number };
}

export interface OpcoesFix01 {
  /** Ano do período (padrão 2026). */
  ano?: number;
  /** Mês do período (padrão 3; use 12 para o cenário de exercício — CA-32). */
  mes?: number;
}

/** Cria empresa + contas + período aberto + os 5 lançamentos de FIX-01. */
export async function criarFix01(
  app: FastifyInstance,
  db: AppDb,
  opcoes: OpcoesFix01 = {},
): Promise<Fix01> {
  const ano = opcoes.ano ?? 2026;
  const mes = opcoes.mes ?? 3;

  const empresa = criarEmpresaTeste(db, { razaoSocial: 'Empresa FIX-01' });
  const contador = await criarUsuarioTeste(db, {
    email: 'contador-fix01@escritorio.test',
    papel: 'contador',
    empresas: [empresa.id],
  });
  const { cookie } = await fazerLogin(app, contador.email);

  const conta = (codigo: string, descricao: string, tipo: Conta['tipo']): Conta =>
    criarContaTeste(db, { empresaId: empresa.id, codigo, descricao, tipo });

  const caixa = conta('1.1.1', 'Caixa', 'ativo');
  const cliente = conta('1.1.2', 'Clientes', 'ativo');
  const despesas = conta('3.1.1', 'Despesas operacionais', 'despesa');
  const fornecedor = conta('2.1.1', 'Fornecedores', 'passivo');
  const capital = conta('4.1.1', 'Capital social', 'patrimonio_liquido');
  const receita = conta('5.1.1', 'Receita operacional', 'receita');
  const contaResultado = conta('4.1.2', 'Resultado acumulado do exercício', 'patrimonio_liquido');

  const periodo = criarPeriodoTeste(db, { empresaId: empresa.id, ano, mes });

  const dia = (numero: number): string =>
    `${ano}-${String(mes).padStart(2, '0')}-${String(numero).padStart(2, '0')}`;

  const gravar = async (data: string, historico: string, partidas: { conta: Conta; natureza: 'D' | 'C'; centavos: number }[]): Promise<number> =>
    (
      await criarLancamento(
        db,
        {
          empresaId: empresa.id,
          data,
          historico,
          partidas: partidas.map((item) => ({
            contaId: item.conta.id,
            natureza: item.natureza,
            valorCentavos: item.centavos,
          })),
        },
        contador.id,
      )
    ).lancamento.id;

  const l1 = await gravar(dia(5), 'L1', [
    { conta: caixa, natureza: 'D', centavos: 100_000 },
    { conta: capital, natureza: 'C', centavos: 100_000 },
  ]);
  const l2 = await gravar(dia(10), 'L2', [
    { conta: despesas, natureza: 'D', centavos: 60_000 },
    { conta: fornecedor, natureza: 'C', centavos: 60_000 },
  ]);
  const l3 = await gravar(dia(15), 'L3', [
    { conta: fornecedor, natureza: 'D', centavos: 40_000 },
    { conta: caixa, natureza: 'C', centavos: 40_000 },
  ]);
  const l4 = await gravar(dia(20), 'L4', [
    { conta: cliente, natureza: 'D', centavos: 70_000 },
    { conta: receita, natureza: 'C', centavos: 70_000 },
  ]);
  const l5 = await gravar(dia(25), 'L5', [
    { conta: caixa, natureza: 'D', centavos: 30_000 },
    { conta: cliente, natureza: 'C', centavos: 30_000 },
  ]);

  return {
    empresa,
    contador,
    cookie,
    caixa,
    cliente,
    despesas,
    fornecedor,
    capital,
    receita,
    contaResultado,
    periodo,
    lancamentos: { l1, l2, l3, l4, l5 },
  };
}
