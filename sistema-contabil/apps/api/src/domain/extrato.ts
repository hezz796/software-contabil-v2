import { ErroAplicacao } from '../errors.ts';

/**
 * Parser próprio de extrato bancário OFX 1.x (SGML), OFX 2.x (XML) e CSV
 * (RF-16/F10, CA-53; TASK-018), sem dependência externa (ADR-0009).
 *
 * Contrato de recusa (pt-BR, sem vazar detalhe interno):
 * - `arquivo_nao_reconhecido` (400): nenhum formato reconhecido no sniff;
 * - `arquivo_sem_transacoes` (400): formato reconhecido, zero `<STMTTRN>`
 *   (OFX) ou zero linhas de dados (CSV);
 * - `arquivo_invalido` (400): linha/transação específica inválida — o
 *   arquivo INTEIRO é recusado (nunca importação parcial), apontando a
 *   linha do CSV ou o campo do OFX;
 * - `arquivo_grande_demais` (400): acima de 10.000 transações por arquivo
 *   (FIX-T018-R2) — o chamador audita a recusa fora da transação.
 *
 * Mensagens: o valor cru do arquivo NUNCA vai inteiro para a resposta
 * (`resumirValor` trunca com reticências, mantendo linha/transação e campo);
 * campo acima do teto é RECUSADO, não truncado (CA-53: validação estrita).
 *
 * Charset: os bytes chegam brutos; o OFX declara `CHARSET:`/`ENCODING:`
 * (1.x) ou `encoding=` (2.x) e o CSV é UTF-8 (BOM aceito). UTF-8 é
 * decodificado com `fatal` e, ao falhar, cai para windows-1252 via
 * `TextDecoder` (sem ICU no sistema — ADR-0009).
 */

export type FormatoExtrato = 'ofx' | 'csv';

/** Transação normalizada do extrato: data `AAAA-MM-DD` real, centavos com sinal. */
export interface TransacaoExtrato {
  data: string;
  descricao: string;
  /** Centavos com sinal: + entrada, − saída. */
  valorCentavos: number;
  /** FITID do banco (OFX); `null` no CSV (que não tem coluna de id). */
  identificador: string | null;
}

export interface ExtratoParseado {
  formato: FormatoExtrato;
  transacoes: TransacaoExtrato[];
}

/* -------------------------------------------------------------------------- */
/* Tetos de importação (FIX-T018-R2)                                           */
/* -------------------------------------------------------------------------- */

/**
 * Teto de transações por importação: extrato maior que isso é dividido e
 * importado em partes. A recusa acontece NO parser, antes de qualquer
 * transação de gravação — a camada de serviço audita `importacao.recusada`
 * com motivo `arquivo_grande_demais` fora da transação (nenhum item órfão).
 */
const MAXIMO_TRANSACOES_POR_IMPORTACAO = 10_000;

/**
 * Tetos de CAMPO por transação importada, derivados do DTO que já limita o
 * lançamento MANUAL (`criarItemExtratoRequestSchema`):
 * - `descricao` ≤ 500: o MESMO teto do caminho manual — antes a assimetria
 *   (manual limitado, importação sem teto) permitia contornar o limite pela
 *   importação;
 * - `identificador` ≤ 120: FITID é id opaco curto (os bancos usam 14..30);
 *   120 é o único teto de valor curto já existente no DTO (nome da conta
 *   bancária), e não há teto de FITID no DTO de resposta.
 *
 * RECUSA em vez de TRUNCAMENTO: reescrever o valor do banco em silêncio seria
 * importar "meio item" alterado (CA-53/ADR-0009: validação estrita). O DTO de
 * RESPOSTA (`itemExtratoSchema`) segue sem `max` de propósito: ele nunca pode
 * falhar por validação sobre dado já gravado — os tetos valem na ENTRADA.
 */
const MAX_DESCRICAO_CARACTERES = 500;
const MAX_IDENTIFICADOR_CARACTERES = 120;

/* -------------------------------------------------------------------------- */
/* Charset e datas                                                             */
/* -------------------------------------------------------------------------- */

const DECODIFIERS: Record<string, string> = {
  'utf-8': 'utf-8',
  utf8: 'utf-8',
  usascii: 'utf-8',
  ascii: 'utf-8',
  '1252': 'windows-1252',
  cp1252: 'windows-1252',
  'windows-1252': 'windows-1252',
  'iso-8859-1': 'windows-1252',
  latin1: 'windows-1252',
};

/**
 * Decodifica os bytes conforme o charset declarado (ou UTF-8 por padrão);
 * UTF-8 inválido (bytes 1252) cai para windows-1252 — os bancos brasileiros
 * gravam OFX 1.x assim.
 */
