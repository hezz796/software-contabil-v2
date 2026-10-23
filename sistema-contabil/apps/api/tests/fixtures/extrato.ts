/**
 * Fixtures de arquivo de extrato para os testes da TASK-018 (CA-53/RF-16).
 *
 * Os bytes são montados aqui porque o transporte da importação é base64 de
 * BYTES BRUTOS (o charset é resolvido pelo parser): o OFX 1.x é gravado em
 * windows-1252 (declara `CHARSET:1252`, como os bancos brasileiros) e o CSV
 * em UTF-8 com BOM — os dois casos de acentuação que a importação precisa
 * decodificar corretamente.
 *
 * Todos os arquivos de extrato válido têm exatamente 3 transações, que é a
 * quantidade do exemplo do CA-53.
 */

/** OFX 1.x (SGML) em windows-1252 com `CHARSET:1252` e acentos reais. */
const OFX_1_SGML = [
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
  '<SIGNONMSGSRSV1>',
  '<SONRS>',
  '<STATUS>',
  '<CODE>0',
  '<SEVERITY>INFO',
  '</STATUS>',
  '<DTSERVER>20260510120000.000[-03:00]',
  '<USERID>cliente',
  '</SONRS>',
  '</SIGNONMSGSRSV1>',
  '<BANKMSGSRSV1>',
  '<STMTTRNRS>',
  '<TRNUID>1',
  '<STMTRS>',
  '<CURDEF>BRL',
  '<BANKACCTFROM>',
  '<BANKID>001',
  '<ACCTID>12345',
  '<ACCTTYPE>CHECKING',
  '</BANKACCTFROM>',
  '<BANKTRANLIST>',
  '<DTSTART>20260501000000.000[-03:00]',
  '<DTEND>20260531000000.000[-03:00]',
  '<STMTTRN>',
  '<TRNTYPE>DEBIT',
  '<DTPOSTED>20260505000000.000[-03:00]',
  '<TRNAMT>-150.75',
  '<FITID>20260505000001',
  '<NAME>PAGAMENTO ENERGIA SP',
  '<MEMO>Conta de luz maio - SP',
  '<STMTTRN>',
  '<TRNTYPE>CREDIT',
  '<DTPOSTED>20260510000000.000[-03:00]',
  '<TRNAMT>2500.00',
  '<FITID>20260510000002',
  '<NAME>RECEBIMENTO CLIENTE',
  '<MEMO>Pix recebido - Empresa ACME',
  '<STMTTRN>',
  '<TRNTYPE>DEBIT',
  '<DTPOSTED>20260515000000.000[-03:00]',
  '<TRNAMT>-99.90',
  '<FITID>20260515000003',
  '<NAME>PAGAMENTO FORNECEDOR',
  '<MEMO>Nota fiscal 123 - São João',
  '</BANKTRANLIST>',
  '<LEDGERBAL>',
  '<BALAMT>10000.00',
  '<DTASOF>20260531000000.000[-03:00]',
  '</LEDGERBAL>',
  '</STMTRS>',
  '</STMTTRNRS>',
  '</BANKMSGSRSV1>',
  '</OFX>',
  '',
].join('\r\n');

