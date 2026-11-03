import {
  balanceteResponseSchema,
  balancoResponseSchema,
  erroResponseSchema,
  fluxoDeCaixaResponseSchema,
  razaoResponseSchema,
} from '@sistema-contabil/shared';
import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { auditEvent } from '../../src/db/schema.ts';
import { ErroAplicacao } from '../../src/errors.ts';
import { gerarPdf } from '../../src/services/exportacao.ts';
import { criarLancamento } from '../../src/services/lancamentos.ts';
import { createTestApp, type TestApp } from '../harness.ts';
import { criarFix01, type Fix01 } from '../fixtures/fix-01.ts';
import {
  criarFixFluxo,
  D_MAIS_10,
  D_MENOS_2,
  type FixFluxo,
} from '../fixtures/fluxo.ts';
import { criarUsuarioTeste, fazerLogin } from '../fixtures/seguranca.ts';

/**
 * Exportação CSV/PDF dos 4 relatórios (RF-18/CA-11, ADR-0006, ADR-0009;
 * TASK-019).
 *
 * CA-11: "o arquivo gerado contém os mesmos valores exibidos na tela
 * (conferência linha a linha)". Aqui a **tela** é a resposta JSON da API (a
 * mesma fonte que a T020 vai renderizar), então cada teste:
 *
 * 1. busca o JSON do relatório (referência);
 * 2. busca o MESMO relatório com `formato=csv` (ou `formato=pdf`);
 * 3. compara **campo a campo** o arquivo com o JSON — centavos exatos, sem
 *    arredondamento (ADR-0001/ADR-0006);
 * 4. confere o formato do ADR-0006: BOM UTF-8 (`EF BB BF`), separador `;` e
 *    decimal com vírgula.
 *
 * **Método de conferência do PDF (ADR-0006, decidido na T019):** o pdfmake
 * comprime os streams com Flate, então o teste (a) infla cada stream com
 * `inflateSync`, (b) recorta os blocos de texto `BT…ET`, (c) decodifica os
 * hex `Tj`/`TJ` em latin1 e (d) normaliza espaços — o mesmo método provado
 * fora da suíte antes de escrever este arquivo. O PDF é conferido por
 * **conteúdo** (cabeçalho empresa/período/emissão + valores canônicos), não
 * byte a byte.
 *
 * O em-dash `—` vira o byte 0x97 no WinAnsi e NÃO é assertado; os arquivos
 * usam `0,00` para zero justamente para o conteúdo ser conferível.
 */

/* -------------------------------------------------------------------------- */
/* Cápsula de conferência: célula do arquivo → centavos da API                 */
/* -------------------------------------------------------------------------- */

/** Formata centavos como no arquivo: milhar `.` e decimal `,` (ADR-0006). */
function brl(centavos: number): string {
  const negativo = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimal = (abs % 100).toString().padStart(2, '0');
  return `${negativo}${inteiro},${decimal}`;
}

/**
 * Volta da célula do arquivo para centavos. O `'` inicial NÃO é tolerado:
 * números negativos legítimos (`-3.000,00`) saem limpos no CSV (a proteção
 * contra injeção de fórmula é seletiva e não prefixa valor numérico — ver
 * `escapeFormulasProprio` em `exportacao.ts`).
 */
function centavosDe(celula: string): number {
  if (celula === '') {
    throw new Error('centavosDe: célula vazia — use toBe("") para célula não aplicável');
  }
  const negativo = celula.startsWith('-');
  const limpo = negativo ? celula.slice(1) : celula;
  const [inteiro = '0', decimal = '0'] = limpo.split(',');
  const centavos = Number(inteiro.replace(/\./g, '')) * 100 + Number(decimal);
  if (!Number.isFinite(centavos)) {
    throw new Error(`centavosDe: célula não numérica "${celula}"`);
  }
  return negativo ? -centavos : centavos;
}

/** Conferência de uma célula numérica: formato de moeda E centavos exatos. */
function expectNumerico(celula: string, centavosEsperado: number): void {
  // Sem tolerância a `'`: valor negativo formatado chega limpo ao arquivo.
  expect(celula, `célula "${celula}" fora do formato ADR-0006`).toMatch(
    /^-?\d{1,3}(\.\d{3})*,\d{2}$/,
  );
  expect(centavosDe(celula), `célula "${celula}"`).toBe(centavosEsperado);
}

