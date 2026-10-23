import {
  contaBancariaSchema,
  erroResponseSchema,
  importacaoExtratoResponseSchema,
  itemExtratoSchema,
  listaContasBancariasResponseSchema,
  listaItensExtratoResponseSchema,
  type ContaBancariaDTO,
} from '@sistema-contabil/shared';
import { describe, expect, test } from 'vitest';
import { auditEvent, contaBancaria, importacaoExtrato, itemExtrato, type Empresa } from '../../src/db/schema.ts';
import { buildApp } from '../../src/app.ts';
import { criarEmpresaTeste } from '../fixtures/empresas.ts';
import {
  arquivoNaoReconhecidoBase64,
  csvMalformadoBase64,
  csvValidoBase64,
  ofx1Base64,
  ofx2Base64,
  ofxSemTransacoesBase64,
} from '../fixtures/extrato.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';
import { createTestDatabase, type TestApp } from '../harness.ts';

/**
 * Importação de extrato OFX/CSV com validação estrita (RF-16/F10, CA-53;
 * TASK-018). Um teste por critério/extra do brief: cadastro mínimo de conta
 * bancária + admin recusado auditado; OFX 1.x SGML; OFX 2.x XML e CSV;
 * recusas com NENHUM item (contagem no banco); duplicata por `arquivo_hash`;
 * contador alheio com oráculo idêntico.
 *
 * Pré-condições de dado REAL em testes negativos (regra 2 do AGENTS.md): as
 * recusas de arquivo acontecem com conta criada e com controle aceito entre
 * elas — "0 itens" é medido no banco, antes e depois.
 *
 * FIX-T018-R2 (ressalvas da revisão de segurança): tetos EXPLÍCITOS da
 * importação (corpo, transações, `descricao`/`identificador`) e recusa que
 * NÃO reflete o campo cru do arquivo na mensagem.
 */

interface Cenario {
  t: TestApp;
  empresa: Empresa;
  contador: { id: number; email: string };
  cookie: string;
}

/** App + empresa + contador atribuído (as contas bancárias são criadas via API). */
async function prepararCenario(razaoSocial: string): Promise<Cenario> {
  const database = createTestDatabase();
  const app = await buildApp({ db: database.db, logger: false });
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
  const { cookie } = await fazerLogin(app, contador.email);
  return { t, empresa, contador, cookie };
}

/* ------------------------------- HTTP helpers ------------------------------ */