function decodificar(bytes: Uint8Array, charsetDeclarado: string | null): string {
  const rotulo = DECODIFIERS[(charsetDeclarado ?? 'utf-8').toLowerCase()] ?? 'utf-8';
  try {
    return new TextDecoder(rotulo, { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Valida data civil REAL (mês 1-12, dia no mês com bissexto). */
function ehDataReal(ano: number, mes: number, dia: number): boolean {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return false;
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const diasNoMes = [31, (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return dia <= diasNoMes[mes - 1]!;
}

/** Converte `dd/MM/AAAA`, `AAAA-MM-DD` ou `AAAAMMDD` (OFX) em `AAAA-MM-DD`; `null` se inválida. */
export function normalizarData(texto: string): string | null {
  const limpo = texto.trim();
  let casamento = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpo);
  if (casamento) {
    const [, dia, mes, ano] = casamento;
    return ehDataReal(Number(ano), Number(mes), Number(dia))
      ? `${ano}-${mes}-${dia}`
      : null;
  }
  casamento = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpo);
  if (casamento) {
    const [, ano, mes, dia] = casamento;
    return ehDataReal(Number(ano), Number(mes), Number(dia)) ? limpo : null;
  }
  casamento = /^(\d{4})(\d{2})(\d{2})$/.exec(limpo);
  if (casamento) {
    const [, ano, mes, dia] = casamento;
    return ehDataReal(Number(ano), Number(mes), Number(dia))
      ? `${ano}-${mes}-${dia}`
      : null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Valores monetários                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Converte valor monetário em centavos ASSINADOS (CA-53): aceita `−150.75`
 * (OFX/CSV com ponto), `−150,75` e `1.234,56` (milhar com vírgula decimal,
 * CSV brasileiro). 1 ou 2 decimais; mais que isso é inválido (extrato não
 * tem fração de centavo).
 */
export function paraCentavos(texto: string): number | null {
  let limpo = texto.trim().replace(/\s/g, '');
  let sinal = 1;
  if (limpo.startsWith('-')) {
    sinal = -1;
    limpo = limpo.slice(1);
  } else if (limpo.startsWith('+')) {
    limpo = limpo.slice(1);
  }
  // vírgula decimal (brasileiro): remove milhar com ponto e vira decimal
  if (limpo.includes(',')) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(limpo)) return null;
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  } else if (!/^\d+(\.\d{1,2})?$/.test(limpo)) {
    return null;
  }
  const [inteiro, decimal = ''] = limpo.split('.');
  const centavos = Number(inteiro) * 100 + Number((decimal + '00').slice(0, 2));
  if (!Number.isSafeInteger(centavos)) return null;
  return sinal * centavos;
}

/* -------------------------------------------------------------------------- */
/* OFX                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Valor cru vindo do ARQUIVO, truncado para a mensagem de recusa: a resposta
 * aponta a linha/transação e o campo, mas nunca reflete o conteúdo inteiro
 * (o arquivo pode ter megabytes; a mensagem vai para a tela do contador).
 * 80 chars bastam para reconhecer o valor sem reproduzi-lo.
 */
function resumirValor(valor: string, limite = 80): string {
  return valor.length > limite ? `${valor.slice(0, limite)}…` : valor;
}

function erroArquivoInvalido(detalhe: string): never {
  // O valor cru já vem truncado por `resumirValor` nos pontos que interpolam
  // campo do arquivo; o teto do DETALHE inteiro cobre qualquer chamador que
  // esqueça (200 = folga: a mensagem mais longa com valor de 80 tem ~146).
  throw new ErroAplicacao(
    400,
    `Arquivo de extrato inválido: ${resumirValor(detalhe, 200)}.`,
    'arquivo_invalido',
  );
}

/** Lê um campo do bloco `<TAG>valor` (SGML sem fecho, XML com fecho). */
function campo(bloco: string, nome: string): string | null {
  const casamento = new RegExp(`<${nome}>([^<]*)`, 'i').exec(bloco);
  const valor = casamento?.[1]?.trim();
  return valor ? valor : null;
}

/** Charset declarado no cabeçalho OFX (`CHARSET:1252`, `ENCODING:`, XML `encoding=`). */
function charsetOfx(texto: string): string | null {
  const casamento =
    /CHARSET:(\S+)/i.exec(texto) ??
    /ENCODING:(\S+)/i.exec(texto) ??
    /encoding=["']([^"']+)["']/i.exec(texto);
  return casamento?.[1]?.trim() ?? null;
}

function parsearOfx(bytes: Uint8Array): TransacaoExtrato[] {
  // O sniff usa a cabeça em latin1 (ASCII é idêntico); o charset real é o
  // declarado no cabeçalho, lido também em latin1 para achar a tag.
  const cabecalho = decodificar(bytes.subarray(0, 1024), 'windows-1252');
  const texto = decodificar(bytes, charsetOfx(cabecalho));

  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  if (blocos.length === 0) {
    throw new ErroAplicacao(
      400,
      'O arquivo de extrato não contém transações para importar.',
      'arquivo_sem_transacoes',
    );
  }

  return blocos.map((bloco, indice) => {
    const dtPosted = campo(bloco, 'DTPOSTED');
    if (!dtPosted) erroArquivoInvalido(`transação ${indice + 1} sem DTPOSTED (data)`);
    // DTPOSTED: os 8 primeiros dígitos são a data de lançamento (AAAAAMMDD)
    const data = normalizarData(dtPosted.slice(0, 8));
    if (!data) {
      erroArquivoInvalido(
        `transação ${indice + 1} com DTPOSTED inválido (${resumirValor(dtPosted)})`,
      );
    }

    const trnAmt = campo(bloco, 'TRNAMT');
    if (!trnAmt) erroArquivoInvalido(`transação ${indice + 1} sem TRNAMT (valor)`);
    const valorCentavos = paraCentavos(trnAmt);
    if (valorCentavos === null || valorCentavos === 0) {
      erroArquivoInvalido(
        `transação ${indice + 1} com TRNAMT inválido (${resumirValor(trnAmt)})`,
      );
    }

    const descricao =
      campo(bloco, 'MEMO') ??
      campo(bloco, 'DESC') ??
      campo(bloco, 'NAME') ??
      '(sem descrição)';
    const identificador = campo(bloco, 'FITID');

    // Tetos de campo na ENTRADA: recusa o arquivo inteiro (CA-53), nunca
    // reescreve o valor do banco — ver justificativa em MAX_* no topo.
    if (descricao.length > MAX_DESCRICAO_CARACTERES) {
      erroArquivoInvalido(
        `transação ${indice + 1} com descrição com ${descricao.length} caracteres (máximo ${MAX_DESCRICAO_CARACTERES})`,
      );
    }
    if (identificador && identificador.length > MAX_IDENTIFICADOR_CARACTERES) {
      erroArquivoInvalido(
        `transação ${indice + 1} com identificador com ${identificador.length} caracteres (máximo ${MAX_IDENTIFICADOR_CARACTERES})`,
      );
    }

    return {
      data,
      descricao,
      valorCentavos,
      identificador,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

const CABECALHO_CSV = ['data', 'descricao', 'valor'];

/** Divide o CSV em linhas de campos, com aspas RFC4180 (`""`, `;` e quebras dentro). */
function linhasCsv(texto: string): Array<{ campos: string[]; linha: number }> {
  const resultado: Array<{ campos: string[]; linha: number }> = [];
  let campos: string[] = [];
  let campoAtual = '';
  let entreAspas = false;
  let linha = 1;
  let linhaDoCampo = 1;
  let iniciouLinha = false;

  const fecharCampo = (): void => {
    campos.push(campoAtual);
    campoAtual = '';
  };
  const fecharLinha = (): void => {
    fecharCampo();
    resultado.push({ campos, linha: linhaDoCampo });
    campos = [];
    iniciouLinha = false;
  };

  for (let i = 0; i < texto.length; i += 1) {
    const caractere = texto[i]!;
    if (entreAspas) {
      if (caractere === '"') {
        if (texto[i + 1] === '"') {
          campoAtual += '"';
          i += 1;
        } else {
          entreAspas = false;
        }
      } else {
        if (caractere === '\n') linha += 1;
        campoAtual += caractere;
      }
      continue;
    }
    if (caractere === '"' && campoAtual.trim() === '') {
      entreAspas = true;
      campoAtual = '';
      iniciouLinha = true;
      continue;
    }
    if (caractere === ';') {
      fecharCampo();
      iniciouLinha = true;
      continue;
    }
    if (caractere === '\r') continue;
    if (caractere === '\n') {
      if (iniciouLinha || campoAtual.trim() !== '') fecharLinha();
      linha += 1;
      linhaDoCampo = linha;
      continue;
    }
    if (!iniciouLinha && campoAtual === '' && caractere.trim() === '') continue; // espaços antes do conteúdo
    campoAtual += caractere;
    iniciouLinha = true;
  }
  if (iniciouLinha || campoAtual.trim() !== '') fecharLinha();
  return resultado;
}

function parsearCsv(bytes: Uint8Array): TransacaoExtrato[] {
  // BOM do UTF-8 é removido antes de comparar o cabeçalho
  const texto = decodificar(bytes, 'utf-8').replace(/^﻿/, '');
  const linhas = linhasCsv(texto);
  const primeira = linhas.find((l) => l.campos.some((campo) => campo.trim() !== ''));
  if (!primeira || primeira.campos.map((c) => c.trim().toLowerCase()).join(';') !== CABECALHO_CSV.join(';')) {
    throw new ErroAplicacao(
      400,
      'Arquivo não reconhecido como extrato: esperado OFX ou CSV com cabeçalho "data;descricao;valor".',
      'arquivo_nao_reconhecido',
    );
  }

  const transacoes: TransacaoExtrato[] = [];
  for (const registro of linhas) {
    if (registro === primeira) continue;
    if (registro.campos.every((campo) => campo.trim() === '')) continue;
    if (registro.campos.length !== 3) {
      erroArquivoInvalido(
        `linha ${registro.linha} com ${registro.campos.length} colunas (esperado 3: data;descricao;valor)`,
      );
    }
    const [dataBruta, descricaoBruta, valorBruto] = registro.campos;
    const data = normalizarData(dataBruta!.trim());
    if (!data) {
      erroArquivoInvalido(
        `linha ${registro.linha} com data inválida (${resumirValor(dataBruta!.trim())}); ` +
          'use dd/MM/AAAA ou AAAA-MM-DD',
      );
    }
    const descricao = descricaoBruta!.trim();
    if (!descricao) erroArquivoInvalido(`linha ${registro.linha} sem descrição`);
    // O CSV não tem coluna de id (identificador fica `null`): o teto de 120 só
    // se aplica ao FITID do OFX. Campo acima do teto ⇒ recusa do arquivo INTEIRO
    // apontando a linha (CA-53 validação estrita; nunca truncar o dado).
    if (descricao.length > MAX_DESCRICAO_CARACTERES) {
      erroArquivoInvalido(
        `linha ${registro.linha} com descrição com ${descricao.length} caracteres (máximo ${MAX_DESCRICAO_CARACTERES})`,
      );
    }
    const valorCentavos = paraCentavos(valorBruto!);
    if (valorCentavos === null || valorCentavos === 0) {
      erroArquivoInvalido(
        `linha ${registro.linha} com valor inválido (${resumirValor(valorBruto!.trim())})`,
      );
    }
    transacoes.push({ data, descricao, valorCentavos, identificador: null });
  }

  if (transacoes.length === 0) {
    throw new ErroAplicacao(
      400,
      'O arquivo de extrato não contém transações para importar.',
      'arquivo_sem_transacoes',
    );
  }
  return transacoes;
}

/* -------------------------------------------------------------------------- */
/* Entrada                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Teto de transações por importação (FIX-T018-R2): recusa ACIMA de 10.000 com
 * mensagem orientando a dividir o extrato. Aplicado aqui, na função que
 * DEVOLVE o parse — ainda ANTES de a transação de gravação começar; o serviço
 * audita `importacao.recusada` com motivo `arquivo_grande_demais` fora da
 * transação (mesmo shape das demais recusas de importação).
 */
function comTetoDeTransacoes(parse: ExtratoParseado): ExtratoParseado {
  if (parse.transacoes.length <= MAXIMO_TRANSACOES_POR_IMPORTACAO) return parse;
  throw new ErroAplicacao(
    400,
    'Arquivo de extrato grande demais: mais de 10.000 transações em um único arquivo. ' +
      'Divida o extrato em partes menores e importe cada uma.',
    'arquivo_grande_demais',
  );
}

/**
 * Reconhece e parseia os bytes de um extrato (OFX 1.x/2.x ou CSV).
 *
 * O sniff lê a cabeça em latin1: `OFXHEADER:`/`<OFX>` identifica OFX; caso
 * contrário tenta CSV pelo cabeçalho; nada reconhecido → recusa pt-BR.
 */
export function parsearExtrato(bytes: Uint8Array): ExtratoParseado {
  const cabecalho = decodificar(bytes.subarray(0, 1024), 'windows-1252');
  if (/OFXHEADER:/i.test(cabecalho) || /<OFX>/i.test(cabecalho)) {
    return comTetoDeTransacoes({ formato: 'ofx', transacoes: parsearOfx(bytes) });
  }
  // CSV: cabeçalho é a 1ª linha não-vazia; se não casar, não é formato
  // reconhecido (a recusa cobre os dois formatos com a MESMA mensagem).
  // Erro de aplicação do parser (inválido/sem transações/teto) é propagado.
  try {
    return comTetoDeTransacoes({ formato: 'csv', transacoes: parsearCsv(bytes) });
  } catch (erro) {
    if (erro instanceof ErroAplicacao) throw erro;
    throw new ErroAplicacao(
      400,
      'Arquivo não reconhecido como extrato: esperado OFX ou CSV com cabeçalho "data;descricao;valor".',
      'arquivo_nao_reconhecido',
    );
  }
}