/** Parser de CSV `;` com aspas (tolera o BOM no início). */
function parseCsv(texto: string): string[][] {
  const corpo = texto.startsWith('\ufeff') ? texto.slice(1) : texto;
  const linhas: string[][] = [];
  let atual: string[] = [];
  let campo = '';
  let entreAspas = false;
  for (let i = 0; i < corpo.length; i++) {
    const c = corpo[i]!;
    if (entreAspas) {
      if (c === '"') {
        if (corpo[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreAspas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreAspas = true;
    } else if (c === ';') {
      atual.push(campo);
      campo = '';
    } else if (c === '\r' && corpo[i + 1] === '\n') {
      atual.push(campo);
      linhas.push(atual);
      atual = [];
      campo = '';
      i++;
    } else if (c === '\n') {
      atual.push(campo);
      linhas.push(atual);
      atual = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || atual.length > 0) {
    atual.push(campo);
    linhas.push(atual);
  }
  return linhas;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` (formato de data do arquivo). */
function dataBR(iso: string): string {
  const partes = iso.split('-');
  return `${partes[2] ?? ''}/${partes[1] ?? ''}/${partes[0] ?? ''}`;
}

/* -------------------------------------------------------------------------- */
/* Método de conferência do PDF (ver doc do módulo acima)                      */
/* -------------------------------------------------------------------------- */

/** Infla todos os streams do PDF e devolve o conteúdo concatenado. */
function streamsInflados(buffer: Buffer): string {
  const pedacos: string[] = [];
  let pos = 0;
  for (;;) {
    const inicio = buffer.indexOf('stream', pos);
    if (inicio === -1) break;
    let cursor = inicio + 'stream'.length;
    if (buffer[cursor] === 0x0d) cursor++;
    if (buffer[cursor] === 0x0a) cursor++;
    const fim = buffer.indexOf('endstream', cursor);
    if (fim === -1) break;
    let conteudo = buffer.subarray(cursor, fim);
    // o stream termina antes do `endstream` e sempre com uma quebra de linha
    if (conteudo[conteudo.length - 1] === 0x0a) conteudo = conteudo.subarray(0, -1);
    if (conteudo[conteudo.length - 1] === 0x0d) conteudo = conteudo.subarray(0, -1);
    try {
      pedacos.push(inflateSync(conteudo).toString('latin1'));
    } catch {
      pedacos.push(conteudo.toString('latin1')); // stream não comprimido
    }
    pos = fim + 'endstream'.length;
  }
  return pedacos.join('\n');
}

/** Decodifica o hex de um operador de texto (`<...> Tj`/`TJ`) em latin1. */
function hexEmTexto(hex: string): string {
  return Buffer.from(hex.replace(/[^0-9a-fA-F]/g, ''), 'hex').toString('latin1');
}

/** Texto legível do PDF: blocos `BT…ET` + hex + normalização de espaços. */
function textoDoPdf(buffer: Buffer): string {
  const bruto = streamsInflados(buffer);
  const blocos = bruto.match(/BT[\s\S]*?ET/g) ?? [];
  const fragmentos: string[] = [];
  for (const bloco of blocos) {
    const partes: string[] = [];
    const operador = /\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g;
    let achou: RegExpExecArray | null;
    while ((achou = operador.exec(bloco)) !== null) {
      if (achou[0].startsWith('<')) {
        partes.push(hexEmTexto(achou[1] ?? ''));
      } else {
        partes.push(achou[0].slice(1, -1).replace(/\\([()\\])/g, '$1'));
      }
    }
    if (partes.length > 0) fragmentos.push(partes.join(''));
  }
  // pdfmake/pdfkit separam palavras por kerning (espaços duplicados) e cada
  // item de conteúdo vira um bloco — normalizar deixa a frase assertável.
  return fragmentos.join(' ').replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Requisições                                                                */
/* -------------------------------------------------------------------------- */

async function getJson(t: TestApp, url: string, cookie: string) {
  return t.app.inject({ method: 'GET', url, headers: { cookie } });
}

async function getArquivo(t: TestApp, url: string, cookie: string, formato: 'csv' | 'pdf') {
  return t.app.inject({
    method: 'GET',
    url: `${url}${url.includes('?') ? '&' : '?'}formato=${formato}`,
    headers: { cookie },
  });
}

/** Confere o envelope de arquivo do ADR-0006 (content-type + disposition). */
function expectEnvelope(resposta: Awaited<ReturnType<TestApp['app']['inject']>>, ext: string) {
  expect(resposta.statusCode, resposta.body).toBe(200);
  const tipo = String(resposta.headers['content-type']);
  if (ext === 'csv') expect(tipo).toMatch(/^text\/csv/);
  else expect(tipo).toMatch(/^application\/pdf/);
  const disposition = String(resposta.headers['content-disposition']);
  expect(disposition).toMatch(/^attachment;/);
  expect(disposition).toContain(`.${ext}`);
}

/* -------------------------------------------------------------------------- */
/* Cenários                                                                   */
/* -------------------------------------------------------------------------- */

describe('exportação CSV/PDF dos relatórios (RF-18, CA-11, ADR-0006)', () => {
  test('CA-11 CSV do balancete: mesmo JSON da tela campo a campo (BOM EF BB BF, ";" e decimal com vírgula); sem formato continua devolvendo JSON', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      const url = `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${f.periodo.id}`;

      // contrato JSON existente preservado (T015) quando `formato` ausente
      const semFormato = await getJson(t, url, f.cookie);
      expect(semFormato.statusCode).toBe(200);
      expect(String(semFormato.headers['content-type'])).toMatch(/application\/json/);
      const dto = balanceteResponseSchema.parse(semFormato.json());

      const csv = await getArquivo(t, url, f.cookie, 'csv');
      expectEnvelope(csv, 'csv');
      // BOM UTF-8 no início do payload
      expect([...csv.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const linhas = parseCsv(csv.body);
      expect(linhas[0]).toEqual([
        'Código',
        'Conta',
        'Débitos do período',
        'Créditos do período',
        'Saldo do período',
        'Acumulado até o período',
      ]);
      // dado puro: a tabela começa na primeira linha (sem metadados — ADR-0006)
      expect(linhas).toHaveLength(1 + dto.linhas.length + 1);

      dto.linhas.forEach((esperado, i) => {
        const celulas = linhas[i + 1]!;
        expect(celulas[0]).toBe(esperado.codigo);
        expect(celulas[1]).toBe(esperado.descricao);
        expectNumerico(celulas[2]!, esperado.debitos_centavos);
        expectNumerico(celulas[3]!, esperado.creditos_centavos);
        expectNumerico(celulas[4]!, esperado.saldo_periodo_centavos);
        expectNumerico(celulas[5]!, esperado.acumulado_centavos);
      });

      const totais = linhas.at(-1)!;
      expect(totais[0]).toBe('Totais');
      expect(totais[1]).toBe('');
      expectNumerico(totais[2]!, dto.totais.debitos_centavos);
      expectNumerico(totais[3]!, dto.totais.creditos_centavos);
      expect(totais[4]).toBe('');
      expect(totais[5]).toBe('');

      // separador `;` (sem aspas) e decimal com vírgula — ADR-0006
      expect(csv.body).toContain('Código;Conta;Débitos do período');
      expect(csv.body).toContain('3.000,00'); // R$ 3.000,00 de FIX-01
      expect(csv.body).not.toContain('3000.00');
    } finally {
      await t.close();
    }
  });

  test('CA-11 CSV do razão: mesmo JSON da tela campo a campo, incluindo a coluna única de contrapartes com join determinístico', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      const url = `/relatorios/razao?empresa_id=${f.empresa.id}&conta_id=${f.caixa.id}`;

      const dto = razaoResponseSchema.parse((await getJson(t, url, f.cookie)).json());
      const csv = await getArquivo(t, url, f.cookie, 'csv');
      expectEnvelope(csv, 'csv');
      expect([...csv.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const linhas = parseCsv(csv.body);
      expect(linhas[0]).toEqual([
        'Data',
        'Lançamento',
        'Histórico',
        'Contrapartes',
        'Débito',
        'Crédito',
        'Saldo corrente',
      ]);
      expect(linhas).toHaveLength(1 + dto.linhas.length + 1);

      dto.linhas.forEach((esperado, i) => {
        const celulas = linhas[i + 1]!;
        expect(celulas[0]).toBe(dataBR(esperado.data)); // dd/MM/AAAA no arquivo
        expect(celulas[1]).toBe(String(esperado.lancamento_id));
        expect(celulas[2]).toBe(esperado.historico);
        // join determinístico: `<codigo> <descricao> (<natureza>) <valor>`, unidos por ` | `
        expect(celulas[3]).toBe(
          esperado.contrapartes
            .map(
              (item) =>
                `${item.codigo} ${item.descricao} (${item.natureza}) ${brl(item.valor_centavos)}`,
            )
            .join(' | '),
        );
        expectNumerico(celulas[4]!, esperado.debito_centavos);
        expectNumerico(celulas[5]!, esperado.credito_centavos);
        expectNumerico(celulas[6]!, esperado.saldo_corrente_centavos);
      });

      const totais = linhas.at(-1)!;
      expect(totais[0]).toBe('Totais');
      expect(totais.slice(1, 4)).toEqual(['', '', '']);
      expectNumerico(totais[4]!, dto.total_debitos_centavos);
      expectNumerico(totais[5]!, dto.total_creditos_centavos);
      expectNumerico(totais[6]!, dto.saldo_final_centavos);
    } finally {
      await t.close();
    }
  });

  test('CA-11 CSV do balanço: seção + linha Totais por seção, mesmo JSON da tela campo a campo', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      const url = `/relatorios/balanco?empresa_id=${f.empresa.id}&data=2026-03-31`;

      const dto = balancoResponseSchema.parse((await getJson(t, url, f.cookie)).json());
      const csv = await getArquivo(t, url, f.cookie, 'csv');
      expectEnvelope(csv, 'csv');
      expect([...csv.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const linhas = parseCsv(csv.body);
      expect(linhas[0]).toEqual(['Seção', 'Código', 'Conta', 'Valor']);

      const esperadas: string[][] = [];
      const secoes: [string, typeof dto.ativo][] = [
        ['Ativo', dto.ativo],
        ['Passivo', dto.passivo],
        ['Patrimônio líquido', dto.patrimonio_liquido],
      ];
      for (const [rotulo, secao] of secoes) {
        for (const linha of secao.linhas) {
          esperadas.push([rotulo, linha.codigo, linha.descricao, brl(linha.saldo_centavos)]);
        }
        esperadas.push([rotulo, 'Totais', '', brl(secao.total_centavos)]);
      }
      // O `escape_formulas` NÃO prefixa `'` em valor negativo legítimo: a
      // despesa `-600,00` sai limpa (sem apóstrofo), senão a coluna deixa de
      // somar no Excel (achado 1 da revisão da T019). Proteção contra injeção
      // é seletiva e continua cobrindo `=`/`+`/`@` (teste dedicado abaixo).
      expect(linhas.slice(1)).toEqual(esperadas);
      expect(csv.body).not.toContain("'-"); // nenhum negativo cegado
      expect(csv.body).toContain('-600,00'); // despesa de FIX-01, limpa

      // `confere` é flag derivada da tela — não vai ao arquivo (decisão T019)
      expect(csv.body).not.toContain('confere');
      expect(dto.totais.confere).toBe(true);
    } finally {
      await t.close();
    }
  });

  test('CA-11 CSV do fluxo de caixa: linha Saldo inicial, dias com movimento e linha Totais — mesmo JSON da tela campo a campo', async () => {
    const t = await createTestApp();
    try {
      const f: FixFluxo = await criarFixFluxo(t.app, t.database.db);
      const url = `/relatorios/fluxo-de-caixa?empresa_id=${f.empresa.id}&de=${D_MENOS_2}&ate=${D_MAIS_10}`;

      const dto = fluxoDeCaixaResponseSchema.parse((await getJson(t, url, f.cookie)).json());
      const csv = await getArquivo(t, url, f.cookie, 'csv');
      expectEnvelope(csv, 'csv');
      expect([...csv.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const linhas = parseCsv(csv.body);
      expect(linhas[0]).toEqual([
        'Data',
        'Entradas realizadas',
        'Saídas realizadas',
        'Entradas previstas',
        'Saídas previstas',
        'Saldo',
      ]);
      expect(linhas).toHaveLength(1 + 1 + dto.linhas.length + 1);

      // linha de saldo inicial: só o saldo preenchido
      expect(linhas[1]).toEqual([
        'Saldo inicial',
        '',
        '',
        '',
        '',
        brl(dto.saldo_inicial_centavos),
      ]);
      expectNumerico(linhas[1]![5]!, dto.saldo_inicial_centavos);

      dto.linhas.forEach((esperado, i) => {
        const celulas = linhas[i + 2]!;
        expect(celulas[0]).toBe(dataBR(esperado.data));
        expectNumerico(celulas[1]!, esperado.entradas_realizadas_centavos);
        expectNumerico(celulas[2]!, esperado.saidas_realizadas_centavos);
        expectNumerico(celulas[3]!, esperado.entradas_previstas_centavos);
        expectNumerico(celulas[4]!, esperado.saidas_previstas_centavos);
        expectNumerico(celulas[5]!, esperado.saldo_acumulado_centavos);
      });

      const totais = linhas.at(-1)!;
      expect(totais[0]).toBe('Totais');
      expectNumerico(totais[1]!, dto.totais.entradas_realizadas_centavos);
      expectNumerico(totais[2]!, dto.totais.saidas_realizadas_centavos);
      expectNumerico(totais[3]!, dto.totais.entradas_previstas_centavos);
      expectNumerico(totais[4]!, dto.totais.saidas_previstas_centavos);
      expectNumerico(totais[5]!, dto.saldo_final_centavos);
    } finally {
      await t.close();
    }
  });

  test('CA-11 PDF dos 4 relatórios: cabeçalho com razão social, período e data/hora de emissão + mesmos valores da tela (método de extração documentado)', async () => {
    const t = await createTestApp();
    try {
      const fix01: Fix01 = await criarFix01(t.app, t.database.db);
      const fixFluxo: FixFluxo = await criarFixFluxo(t.app, t.database.db);

      /** Gera o PDF, confere o envelope e devolve o texto extraído. */
      const pdfDe = async (url: string, cookie: string): Promise<string> => {
        const resposta = await getArquivo(t, url, cookie, 'pdf');
        expectEnvelope(resposta, 'pdf');
        expect(resposta.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        return textoDoPdf(resposta.rawPayload);
      };

      // (a) balancete
      const balancete = balanceteResponseSchema.parse(
        (
          await getJson(
            t,
            `/relatorios/balancete?empresa_id=${fix01.empresa.id}&periodo_id=${fix01.periodo.id}`,
            fix01.cookie,
          )
        ).json(),
      );
      const pdfBalancete = await pdfDe(
        `/relatorios/balancete?empresa_id=${fix01.empresa.id}&periodo_id=${fix01.periodo.id}`,
        fix01.cookie,
      );
      expect(pdfBalancete).toContain(fix01.empresa.razaoSocial);
      expect(pdfBalancete).toContain('Balancete');
      expect(pdfBalancete).toContain('Período: 03/2026');
      expect(pdfBalancete).toMatch(/Emissão: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(pdfBalancete).toContain(brl(balancete.totais.debitos_centavos)); // 3.000,00
      expect(pdfBalancete).toContain(brl(balancete.totais.creditos_centavos));
      expect(pdfBalancete).toContain('Caixa');

      // (b) razão
      const razaoUrl = `/relatorios/razao?empresa_id=${fix01.empresa.id}&conta_id=${fix01.caixa.id}&de=2026-03-01&ate=2026-03-31`;
      const razao = razaoResponseSchema.parse((await getJson(t, razaoUrl, fix01.cookie)).json());
      const pdfRazao = await pdfDe(razaoUrl, fix01.cookie);
      expect(pdfRazao).toContain(fix01.empresa.razaoSocial);
      expect(pdfRazao).toContain('Razão da conta 1.1.1 Caixa');
      expect(pdfRazao).toContain('Período: De 01/03/2026 a 31/03/2026');
      expect(pdfRazao).toMatch(/Emissão: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(pdfRazao).toContain(brl(razao.saldo_final_centavos)); // 900,00
      expect(pdfRazao).toContain('L1'); // histórico do lançamento L1 (FIX-01)

      // (c) balanço
      const balancoUrl = `/relatorios/balanco?empresa_id=${fix01.empresa.id}&data=2026-03-31`;
      const balanco = balancoResponseSchema.parse(
        (await getJson(t, balancoUrl, fix01.cookie)).json(),
      );
      const pdfBalanco = await pdfDe(balancoUrl, fix01.cookie);
      expect(pdfBalanco).toContain(fix01.empresa.razaoSocial);
      expect(pdfBalanco).toContain('Balanço patrimonial');
      expect(pdfBalanco).toContain('Período: Em 31/03/2026');
      expect(pdfBalanco).toMatch(/Emissão: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(pdfBalanco).toContain(brl(balanco.totais.ativo_centavos)); // 1.300,00
      expect(pdfBalanco).toContain(brl(balanco.totais.patrimonio_liquido_centavos)); // 1.100,00

      // (d) fluxo de caixa
      const fluxoUrl = `/relatorios/fluxo-de-caixa?empresa_id=${fixFluxo.empresa.id}&de=${D_MENOS_2}&ate=${D_MAIS_10}`;
      const fluxo = fluxoDeCaixaResponseSchema.parse(
        (await getJson(t, fluxoUrl, fixFluxo.cookie)).json(),
      );
      const pdfFluxo = await pdfDe(fluxoUrl, fixFluxo.cookie);
      expect(pdfFluxo).toContain(fixFluxo.empresa.razaoSocial); // acentuado: São João
      expect(pdfFluxo).toContain('Fluxo de caixa');
      expect(pdfFluxo).toContain('Período: De 08/03/2026 a 20/03/2026');
      expect(pdfFluxo).toMatch(/Emissão: \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
      expect(pdfFluxo).toContain(brl(fluxo.saldo_inicial_centavos)); // 10.000,00
      expect(pdfFluxo).toContain(brl(fluxo.saldo_final_centavos)); // 10.500,00
      expect(pdfFluxo).toContain(brl(150_000)); // entrada realizada 1.500,00 (D−2)
    } finally {
      await t.close();
    }
  });

  test('CA-11 formato fora de csv/pdf é recusado com mensagem em pt-BR (400) e nenhuma saída de arquivo', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      const url = `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${f.periodo.id}&formato=xls`;

      const resposta = await getJson(t, url, f.cookie);
      expect(resposta.statusCode).toBe(400);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(
        /formato de exportação válido/i,
      );
      expect(resposta.headers['content-disposition']).toBeUndefined();
    } finally {
      await t.close();
    }
  });

  test('CA-11 exportação usa as MESMAS permissões da leitura: contador não atribuído é recusado (403) e administrador exporta com leitura global auditada', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      const url = `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${f.periodo.id}`;

      // contador sem atribuição da empresa: recusado nos DOIS formatos
      const deFora = await criarUsuarioTeste(t.database.db, {
        email: 'fora-da-empresa@escritorio.test',
        papel: 'contador',
        empresas: [],
      });
      const { cookie: cookieDeFora } = await fazerLogin(t.app, deFora.email);
      const csvNegado = await getArquivo(t, url, cookieDeFora, 'csv');
      expect(csvNegado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(csvNegado.json()).erro).toMatch(/acesso negado/i);
      expect(csvNegado.headers['content-disposition']).toBeUndefined();
      const pdfNegado = await getArquivo(t, url, cookieDeFora, 'pdf');
      expect(pdfNegado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(pdfNegado.json()).erro).toMatch(/acesso negado/i);

      // administrador sem atribuição exporta — leitura global auditada (F13/CA-34)
      const admin = await criarUsuarioTeste(t.database.db, {
        email: 'admin-de-exportacao@escritorio.test',
        papel: 'administrador',
      });
      const { cookie: cookieAdmin } = await fazerLogin(t.app, admin.email);
      const csvAdmin = await getArquivo(t, url, cookieAdmin, 'csv');
      expectEnvelope(csvAdmin, 'csv');

      const globais = t.database.db
        .select()
        .from(auditEvent)
        .all()
        .filter((evento) => evento.acao === 'escopo.leitura_global');
      const evento = globais.at(-1);
      expect(evento?.usuarioId).toBe(admin.id);
      expect(evento?.empresaId).toBe(f.empresa.id);
      expect(evento?.objetoTipo).toBe('relatorio_balancete');
    } finally {
      await t.close();
    }
  });

  test('ADR-0009 escape SELETIVO: negativo formatado sai limpo no CSV (sem apóstrofo, coluna soma no Excel) e string iniciada por "=" continua cegada com apóstrofo', async () => {
    const t = await createTestApp();
    try {
      const f: Fix01 = await criarFix01(t.app, t.database.db);
      // Histórico hostil que uma planilha executaria como fórmula se o
      // escape fosse retirado (gatilho real de CSV/formula injection).
      await criarLancamento(
        t.database.db,
        {
          empresaId: f.empresa.id,
          data: '2026-03-27',
          historico: '=1+1',
          partidas: [
            { contaId: f.caixa.id, natureza: 'D', valorCentavos: 1_00 },
            { contaId: f.capital.id, natureza: 'C', valorCentavos: 1_00 },
          ],
        },
        f.contador.id,
      );

      // (a) negativo legítimo (Fornecedor credor −200,00 em FIX-01) chega
      // LIMPO ao balancete: sem `'`, senão a coluna vira texto no Excel pt-BR
      const balancete = await getArquivo(
        t,
        `/relatorios/balancete?empresa_id=${f.empresa.id}&periodo_id=${f.periodo.id}`,
        f.cookie,
        'csv',
      );
      expectEnvelope(balancete, 'csv');
      expect(balancete.body).toContain(';-200,00;'); // saldo do período credor
      expect(balancete.body).not.toContain("'-"); // nenhum valor cegado

      // (b) gatilho REAL continua protegido: histórico "=1+1" sai como
      // "'=1+1" — não executável na planilha
      const razao = await getArquivo(
        t,
        `/relatorios/razao?empresa_id=${f.empresa.id}&conta_id=${f.caixa.id}`,
        f.cookie,
        'csv',
      );
      expectEnvelope(razao, 'csv');
      const linhas = parseCsv(razao.body);
      const hostil = linhas.find((linha) => linha[2]?.includes('1+1'));
      expect(hostil, 'o lançamento com histórico "=1+1" deve estar no CSV').toBeDefined();
      expect(hostil![2]).toBe("'=1+1");
    } finally {
      await t.close();
    }
  });

  test('CA-11 formato inválido NO FLUXO DE CAIXA também é recusado com 400 em pt-BR e nenhuma saída de arquivo (mesma validação dos irmãos)', async () => {
    const t = await createTestApp();
    try {
      const f: FixFluxo = await criarFixFluxo(t.app, t.database.db);
      const url = `/relatorios/fluxo-de-caixa?empresa_id=${f.empresa.id}&de=${D_MENOS_2}&ate=${D_MAIS_10}&formato=xls`;

      const resposta = await getJson(t, url, f.cookie);
      expect(resposta.statusCode).toBe(400);
      expect(erroResponseSchema.parse(resposta.json()).erro).toMatch(
        /formato de exportação válido/i,
      );
      expect(resposta.headers['content-disposition']).toBeUndefined();
    } finally {
      await t.close();
    }
  });

  test('CA-11 exportação do FLUXO DE CAIXA usa as MESMAS permissões da leitura: contador não atribuído é recusado (403) nos DOIS formatos', async () => {
    const t = await createTestApp();
    try {
      const f: FixFluxo = await criarFixFluxo(t.app, t.database.db);
      const url = `/relatorios/fluxo-de-caixa?empresa_id=${f.empresa.id}&de=${D_MENOS_2}&ate=${D_MAIS_10}`;

      const deFora = await criarUsuarioTeste(t.database.db, {
        email: 'fora-do-fluxo@escritorio.test',
        papel: 'contador',
        empresas: [],
      });
      const { cookie: cookieDeFora } = await fazerLogin(t.app, deFora.email);

      const csvNegado = await getArquivo(t, url, cookieDeFora, 'csv');
      expect(csvNegado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(csvNegado.json()).erro).toMatch(/acesso negado/i);
      expect(csvNegado.headers['content-disposition']).toBeUndefined();

      const pdfNegado = await getArquivo(t, url, cookieDeFora, 'pdf');
      expect(pdfNegado.statusCode).toBe(403);
      expect(erroResponseSchema.parse(pdfNegado.json()).erro).toMatch(/acesso negado/i);
      expect(pdfNegado.headers['content-disposition']).toBeUndefined();
    } finally {
      await t.close();
    }
  });

  test('ADR-0009 falha na geração do PDF vira ErroAplicacao 500 com mensagem própria em pt-BR, sem vazar a causa interna', async () => {
    // Fonte não definida na definição faz o getBuffer() do pdfmake rejeitar —
    // provado fora da suíte antes de escrever este assert; sem mock invasivo.
    const capturado = await gerarPdf({
      defaultStyle: { font: 'Helvetica' },
      content: [{ text: 'x', font: 'FonteInexistente' }],
    }).catch((erro: unknown) => erro);

    expect(capturado).toBeInstanceOf(ErroAplicacao);
    const erro = capturado as ErroAplicacao;
    expect(erro.statusCode).toBe(500);
    expect(erro.message).toMatch(/não foi possível gerar o arquivo PDF/i);
    // a causa interna do pdfmake NÃO vaza na resposta
    expect(erro.message).not.toMatch(/FonteInexistente/i);
  });
});
