import { eq } from 'drizzle-orm';
import type {
  BalanceteResponse,
  BalancoResponse,
  FluxoDeCaixaResponse,
  FormatoExportacaoDTO,
  RazaoResponse,
} from '@sistema-contabil/shared';
import { stringify } from 'csv-stringify/sync';
import pdfmake from 'pdfmake';
import type { Content, TableCell } from 'pdfmake';
import type { AppDb } from '../db/index.ts';
import { empresa } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';

/**
 * Exportação CSV/PDF dos relatórios (RF-18/CA-11, ADR-0006, ADR-0009;
 * TASK-019).
 *
 * O MESMO DTO validado da resposta JSON alimenta o arquivo (CA-11: "os
 * mesmos valores exibidos na tela") — o serviço só formata centavos para
 * moeda e datas para `DD/MM/AAAA` na camada de arquivo; o JSON continua com
 * centavos inteiros (ADR-0001).
 *
 * CSV (ADR-0006/ADR-0009): BOM UTF-8, separador `;`, decimal com vírgula,
 * aspas só quando necessário, proteção SELETIVA contra injeção de fórmula
 * (campo iniciado por `=`/`+`/`@`/tab/CR ganha `'`; número negativo legítimo
 * como `-3.000,00` sai LIMPO — ver `escapeFormulasProprio`) e fim de linha
 * `\r\n`. Dado puro: a tabela começa na primeira linha (sem metadados).
 *
 * PDF (server-side, pdfmake): cabeçalho com razão social, título, período e
 * data/hora de emissão; tabelas com `headerRows` (cabeçalho repete em cada
 * página) e layout `lightHorizontalLines`. Buffer em memória (nenhum arquivo
 * em disco). Fontes padrão Helvetica com acesso local restrito às próprias
 * fontes e acesso remoto desativado.
 */

/* -------------------------------------------------------------------------- */
/* Formatação da camada de arquivo                                             */
/* -------------------------------------------------------------------------- */