/** OFX 2.x (XML bem formado, UTF-8) com as mesmas 3 transações. */
const OFX_2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0</CODE>
<SEVERITY>INFO</SEVERITY>
</STATUS>
<DTSERVER>20260510120000.000[-03:00]</DTSERVER>
<USERID>cliente</USERID>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1</TRNUID>
<STMTRS>
<CURDEF>BRL</CURDEF>
<BANKACCTFROM>
<BANKID>001</BANKID>
<ACCTID>12345</ACCTID>
<ACCTTYPE>CHECKING</ACCTTYPE>
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260501000000.000[-03:00]</DTSTART>
<DTEND>20260531000000.000[-03:00]</DTEND>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260505000000.000[-03:00]</DTPOSTED>
<TRNAMT>-150.75</TRNAMT>
<FITID>20260505000001</FITID>
<NAME>PAGAMENTO ENERGIA SP</NAME>
<MEMO>Conta de luz maio - SP</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260510000000.000[-03:00]</DTPOSTED>
<TRNAMT>2500.00</TRNAMT>
<FITID>20260510000002</FITID>
<NAME>RECEBIMENTO CLIENTE</NAME>
<MEMO>Pix recebido - Empresa ACME</MEMO>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260515000000.000[-03:00]</DTPOSTED>
<TRNAMT>-99.90</TRNAMT>
<FITID>20260515000003</FITID>
<NAME>PAGAMENTO FORNECEDOR</NAME>
<MEMO>Nota fiscal 123 - São João</MEMO>
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>10000.00</BALAMT>
<DTASOF>20260531000000.000[-03:00]</DTASOF>
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

/** OFX 1.x sintático porém SEM nenhuma transação (cabeçalho reconhecido). */
const OFX_1_SEM_TRANSACOES = [
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
  '<DTSTART>20260501000000.000[-03:00]',
  '<DTEND>20260531000000.000[-03:00]',
  '</BANKTRANLIST>',
  '</STMTRS>',
  '</STMTTRNRS>',
  '</BANKMSGSRSV1>',
  '</OFX>',
  '',
].join('\r\n');

/**
 * CSV válido (UTF-8 com BOM, `;`, decimal com vírgula, datas `dd/MM/AAAA`).
 * A 3ª linha traz aspas RFC4180 com `;` e acento dentro do campo.
 */
const CSV_VALIDO_3_ITENS =
  '\uFEFFdata;descricao;valor\r\n' +
  '05/05/2026;Pagamento energia;-150,75\r\n' +
  '10/05/2026;Recebimento cliente;2.500,00\r\n' +
  '15/05/2026;"Nota fiscal 123; São João";-99,90\r\n';

/**
 * CSV malformado: cabeçalho correto, 1ª linha válida e 2ª linha com apenas
 * 2 colunas (o parser recusa o arquivo INTEIRO apontando a linha).
 */
const CSV_MALFORMADO =
  '\uFEFFdata;descricao;valor\r\n' +
  '05/05/2026;Pagamento energia;-150,75\r\n' +
  '06/05/2026;Linha quebrada\r\n';

/** Bytes de texto que não se encaixam em nenhum formato reconhecido. */
const ARQUIVO_NAO_RECONHECIDO = 'ISTO NAO E UM EXTRATO\r\nconteudo qualquer sem formato\r\n';

/** Base64 de um arquivo OFX 1.x (SGML, windows-1252) com 3 transações. */
export function ofx1Base64(): string {
  return Buffer.from(OFX_1_SGML, 'latin1').toString('base64');
}

/** Base64 de um arquivo OFX 2.x (XML, UTF-8) com 3 transações. */
export function ofx2Base64(): string {
  return Buffer.from(OFX_2_XML, 'utf8').toString('base64');
}

/** Base64 de um OFX reconhecido porém sem transações. */
export function ofxSemTransacoesBase64(): string {
  return Buffer.from(OFX_1_SEM_TRANSACOES, 'latin1').toString('base64');
}

/** Base64 de um CSV válido com 3 itens. */
export function csvValidoBase64(): string {
  return Buffer.from(CSV_VALIDO_3_ITENS, 'utf8').toString('base64');
}

/** Base64 de um CSV malformado (linha 3 com 2 colunas). */
export function csvMalformadoBase64(): string {
  return Buffer.from(CSV_MALFORMADO, 'utf8').toString('base64');
}

/** Base64 de um arquivo em formato não reconhecido. */
export function arquivoNaoReconhecidoBase64(): string {
  return Buffer.from(ARQUIVO_NAO_RECONHECIDO, 'utf8').toString('base64');
}