function postContaBancaria(c: Cenario, payload: Record<string, unknown>, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'POST',
    url: '/contas-bancarias',
    headers: { cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function getContas(c: Cenario, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/contas-bancarias?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function getConta(c: Cenario, contaId: number, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/contas-bancarias/${contaId}?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function getItens(c: Cenario, contaId: number, cookie = c.cookie) {
  return c.t.app.inject({
    method: 'GET',
    url: `/contas-bancarias/${contaId}/itens?empresa_id=${c.empresa.id}`,
    headers: { cookie },
  });
}

function postItem(c: Cenario, contaId: number, payload: Record<string, unknown>) {
  return c.t.app.inject({
    method: 'POST',
    url: `/contas-bancarias/${contaId}/itens`,
    headers: { cookie: c.cookie },
    payload: { empresa_id: c.empresa.id, ...payload },
  });
}

function postImportacao(
  c: Cenario,
  contaId: number,
  payload: Record<string, unknown>,
  cookie = c.cookie,
  empresaId = c.empresa.id,
) {
  return c.t.app.inject({
    method: 'POST',
    url: `/contas-bancarias/${contaId}/importacoes`,
    headers: { cookie },
    payload: { empresa_id: empresaId, ...payload },
  });
}

/* ------------------------------ DB helpers -------------------------------- */

function eventosDe(c: Cenario, acao: string) {
  return c.t.database.db.select().from(auditEvent).all().filter((evento) => evento.acao === acao);
}

function itensNoBanco(c: Cenario) {
  return c.t.database.db.select().from(itemExtrato).all();
}

function importacoesNoBanco(c: Cenario) {
  return c.t.database.db.select().from(importacaoExtrato).all();
}

function contasNoBanco(c: Cenario) {
  return c.t.database.db.select().from(contaBancaria).all();
}

/* ------------------------ geradores sintéticos ----------------------------- */

/**
 * CSV sintético com `quantidade` linhas de dados (gerado NO teste: um arquivo
 * de 10.001 linhas nunca é fixado no repo). Valor sempre `-1,NN` — centavos
 * assinados e não nulos, como o parser exige.
 */
function csvSintetico(quantidade: number, descricao = 'Lancamento sintetico'): string {
  const linhas = ['data;descricao;valor'];
  for (let indice = 0; indice < quantidade; indice += 1) {
    linhas.push(`05/05/2026;${descricao};-1,${String(indice % 100).padStart(2, '0')}`);
  }
  return `${linhas.join('\r\n')}\r\n`;
}

/**
 * OFX 1.x (SGML) mínimo com UM `<STMTTRN>`: `campos` sobrescreve as tags da
 * transação para montar casos pontuais (MEMO longo, FITID longo, etc.).
 */
function ofxSimples(campos: {
  dtPosted?: string;
  trnAmt?: string;
  fitid?: string;
  memo?: string;
}): string {
  return [
    'OFXHEADER:100',
    'DATA:20260510120000.000[-03:00]',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<BANKMSGSRSV1>',
    '<STMTTRNRS>',
    '<STMTRS>',
    '<BANKTRANLIST>',
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    `<DTPOSTED>${campos.dtPosted ?? '20260505000000.000[-03:00]'}`,
    `<TRNAMT>${campos.trnAmt ?? '-150.75'}`,
    `<FITID>${campos.fitid ?? '20260505000001'}`,
    `<MEMO>${campos.memo ?? 'Pagamento energia'}`,
    '</BANKTRANLIST>',
    '</STMTRS>',
    '</STMTTRNRS>',
    '</BANKMSGSRSV1>',
    '</OFX>',
    '',
  ].join('\r\n');
}

/* --------------------------- criadores via API ---------------------------- */

async function criarContaBancariaViaApi(
  c: Cenario,
  sobrescrita: Record<string, unknown> = {},
): Promise<ContaBancariaDTO> {
  const resposta = await postContaBancaria(c, {
    nome: 'Banco Principal',
    saldo_inicial_centavos: 1_000_000,
    data_saldo_inicial: '2026-05-01',
    ...sobrescrita,
  });
  expect(resposta.statusCode).toBe(201);
  return contaBancariaSchema.parse(resposta.json());
}

/* -------------------------------------------------------------------------- */

describe('importação de extrato OFX/CSV (RF-16/F10, CA-53; TASK-018)', () => {
  test('cadastro mínimo de conta bancária (nome, saldo inicial, data) é pre-condição do extrato; admin é recusado auditado e só lê', async () => {
    const c = await prepararCenario('CA-conta-bancaria');
    try {
      const criada = await criarContaBancariaViaApi(c);
      expect(criada.nome).toBe('Banco Principal');
      expect(criada.saldo_inicial_centavos).toBe(1_000_000);
      expect(criada.data_saldo_inicial).toBe('2026-05-01');
      expect(criada.empresa_id).toBe(c.empresa.id);
      expect(criada.criado_por).toBe(c.contador.id);

      // leitura: lista e detalhe devolvem a MESMA conta
      const lista = listaContasBancariasResponseSchema.parse((await getContas(c)).json());
      expect(lista.contas).toHaveLength(1);
      const detalhe = contaBancariaSchema.parse((await getConta(c, criada.id)).json());
      expect(detalhe).toEqual(criada);

      // nome duplicado na mesma empresa → 409 e nada duplicado
      const duplicada = await postContaBancaria(c, {
        nome: 'Banco Principal',
        data_saldo_inicial: '2026-05-02',
      });
      expect(duplicada.statusCode).toBe(409);
      expect(erroResponseSchema.parse(duplicada.json()).erro).toMatch(/já existe uma conta bancária/i);
      expect(contasNoBanco(c)).toHaveLength(1);

      // admin: ESCRITA recusada auditada (T018-F-1), LEITURA permitida
      const admin = await criarUsuarioTeste(c.t.database.db, {
        papel: 'administrador',
        email: 'admin-leitura@escritorio.test',
        empresas: [c.empresa.id],
      });
      const { cookie: cookieAdmin } = await fazerLogin(c.t.app, admin.email);
      const tentativa = await c.t.app.inject({
        method: 'POST',
        url: '/contas-bancarias',
        headers: { cookie: cookieAdmin },
        payload: {
          empresa_id: c.empresa.id,
          nome: 'Conta do Admin',
          data_saldo_inicial: '2026-05-01',
        },
      });
      expect(tentativa.statusCode).toBe(403);
      expect(erroResponseSchema.parse(tentativa.json()).erro).toMatch(/escrita contábil/i);
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(admin.id);
      expect(negada.empresaId).toBe(c.empresa.id);
      expect(negada.objetoTipo).toBe('conta_bancaria');
      expect(negada.dados).toMatchObject({ motivo: 'administrador_sem_escrita_contabil' });
      expect(contasNoBanco(c)).toHaveLength(1); // nada persistido pela tentativa

      const leituraAdmin = await getContas(c, cookieAdmin);
      expect(leituraAdmin.statusCode).toBe(200);
      expect(listaContasBancariasResponseSchema.parse(leituraAdmin.json()).contas).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('CA-53 importação de OFX de exemplo com 3 itens gera 3 itens conciliáveis como os manuais', async () => {
    const c = await prepararCenario('CA-53-ofx1');
    try {
      const conta = await criarContaBancariaViaApi(c);

      const resposta = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-maio.ofx',
        conteudo_base64: ofx1Base64(),
      });
      expect(resposta.statusCode).toBe(201);
      const corpo = importacaoExtratoResponseSchema.parse(resposta.json());

      // 3 itens do exemplo, com data/valor/descrição/identificador resolvidos
      expect(corpo.itens).toHaveLength(3);
      expect(corpo.importacao.quantidade_itens).toBe(3);
      expect(corpo.importacao.nome_arquivo).toBe('extrato-maio.ofx');
      expect(corpo.itens.map((item) => item.valor_centavos)).toEqual([-15_075, 250_000, -9_990]);
      expect(corpo.itens.map((item) => item.data)).toEqual([
        '2026-05-05',
        '2026-05-10',
        '2026-05-15',
      ]);
      expect(corpo.itens.map((item) => item.identificador)).toEqual([
        '20260505000001',
        '20260510000002',
        '20260515000003',
      ]);
      // charset windows-1252 do OFX 1.x decodificado (acentos corretos)
      expect(corpo.itens[2]?.descricao).toContain('São João');
      expect(corpo.itens.every((item) => item.origem === 'importacao')).toBe(true);
      expect(corpo.itens.every((item) => !item.conciliado)).toBe(true);

      // conciliáveis como os manuais: um item manual entra na mesma lista
      const manual = await postItem(c, conta.id, {
        data: '2026-05-20',
        descricao: 'Depósito manual',
        valor_centavos: 10_000,
      });
      expect(manual.statusCode).toBe(201);
      expect(itemExtratoSchema.parse(manual.json()).origem).toBe('manual');

      const lista = listaItensExtratoResponseSchema.parse((await getItens(c, conta.id)).json());
      expect(lista.itens).toHaveLength(4);
      expect(lista.itens.every((item) => !item.conciliado)).toBe(true);
      expect(itensNoBanco(c)).toHaveLength(4); // contagem no banco, não só na resposta

      // trilha: importação concluída com a contagem e o formato
      const concluidas = eventosDe(c, 'importacao.concluida');
      expect(concluidas).toHaveLength(1);
      expect(concluidas[0]?.dados).toMatchObject({
        quantidade_itens: 3,
        formato: 'ofx',
        conta_bancaria_id: conta.id,
      });
      expect(importacoesNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('OFX 2.x (XML) e CSV com BOM/acentos são reconhecidos: 3 itens cada, todos conciliáveis', async () => {
    const c = await prepararCenario('CA-53-ofx2-csv');
    try {
      const conta = await criarContaBancariaViaApi(c);

      const ofx2 = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-maio.ofx',
        conteudo_base64: ofx2Base64(),
      });
      expect(ofx2.statusCode).toBe(201);
      expect(importacaoExtratoResponseSchema.parse(ofx2.json()).itens).toHaveLength(3);

      const csv = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-maio.csv',
        conteudo_base64: csvValidoBase64(),
      });
      expect(csv.statusCode).toBe(201);
      const corpoCsv = importacaoExtratoResponseSchema.parse(csv.json());
      expect(corpoCsv.itens).toHaveLength(3);
      // datas dd/MM/AAAA convertidas; valor com milhar e vírgula; aspas RFC4180
      expect(corpoCsv.itens[0]?.data).toBe('2026-05-05');
      expect(corpoCsv.itens.map((item) => item.valor_centavos)).toEqual([
        -15_075, 250_000, -9_990,
      ]);
      expect(corpoCsv.itens[2]?.descricao).toBe('Nota fiscal 123; São João');

      const lista = listaItensExtratoResponseSchema.parse((await getItens(c, conta.id)).json());
      expect(lista.itens).toHaveLength(6);
      expect(lista.itens.every((item) => item.origem === 'importacao')).toBe(true);
      expect(lista.itens.every((item) => !item.conciliado)).toBe(true);
      expect(itensNoBanco(c)).toHaveLength(6);

      // trilha: uma importação concluída por arquivo, com o formato de cada
      const concluidas = eventosDe(c, 'importacao.concluida');
      expect(concluidas).toHaveLength(2);
      expect(concluidas[0]?.dados).toMatchObject({ formato: 'ofx', quantidade_itens: 3 });
      expect(concluidas[1]?.dados).toMatchObject({ formato: 'csv', quantidade_itens: 3 });

      // dois registros com hashes distintos (sha256 dos bytes de cada arquivo)
      const linhas = importacoesNoBanco(c);
      expect(linhas).toHaveLength(2);
      expect(new Set(linhas.map((linha) => linha.arquivoHash)).size).toBe(2);
    } finally {
      await c.t.close();
    }
  });

  test('CA-53 arquivo não reconhecido, OFX sem transações e CSV malformado: recusa com mensagem e NENHUM item criado', async () => {
    const c = await prepararCenario('CA-53-recusas');
    try {
      const conta = await criarContaBancariaViaApi(c);

      // (a) formato não reconhecido
      const lixo = await postImportacao(c, conta.id, {
        conteudo_base64: arquivoNaoReconhecidoBase64(),
      });
      expect(lixo.statusCode).toBe(400);
      expect(erroResponseSchema.parse(lixo.json()).erro).toMatch(/não reconhecido/i);

      // (b) OFX reconhecido porém sem nenhuma transação
      const vazio = await postImportacao(c, conta.id, {
        conteudo_base64: ofxSemTransacoesBase64(),
      });
      expect(vazio.statusCode).toBe(400);
      expect(erroResponseSchema.parse(vazio.json()).erro).toMatch(/não contém transações/i);

      // (c) CSV malformado: o arquivo INTEIRO é recusado apontando a linha
      const malformado = await postImportacao(c, conta.id, {
        conteudo_base64: csvMalformadoBase64(),
      });
      expect(malformado.statusCode).toBe(400);
      expect(erroResponseSchema.parse(malformado.json()).erro).toMatch(/linha 3/i);

      // NENHUM item criado em nenhuma das recusas (contagem no banco)
      expect(itensNoBanco(c)).toHaveLength(0);
      expect(importacoesNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'importacao.concluida')).toHaveLength(0);
      const recusas = eventosDe(c, 'importacao.recusada');
      expect(recusas.map((evento) => evento.dados)).toEqual([
        expect.objectContaining({ motivo: 'arquivo_nao_reconhecido' }),
        expect.objectContaining({ motivo: 'arquivo_sem_transacoes' }),
        expect.objectContaining({ motivo: 'arquivo_invalido' }),
      ]);

      // controle aceito entre as recusas: o arquivo válido seguinte entra
      const valido = await postImportacao(c, conta.id, { conteudo_base64: ofx1Base64() });
      expect(valido.statusCode).toBe(201);
      expect(itensNoBanco(c)).toHaveLength(3);

      // as recusas seguintes não corrompem o que já foi importado
      const malformadoDepois = await postImportacao(c, conta.id, {
        conteudo_base64: csvMalformadoBase64(),
      });
      expect(malformadoDepois.statusCode).toBe(400);
      expect(itensNoBanco(c)).toHaveLength(3);
      expect(importacoesNoBanco(c)).toHaveLength(1);
      expect(eventosDe(c, 'importacao.concluida')).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('reimportação do mesmo arquivo na mesma conta é recusada como duplicata idêntica (arquivo_hash) e nada duplica', async () => {
    const c = await prepararCenario('CA-53-duplicata');
    try {
      const conta = await criarContaBancariaViaApi(c);
      const primeira = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato.ofx',
        conteudo_base64: ofx1Base64(),
      });
      expect(primeira.statusCode).toBe(201);
      expect(itensNoBanco(c)).toHaveLength(3);

      // MESMOS bytes na MESMA conta → 409 de duplicata idêntica (T018-F-2)
      const repetida = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-copia.ofx',
        conteudo_base64: ofx1Base64(),
      });
      expect(repetida.statusCode).toBe(409);
      expect(erroResponseSchema.parse(repetida.json()).erro).toMatch(/já foi importado/i);
      expect(itensNoBanco(c)).toHaveLength(3); // não duplicou itens
      expect(importacoesNoBanco(c)).toHaveLength(1); // nem o registro

      const hash = importacoesNoBanco(c)[0]!.arquivoHash;
      const recusa = eventosDe(c, 'importacao.recusada').at(-1)!;
      expect(recusa.dados).toMatchObject({
        motivo: 'arquivo_ja_importado',
        arquivo_hash: hash,
      });

      // o MESMO arquivo em OUTRA conta da empresa é aceito (hash é por conta)
      const outraConta = await criarContaBancariaViaApi(c, { nome: 'Banco Poupança' });
      const noutra = await postImportacao(c, outraConta.id, { conteudo_base64: ofx1Base64() });
      expect(noutra.statusCode).toBe(201);
      expect(importacoesNoBanco(c)).toHaveLength(2);
      expect(itensNoBanco(c)).toHaveLength(6);
    } finally {
      await c.t.close();
    }
  });

  test('contador alheio: escrita de importação 403 auditada; leitura de conta 404 idêntico para inexistente x alheia (sem oráculo)', async () => {
    const c = await prepararCenario('CA-alheio-importacao');
    try {
      // dado real: empresa Y com conta bancária própria (produzida por Y)
      const empresaY = criarEmpresaTeste(c.t.database.db, { razaoSocial: 'Empresa Y' });
      const contadorY = await criarUsuarioTeste(c.t.database.db, {
        papel: 'contador',
        empresas: [empresaY.id],
        email: 'contador-y-importacao@escritorio.test',
      });
      const { cookie: cookieY } = await fazerLogin(c.t.app, contadorY.email);
      const respostaY = await c.t.app.inject({
        method: 'POST',
        url: '/contas-bancarias',
        headers: { cookie: cookieY },
        payload: { empresa_id: empresaY.id, nome: 'Banco Y', data_saldo_inicial: '2026-05-01' },
      });
      expect(respostaY.statusCode).toBe(201);
      const contaY = contaBancariaSchema.parse(respostaY.json());

      // (1) escrita apontando empresa alheia → 403 auditada (guard, antes do parser)
      const escritaAlheia = await postImportacao(
        c,
        contaY.id,
        { conteudo_base64: ofx1Base64() },
        c.cookie,
        empresaY.id,
      );
      expect(escritaAlheia.statusCode).toBe(403);
      expect(erroResponseSchema.parse(escritaAlheia.json()).erro).toMatch(/acesso negado/i);
      const negada = eventosDe(c, 'escopo.tentativa_negada').at(-1)!;
      expect(negada.usuarioId).toBe(c.contador.id);
      expect(negada.empresaId).toBe(empresaY.id);
      expect(negada.objetoTipo).toBe('importacao');
      expect(negada.dados).toMatchObject({ motivo: 'empresa_nao_atribuida' });
      expect(importacoesNoBanco(c)).toHaveLength(0); // nada foi importado em Y

      // (2) leitura: conta INEXISTENTE x conta ALHEIA — MESMA resposta (sem oráculo)
      const inexistente = await getConta(c, 999_999);
      const alheia = await getConta(c, contaY.id);
      expect(inexistente.statusCode).toBe(404);
      expect(alheia.statusCode).toBe(404);
      const erroInexistente = erroResponseSchema.parse(inexistente.json()).erro;
      const erroAlheia = erroResponseSchema.parse(alheia.json()).erro;
      expect(erroAlheia).toBe(erroInexistente);
      expect(erroAlheia).toMatch(/não encontrada nesta empresa/i);
      // leitura de detalhe não gera trilha nos dois casos (padrão GET /titulos/:id)
      expect(eventosDe(c, 'conta_bancaria.tentativa_negada')).toHaveLength(0);

      // (3) ESCRITA de item na conta alheia: MESMO 404; trilha só no alheio
      const itemInexistente = await postItem(c, 999_999, {
        data: '2026-05-05',
        descricao: 'Item em conta inexistente',
        valor_centavos: -1_000,
      });
      const itemAlheio = await postItem(c, contaY.id, {
        data: '2026-05-05',
        descricao: 'Item em conta alheia',
        valor_centavos: -1_000,
      });
      expect(itemInexistente.statusCode).toBe(404);
      expect(itemAlheio.statusCode).toBe(404);
      const erroItemInexistente = erroResponseSchema.parse(itemInexistente.json()).erro;
      const erroItemAlheio = erroResponseSchema.parse(itemAlheio.json()).erro;
      expect(erroItemAlheio).toBe(erroItemInexistente);
      expect(erroItemAlheio).toMatch(/não encontrada nesta empresa/i);
      const trilhas = eventosDe(c, 'conta_bancaria.tentativa_negada');
      expect(trilhas).toHaveLength(1);
      expect(trilhas[0]?.dados).toMatchObject({
        motivo: 'empresa_diferente',
        empresa_da_conta_bancaria: empresaY.id,
      });

      // itens da conta alheia seguem intactos (nada foi criado em X nem em Y)
      expect(itensNoBanco(c)).toHaveLength(0);
      const itensY = await c.t.app.inject({
        method: 'GET',
        url: `/contas-bancarias/${contaY.id}/itens?empresa_id=${empresaY.id}`,
        headers: { cookie: cookieY },
      });
      expect(itensY.statusCode).toBe(200);
      expect(listaItensExtratoResponseSchema.parse(itensY.json()).itens).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  /* ---------------- FIX-T018-R2: tetos explícitos de importação ---------------- */

  test('teto de 10.000 transações: 10.001 é recusada (400 arquivo_grande_demais) AUDITADA e sem item algum; 3.000 segue aceito', async () => {
    const c = await prepararCenario('CA-53-teto-transacoes');
    try {
      const conta = await criarContaBancariaViaApi(c);

      // arquivo sintético gerado no teste: 10.001 linhas (nada fixo no repo)
      const recusado = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-grande.csv',
        conteudo_base64: Buffer.from(csvSintetico(10_001), 'utf8').toString('base64'),
      });
      expect(recusado.statusCode).toBe(400);
      const mensagem = erroResponseSchema.parse(recusado.json()).erro;
      expect(mensagem).toMatch(/grande demais/i);
      expect(mensagem).toMatch(/divida o extrato/i);

      // recusa AUDITADA fora da transação, com o MESMO shape das demais recusas
      const recusas = eventosDe(c, 'importacao.recusada');
      expect(recusas).toHaveLength(1);
      expect(recusas[0]?.dados).toMatchObject({
        motivo: 'arquivo_grande_demais',
        conta_bancaria_id: conta.id,
        arquivo_hash: expect.any(String),
      });

      // ZERO itens / ZERO registros: a recusa acontece antes da transação
      expect(itensNoBanco(c)).toHaveLength(0);
      expect(importacoesNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'importacao.concluida')).toHaveLength(0);

      // O teto não se mete em arquivo médio: 3.000 linhas (abaixo do teto de
      // 10.000) segue aceito — 3.000 × 10 colunas = 30.000 placeholders, dentro
      // de SQLITE_MAX_VARIABLE_NUMBER = 32766 (o INSERT dos itens é feito em
      // lotes de 1.000 desde FIX-T018-R3; ver o teste de 4.000 abaixo).
      const medio = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-medio.csv',
        conteudo_base64: Buffer.from(csvSintetico(3_000), 'utf8').toString('base64'),
      });
      expect(medio.statusCode).toBe(201);
      expect(itensNoBanco(c)).toHaveLength(3_000);
      expect(importacoesNoBanco(c)).toHaveLength(1);
    } finally {
      await c.t.close();
    }
  });

  test('FIX-T018-R3: arquivo VÁLIDO de 4.000 transações importa 201 com os 4.000 itens no banco (INSERT em lotes)', async () => {
    const c = await prepararCenario('CA-53-arquivo-4000');
    try {
      const conta = await criarContaBancariaViaApi(c);

      // 4.000 linhas está ENTRE o teto de 10.000 (recusado com 400) e o limite
      // de 3.276 linhas por INSERT único do SQLite: sem lotes, o drizzle montava
      // um INSERT de 40.000 placeholders e o SQLite respondia
      // "too many SQL variables" ⇒ 500 sem evento `importacao.recusada`.
      const resposta = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-4000.csv',
        conteudo_base64: Buffer.from(csvSintetico(4_000), 'utf8').toString('base64'),
      });
      expect(resposta.statusCode).toBe(201);
      const corpo = importacaoExtratoResponseSchema.parse(resposta.json());
      expect(corpo.importacao.quantidade_itens).toBe(4_000);
      expect(corpo.itens).toHaveLength(4_000);
      expect(corpo.itens.every((item) => item.origem === 'importacao')).toBe(true);

      // contagem REAL no banco (não só na resposta) — todos os lotes juntos
      expect(itensNoBanco(c)).toHaveLength(4_000);
      expect(importacoesNoBanco(c)).toHaveLength(1);

      // atomicidade auditada: trilha única na MESMA transação dos itens,
      // nenhuma recusa
      const concluidas = eventosDe(c, 'importacao.concluida');
      expect(concluidas).toHaveLength(1);
      expect(concluidas[0]?.dados).toMatchObject({
        quantidade_itens: 4_000,
        formato: 'csv',
        conta_bancaria_id: conta.id,
      });
      expect(eventosDe(c, 'importacao.recusada')).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('teto de corpo: base64 acima de 2.000.000 chars é recusado pelo schema em pt-BR (400) e acima de 2 MiB pelo transporte (413)', async () => {
    const c = await prepararCenario('CA-53-teto-corpo');
    try {
      const conta = await criarContaBancariaViaApi(c);

      // 2.000.004 chars: base64 válido e corpo ABAIXO do bodyLimit de 2 MiB,
      // então quem responde é o schema (400 pt-BR) — não o transporte (413)
      const acimaDoSchema = await postImportacao(c, conta.id, {
        nome_arquivo: 'extrato-enorme.csv',
        conteudo_base64: 'A'.repeat(2_000_004),
      });
      expect(acimaDoSchema.statusCode).toBe(400);
      const mensagem = erroResponseSchema.parse(acimaDoSchema.json()).erro;
      expect(mensagem).toMatch(/conteúdo do arquivo em base64/i);
      expect(mensagem).toMatch(/2\.000\.000/);

      // pino do bodyLimit EXPLÍCITO (2 MiB): corpo maior não chega ao schema
      const acimaDoTransporte = await postImportacao(c, conta.id, {
        conteudo_base64: 'A'.repeat(2_300_000),
      });
      expect(acimaDoTransporte.statusCode).toBe(413);

      expect(itensNoBanco(c)).toHaveLength(0);
      expect(importacoesNoBanco(c)).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('recusa não reflete o campo cru: valor de 200 chars aparece truncado na mensagem, que segue apontando linha/transação', async () => {
    const c = await prepararCenario('CA-53-recusa-truncada');
    try {
      const conta = await criarContaBancariaViaApi(c);
      const cru = 'X'.repeat(200);

      const casos: Array<{ rotulo: string; conteudo: string; aponta: string }> = [
        {
          rotulo: 'CSV data',
          conteudo: Buffer.from(
            `data;descricao;valor\r\n${cru};Pagamento energia;-150,75\r\n`,
            'utf8',
          ).toString('base64'),
          aponta: 'linha 2 com data inválida',
        },
        {
          rotulo: 'CSV valor',
          conteudo: Buffer.from(
            `data;descricao;valor\r\n05/05/2026;Pagamento energia;${cru}\r\n`,
            'utf8',
          ).toString('base64'),
          aponta: 'linha 2 com valor inválido',
        },
        {
          rotulo: 'OFX DTPOSTED',
          conteudo: Buffer.from(ofxSimples({ dtPosted: cru }), 'latin1').toString('base64'),
          aponta: 'transação 1 com DTPOSTED inválido',
        },
        {
          rotulo: 'OFX TRNAMT',
          conteudo: Buffer.from(ofxSimples({ trnAmt: cru }), 'latin1').toString('base64'),
          aponta: 'transação 1 com TRNAMT inválido',
        },
      ];

      for (const caso of casos) {
        const resposta = await postImportacao(c, conta.id, { conteudo_base64: caso.conteudo });
        expect(resposta.statusCode, caso.rotulo).toBe(400);
        const mensagem = erroResponseSchema.parse(resposta.json()).erro;
        // continua apontando a linha/transação e o campo…
        expect(mensagem, caso.rotulo).toContain(caso.aponta);
        // …mas NÃO reflete os 200 caracteres inteiros (só o recorte + reticências)
        expect(mensagem, caso.rotulo).not.toContain(cru);
        expect(mensagem, caso.rotulo).toContain('…');
      }

      expect(itensNoBanco(c)).toHaveLength(0);
      expect(importacoesNoBanco(c)).toHaveLength(0);
    } finally {
      await c.t.close();
    }
  });

  test('descrição > 500 e identificador > 120 vindos do arquivo: recusa arquivo_invalido com a linha/transação e ZERO itens; limites exatos passam', async () => {
    const c = await prepararCenario('CA-53-limites-de-campo');
    try {
      const conta = await criarContaBancariaViaApi(c);
      const descricaoLonga = 'D'.repeat(600);

      // (a) CSV: descrição de 600 caracteres (o lançamento manual limita a 500)
      const csv = await postImportacao(c, conta.id, {
        conteudo_base64: Buffer.from(
          `data;descricao;valor\r\n05/05/2026;${descricaoLonga};-150,75\r\n`,
          'utf8',
        ).toString('base64'),
      });
      expect(csv.statusCode).toBe(400);
      expect(erroResponseSchema.parse(csv.json()).erro).toMatch(
        /linha 2 .*descrição.*600.*500/,
      );

      // (b) OFX: MEMO de 600 caracteres
      const ofxMemo = await postImportacao(c, conta.id, {
        conteudo_base64: Buffer.from(ofxSimples({ memo: descricaoLonga }), 'latin1').toString(
          'base64',
        ),
      });
      expect(ofxMemo.statusCode).toBe(400);
      expect(erroResponseSchema.parse(ofxMemo.json()).erro).toMatch(
        /transação 1 .*descrição.*600.*500/,
      );

      // (c) OFX: FITID de 130 caracteres
      const ofxFitid = await postImportacao(c, conta.id, {
        conteudo_base64: Buffer.from(ofxSimples({ fitid: 'F'.repeat(130) }), 'latin1').toString(
          'base64',
        ),
      });
      expect(ofxFitid.statusCode).toBe(400);
      expect(erroResponseSchema.parse(ofxFitid.json()).erro).toMatch(
        /transação 1 .*identificador.*130.*120/,
      );

      // as três recusas não deixam item algum (contagem no banco)
      expect(itensNoBanco(c)).toHaveLength(0);
      expect(importacoesNoBanco(c)).toHaveLength(0);
      expect(eventosDe(c, 'importacao.recusada').map((evento) => evento.dados)).toEqual([
        expect.objectContaining({ motivo: 'arquivo_invalido' }),
        expect.objectContaining({ motivo: 'arquivo_invalido' }),
        expect.objectContaining({ motivo: 'arquivo_invalido' }),
      ]);

      // fronteiras EXATAS: 500 de descrição e 120 de identificador são aceitas
      const csvNoLimite = await postImportacao(c, conta.id, {
        conteudo_base64: Buffer.from(
          `data;descricao;valor\r\n05/05/2026;${'D'.repeat(500)};-150,75\r\n`,
          'utf8',
        ).toString('base64'),
      });
      expect(csvNoLimite.statusCode).toBe(201);
      // o DTO de RESPOSTA não tem `max` (defesa) e não pode falhar no limite
      expect(
        importacaoExtratoResponseSchema.parse(csvNoLimite.json()).itens[0]?.descricao,
      ).toHaveLength(500);

      const ofxNoLimite = await postImportacao(c, conta.id, {
        conteudo_base64: Buffer.from(ofxSimples({ fitid: 'F'.repeat(120) }), 'latin1').toString(
          'base64',
        ),
      });
      expect(ofxNoLimite.statusCode).toBe(201);
      expect(
        importacaoExtratoResponseSchema.parse(ofxNoLimite.json()).itens[0]?.identificador,
      ).toHaveLength(120);

      expect(itensNoBanco(c)).toHaveLength(2);
      expect(importacoesNoBanco(c)).toHaveLength(2);
    } finally {
      await c.t.close();
    }
  });
});