/** Centavos inteiros → moeda do arquivo: milhar `.` e decimal `,` (ADR-0006). */
export function formatarCentavos(centavos: number): string {
  const negativo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const inteiro = Math.floor(absoluto / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const decimal = (absoluto % 100).toString().padStart(2, '0');
  return `${negativo}${inteiro},${decimal}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA` (datas do arquivo). */
export function formatarDataBR(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia ?? ''}/${mes ?? ''}/${ano ?? ''}`;
}

/** Data/hora da emissão em `DD/MM/AAAA HH:mm` (cabeçalho do PDF). */
function formatarEmissao(data: Date): string {
  const dois = (valor: number): string => String(valor).padStart(2, '0');
  return `${dois(data.getDate())}/${dois(data.getMonth() + 1)}/${data.getFullYear()} ${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

/** Nome de arquivo seguro (ASCII, sem acentos/espaços — ADR-0006). */
function slugAscii(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* -------------------------------------------------------------------------- */
/* pdfmake (instância única do processo)                                       */
/* -------------------------------------------------------------------------- */

/** Fontes padrão do pdfmake permitidas no servidor (nenhuma externa). */
const FONTES_PDF: readonly string[] = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
];

// O import default de `pdfmake` é a instância única (CJS: `module.exports =
// new pdfmake()`); a configuração é feita uma vez no carregamento.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((caminho) => FONTES_PDF.includes(caminho));
pdfmake.setFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});

type DefinicaoDocumento = Parameters<typeof pdfmake.createPdf>[0];

// Exportada para o teste do caminho de falha (T019-FIX, achado 6): o buffer
// rejeitado aqui é o que vira `ErroAplicacao` 500 com mensagem própria.
export async function gerarPdf(definicao: DefinicaoDocumento): Promise<Buffer> {
  try {
    return await pdfmake.createPdf(definicao).getBuffer();
  } catch (erro) {
    // Falha de geração (fonte, layout, stream): 500 com mensagem própria em
    // pt-BR, sem vazar stack/causa interna ao cliente. O detalhe só no log do
    // servidor — mesmo caminho do handler global para erro não tratado.
    console.error('[exportacao] falha ao gerar PDF do relatório:', erro);
    throw new ErroAplicacao(
      500,
      'Não foi possível gerar o arquivo PDF do relatório. Tente novamente.',
      'pdf_geracao_falhou',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Arquivo de saída                                                            */
/* -------------------------------------------------------------------------- */

export interface ArquivoRelatorio {
  contentType: string;
  nomeArquivo: string;
  buffer: Buffer;
}

/** O que o handler já montou (DTO validado) e o que falta para exportar. */
export type EntradaExportacao =
  | { relatorio: 'balancete'; dto: BalanceteResponse }
  | { relatorio: 'razao'; dto: RazaoResponse }
  | { relatorio: 'balanco'; dto: BalancoResponse }
  | { relatorio: 'fluxo-de-caixa'; dto: FluxoDeCaixaResponse };

/** Razão social da empresa (cabeçalho do PDF e nome do arquivo). */
function buscarRazaoSocial(db: AppDb, empresaId: number): string {
  const linhas = db
    .select({ razaoSocial: empresa.razaoSocial })
    .from(empresa)
    .where(eq(empresa.id, empresaId))
    .limit(1)
    .all();
  const razaoSocial = linhas[0]?.razaoSocial;
  if (!razaoSocial) {
    throw new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada');
  }
  return razaoSocial;
}

/**
 * Gera o arquivo (CSV ou PDF) do relatório a partir do MESMO DTO da tela.
 * A autorização acontece na rota, antes — aqui é só formatação.
 */
export async function gerarArquivoRelatorio(
  db: AppDb,
  formato: FormatoExportacaoDTO,
  entrada: EntradaExportacao,
): Promise<ArquivoRelatorio> {
  const razaoSocial = buscarRazaoSocial(db, entrada.dto.empresa_id);
  const contexto = { razaoSocial, emissao: new Date() };

  const base =
    entrada.relatorio === 'balancete'
      ? `balancete-${slugAscii(razaoSocial)}-${entrada.dto.periodo.ano}-${String(entrada.dto.periodo.mes).padStart(2, '0')}`
      : entrada.relatorio === 'razao'
        ? `razao-${slugAscii(razaoSocial)}-${sufixoIntervalo(entrada.dto.de, entrada.dto.ate)}`
        : entrada.relatorio === 'balanco'
          ? `balanco-${slugAscii(razaoSocial)}-${entrada.dto.data}`
          : `fluxo-de-caixa-${slugAscii(razaoSocial)}-${entrada.dto.de}_a_${entrada.dto.ate}`;

  if (formato === 'csv') {
    const linhas =
      entrada.relatorio === 'balancete'
        ? linhasCsvBalancete(entrada.dto)
        : entrada.relatorio === 'razao'
          ? linhasCsvRazao(entrada.dto)
          : entrada.relatorio === 'balanco'
            ? linhasCsvBalanco(entrada.dto)
            : linhasCsvFluxo(entrada.dto);
    return {
      contentType: 'text/csv; charset=utf-8',
      nomeArquivo: `${base}.csv`,
      buffer: gerarCsv(linhas),
    };
  }

  const definicao =
    entrada.relatorio === 'balancete'
      ? definicaoBalancete(entrada.dto, contexto)
      : entrada.relatorio === 'razao'
        ? definicaoRazao(entrada.dto, contexto)
        : entrada.relatorio === 'balanco'
          ? definicaoBalanco(entrada.dto, contexto)
          : definicaoFluxo(entrada.dto, contexto);
  return {
    contentType: 'application/pdf',
    nomeArquivo: `${base}.pdf`,
    buffer: await gerarPdf(definicao),
  };
}

/** Sufixo do nome de arquivo: intervalo quando existe, senão "completo". */
function sufixoIntervalo(de: string | null, ate: string | null): string {
  if (de && ate) return `${de}_a_${ate}`;
  if (de) return `${de}`;
  if (ate) return `${ate}`;
  return 'completo';
}

/* -------------------------------------------------------------------------- */
/* CSV (ADR-0006)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Blindagem contra CSV/formula injection (OWASP) — SELETIVA.
 *
 * O `escape_formulas: true` da csv-stringify prefixa `'` em TODO campo
 * string iniciado por `-`, então o saldo negativo `-3.000,00` saía como
 * `'-3.000,00`: no Excel pt-BR o `'` visível vira texto e a coluna deixa de
 * somar — degradando o objetivo do ADR-0006 (CSV "para conferência"). A lib
 * só aceita `escape_formulas` booleano (`normalize_options.js` recusa
 * função), então a proteção é aplicada aqui, antes do stringify:
 *
 * - prefixa `'` quando o valor NÃO é número canônico do projeto
 *   (`^-?\d{1,3}(\.\d{3})*,\d{2}$`, ex.: `0,00`, `1.500,00`, `-3.000,00`)
 *   E começa por um dos gatilhos reais de fórmula: `=`, `+`, `@`, tab, CR
 *   ou `-` (código/contraparte não numérica iniciada em `-` continua
 *   cegada — o risco de injeção é de TEXTO, não de número);
 * - números negativos formatados passam limpos (sem `'`), preservando a
 *   soma no Excel e o assert "mesmo valor da tela" (CA-11).
 */
const GATILHOS_INJECAO = new Set(['-', '=', '+', '@', '\t', '\r', '\uFF1D', '\uFF0B', '\uFF0D', '\uFF20']);
const NUMERO_CANONICO = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;

function escapeFormulasProprio(valor: string): string {
  const primeiro = valor[0];
  if (primeiro === undefined || !GATILHOS_INJECAO.has(primeiro)) return valor;
  if (NUMERO_CANONICO.test(valor)) return valor; // negativo legítimo: limpo
  return `'${valor}`;
}

function gerarCsv(linhas: (string | number)[][]): Buffer {
  const texto = stringify(
    linhas.map((linha) =>
      linha.map((campo) => (typeof campo === 'string' ? escapeFormulasProprio(campo) : campo)),
    ),
    {
      bom: true,
      delimiter: ';',
      // Proteção de fórmula é a seletiva `escapeFormulasProprio` acima; a da
      // lib prefixaria `'` em todo `-` inicial e corromperia negativos.
      escape_formulas: false,
      record_delimiter: '\r\n',
    },
  );
  return Buffer.from(texto, 'utf8');
}

function linhasCsvBalancete(dto: BalanceteResponse): (string | number)[][] {
  const linhas: (string | number)[][] = [
    ['Código', 'Conta', 'Débitos do período', 'Créditos do período', 'Saldo do período', 'Acumulado até o período'],
    ...dto.linhas.map((linha) => [
      linha.codigo,
      linha.descricao,
      formatarCentavos(linha.debitos_centavos),
      formatarCentavos(linha.creditos_centavos),
      formatarCentavos(linha.saldo_periodo_centavos),
      formatarCentavos(linha.acumulado_centavos),
    ]),
    [
      'Totais',
      '',
      formatarCentavos(dto.totais.debitos_centavos),
      formatarCentavos(dto.totais.creditos_centavos),
      '',
      '',
    ],
  ];
  return linhas;
}

/** Contrapartes do razão em uma única coluna, com join determinístico. */
function contrapartesEmUmaColuna(
  contrapartes: RazaoResponse['linhas'][number]['contrapartes'],
): string {
  return contrapartes
    .map(
      (item) =>
        `${item.codigo} ${item.descricao} (${item.natureza}) ${formatarCentavos(item.valor_centavos)}`,
    )
    .join(' | ');
}

function linhasCsvRazao(dto: RazaoResponse): (string | number)[][] {
  return [
    ['Data', 'Lançamento', 'Histórico', 'Contrapartes', 'Débito', 'Crédito', 'Saldo corrente'],
    ...dto.linhas.map((linha) => [
      formatarDataBR(linha.data),
      String(linha.lancamento_id),
      linha.historico,
      contrapartesEmUmaColuna(linha.contrapartes),
      formatarCentavos(linha.debito_centavos),
      formatarCentavos(linha.credito_centavos),
      formatarCentavos(linha.saldo_corrente_centavos),
    ]),
    [
      'Totais',
      '',
      '',
      '',
      formatarCentavos(dto.total_debitos_centavos),
      formatarCentavos(dto.total_creditos_centavos),
      formatarCentavos(dto.saldo_final_centavos),
    ],
  ];
}

/** Seções do balanço na ordem de apresentação (com rótulo em cada linha). */
function secoesDoBalanco(
  dto: BalancoResponse,
): [string, BalancoResponse['ativo']][] {
  return [
    ['Ativo', dto.ativo],
    ['Passivo', dto.passivo],
    ['Patrimônio líquido', dto.patrimonio_liquido],
  ];
}

function linhasCsvBalanco(dto: BalancoResponse): (string | number)[][] {
  const linhas: (string | number)[][] = [['Seção', 'Código', 'Conta', 'Valor']];
  for (const [rotulo, secao] of secoesDoBalanco(dto)) {
    for (const linha of secao.linhas) {
      linhas.push([rotulo, linha.codigo, linha.descricao, formatarCentavos(linha.saldo_centavos)]);
    }
    linhas.push([rotulo, 'Totais', '', formatarCentavos(secao.total_centavos)]);
  }
  return linhas;
}

function linhasCsvFluxo(dto: FluxoDeCaixaResponse): (string | number)[][] {
  return [
    ['Data', 'Entradas realizadas', 'Saídas realizadas', 'Entradas previstas', 'Saídas previstas', 'Saldo'],
    ['Saldo inicial', '', '', '', '', formatarCentavos(dto.saldo_inicial_centavos)],
    ...dto.linhas.map((linha) => [
      formatarDataBR(linha.data),
      formatarCentavos(linha.entradas_realizadas_centavos),
      formatarCentavos(linha.saidas_realizadas_centavos),
      formatarCentavos(linha.entradas_previstas_centavos),
      formatarCentavos(linha.saidas_previstas_centavos),
      formatarCentavos(linha.saldo_acumulado_centavos),
    ]),
    [
      'Totais',
      formatarCentavos(dto.totais.entradas_realizadas_centavos),
      formatarCentavos(dto.totais.saidas_realizadas_centavos),
      formatarCentavos(dto.totais.entradas_previstas_centavos),
      formatarCentavos(dto.totais.saidas_previstas_centavos),
      formatarCentavos(dto.saldo_final_centavos),
    ],
  ];
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                         */
/* -------------------------------------------------------------------------- */

interface ContextoPdf {
  razaoSocial: string;
  emissao: Date;
}

/** Célula de tabela: texto alinhado (números à direita, títulos à esquerda). */
function celula(texto: string, alinhamento: 'left' | 'right' = 'left', negrito = false) {
  return { text: texto, alignment: alinhamento, ...(negrito ? { bold: true } : {}) };
}

/** Cabeçalho de identificação do documento (razão social, título, período, emissão). */
function cabecalhoPdf(contexto: ContextoPdf, titulo: string, periodo: string): Content[] {
  return [
    { text: contexto.razaoSocial, fontSize: 13, bold: true },
    { text: titulo, fontSize: 15, bold: true, margin: [0, 6, 0, 2] },
    { text: `Período: ${periodo}`, margin: [0, 0, 0, 2] },
    { text: `Emissão: ${formatarEmissao(contexto.emissao)}`, fontSize: 9, margin: [0, 0, 0, 10] },
  ];
}

function definicaoBalancete(dto: BalanceteResponse, contexto: ContextoPdf): DefinicaoDocumento {
  const corpo: TableCell[][] = [
    ['Código', 'Conta', 'Débitos do período', 'Créditos do período', 'Saldo do período', 'Acumulado até o período'].map(
      (titulo) => celula(titulo),
    ),
    ...dto.linhas.map((linha) => [
      celula(linha.codigo),
      celula(linha.descricao),
      celula(formatarCentavos(linha.debitos_centavos), 'right'),
      celula(formatarCentavos(linha.creditos_centavos), 'right'),
      celula(formatarCentavos(linha.saldo_periodo_centavos), 'right'),
      celula(formatarCentavos(linha.acumulado_centavos), 'right'),
    ]),
    [
      celula('Totais', 'left', true),
      celula(''),
      celula(formatarCentavos(dto.totais.debitos_centavos), 'right', true),
      celula(formatarCentavos(dto.totais.creditos_centavos), 'right', true),
      celula(''),
      celula(''),
    ],
  ];
  return {
    info: { title: 'Balancete' },
    defaultStyle: { font: 'Helvetica' },
    content: [
      ...cabecalhoPdf(
        contexto,
        'Balancete',
        `${String(dto.periodo.mes).padStart(2, '0')}/${dto.periodo.ano}`,
      ),
      {
        table: {
          headerRows: 1,
          widths: ['9%', '29%', '15%', '15%', '16%', '16%'],
          body: corpo,
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };
}

/** Período do razão: intervalo, um dos lados ou "sem filtro". */
function periodoRazao(dto: RazaoResponse): string {
  if (dto.de && dto.ate) return `De ${formatarDataBR(dto.de)} a ${formatarDataBR(dto.ate)}`;
  if (dto.de) return `A partir de ${formatarDataBR(dto.de)}`;
  if (dto.ate) return `Até ${formatarDataBR(dto.ate)}`;
  return 'Sem filtro de datas';
}

function definicaoRazao(dto: RazaoResponse, contexto: ContextoPdf): DefinicaoDocumento {
  const corpo: TableCell[][] = [
    ['Data', 'Lançamento', 'Histórico', 'Contrapartes', 'Débito', 'Crédito', 'Saldo corrente'].map(
      (titulo) => celula(titulo),
    ),
    ...dto.linhas.map((linha) => [
      celula(formatarDataBR(linha.data)),
      celula(String(linha.lancamento_id)),
      celula(linha.historico),
      celula(contrapartesEmUmaColuna(linha.contrapartes)),
      celula(formatarCentavos(linha.debito_centavos), 'right'),
      celula(formatarCentavos(linha.credito_centavos), 'right'),
      celula(formatarCentavos(linha.saldo_corrente_centavos), 'right'),
    ]),
    [
      celula('Totais', 'left', true),
      celula(''),
      celula(''),
      celula(''),
      celula(formatarCentavos(dto.total_debitos_centavos), 'right', true),
      celula(formatarCentavos(dto.total_creditos_centavos), 'right', true),
      celula(formatarCentavos(dto.saldo_final_centavos), 'right', true),
    ],
  ];
  return {
    info: { title: 'Razão' },
    defaultStyle: { font: 'Helvetica' },
    content: [
      ...cabecalhoPdf(
        contexto,
        `Razão da conta ${dto.conta.codigo} ${dto.conta.descricao}`,
        periodoRazao(dto),
      ),
      {
        table: {
          headerRows: 1,
          widths: ['10%', '9%', '21%', '24%', '9%', '9%', '18%'],
          body: corpo,
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };
}

function definicaoBalanco(dto: BalancoResponse, contexto: ContextoPdf): DefinicaoDocumento {
  const corpo: TableCell[][] = [
    ['Seção', 'Código', 'Conta', 'Valor'].map((titulo) => celula(titulo)),
  ];
  for (const [rotulo, secao] of secoesDoBalanco(dto)) {
    for (const linha of secao.linhas) {
      corpo.push([
        celula(rotulo),
        celula(linha.codigo),
        celula(linha.descricao),
        celula(formatarCentavos(linha.saldo_centavos), 'right'),
      ]);
    }
    corpo.push([
      celula(rotulo, 'left', true),
      celula('Totais', 'left', true),
      celula(''),
      celula(formatarCentavos(secao.total_centavos), 'right', true),
    ]);
  }
  return {
    info: { title: 'Balanço patrimonial' },
    defaultStyle: { font: 'Helvetica' },
    content: [
      ...cabecalhoPdf(contexto, 'Balanço patrimonial', `Em ${formatarDataBR(dto.data)}`),
      {
        table: {
          headerRows: 1,
          widths: ['18%', '12%', '45%', '25%'],
          body: corpo,
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };
}

function definicaoFluxo(dto: FluxoDeCaixaResponse, contexto: ContextoPdf): DefinicaoDocumento {
  const corpo: TableCell[][] = [
    ['Data', 'Entradas realizadas', 'Saídas realizadas', 'Entradas previstas', 'Saídas previstas', 'Saldo'].map(
      (titulo) => celula(titulo),
    ),
    [
      celula('Saldo inicial', 'left', true),
      celula(''),
      celula(''),
      celula(''),
      celula(''),
      celula(formatarCentavos(dto.saldo_inicial_centavos), 'right', true),
    ],
    ...dto.linhas.map((linha) => [
      celula(formatarDataBR(linha.data)),
      celula(formatarCentavos(linha.entradas_realizadas_centavos), 'right'),
      celula(formatarCentavos(linha.saidas_realizadas_centavos), 'right'),
      celula(formatarCentavos(linha.entradas_previstas_centavos), 'right'),
      celula(formatarCentavos(linha.saidas_previstas_centavos), 'right'),
      celula(formatarCentavos(linha.saldo_acumulado_centavos), 'right'),
    ]),
    [
      celula('Totais', 'left', true),
      celula(formatarCentavos(dto.totais.entradas_realizadas_centavos), 'right', true),
      celula(formatarCentavos(dto.totais.saidas_realizadas_centavos), 'right', true),
      celula(formatarCentavos(dto.totais.entradas_previstas_centavos), 'right', true),
      celula(formatarCentavos(dto.totais.saidas_previstas_centavos), 'right', true),
      celula(formatarCentavos(dto.saldo_final_centavos), 'right', true),
    ],
  ];
  return {
    info: { title: 'Fluxo de caixa' },
    defaultStyle: { font: 'Helvetica' },
    content: [
      ...cabecalhoPdf(
        contexto,
        'Fluxo de caixa',
        `De ${formatarDataBR(dto.de)} a ${formatarDataBR(dto.ate)}`,
      ),
      {
        table: {
          headerRows: 1,
          widths: ['16%', '17%', '16%', '17%', '16%', '18%'],
          body: corpo,
        },
        layout: 'lightHorizontalLines',
      },
    ],
  };
}
