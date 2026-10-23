# ADR-0009: Bibliotecas de parse OFX/CSV e de geração de PDF (T018/T019)

- **Status:** Aceito (aprovação do coordenador em 2026-10-23 — confirma o pressuposto do ADR-0001 sem nova dependência na T018; `pdfmake` entra como dependência já na T019)
- **Data:** 2026-10-23
- **Responsáveis:** Squad (arquiteto, T018-ARCH)
- **Relacionado:** TASK-018, TASK-019; `docs/requirements/SISTEMA-CONTABIL.md` (RF-16, RF-18, CA-11, CA-53); ADR-0001 (§ Relatórios/exportação e § Importação OFX/CSV); ADR-0006 (formato CSV+PDF)

## Contexto

- A **T018** precisa importar extratos em **OFX (SGML da 1.x e XML da 2.x) e CSV** com validação estrita: arquivo não reconhecido é **recusado com mensagem e nenhum item criado** (CA-53); arquivo de exemplo com 3 itens gera 3 itens conciliáveis (CA-53). A TASK-018 registra como assumption: *"Parser proprio de OFX/CSV com validacao estrita (ADR-0001)"*.
- A **T019** precisa exportar os 4 relatórios em **CSV e PDF** (ADR-0006, CA-11). O formato CSV de exportação já está fechado: **UTF-8 com BOM, separador `;`, decimal com vírgula**; a **lib de PDF ainda não foi escolhida**.
- O **ADR-0001** registrou como pressuposto: *"parser OFX próprio ou lib aberta (`ofx4js`/equivalente), validação estrita"* e, para exportação, *"bibliotecas abertas `csv-stringify` / `pdfkit` ou equivalentes"*.
- Restrições operacionais medidas (ADR-0001, 2026-10-19): npm 11.17 **não executa install scripts** — pacotes que exigem compilação/`postinstall` são risco; Node 24; valores em centavos (ADR-0001); validação de entrada em Zod com mensagens em pt-BR.
- **Método e limitação:** o Context7 **não estava disponível** nesta sessão; a pesquisa usou `webfetch` contra o registry npm (metadados e datas oficiais), o **código-fonte** de uma candidata no GitHub e as documentações oficiais. As datas abaixo são as datas de publicação reportadas pelo próprio registry. Nenhum `npm install` foi executado (restrição da tarefa) — nenhum pacote foi rodado; as observações sobre comportamento vêm da leitura de fonte/documentação.

## Opções consideradas

### Frente 1 — parse de extrato (OFX/CSV) para a T018

#### Opção A — Parser próprio (pressuposto do ADR-0001)

- Benefícios:
  - A exigência que pesa (CA-53) é atendida por desenho: rejeição *fail-fast* (sem `<OFX>`/cabeçalho esperado ⇒ erro imediato), validação Zod da estrutura e gravação transacional — tudo sob nosso controle e sob teste com fixtures.
  - Decodificação/normalização que os bancos brasileiros exigem (BOM, CRLF, acentuação, janela de charset `windows-1252` declarada no header `ENCODING`/`CHARSET` do OFX, decimal com vírgula no CSV) é nossa — nenhuma das candidatas a seguir resolve isso (ver evidência abaixo).
  - **Zero dependências novas** no caminho de importação: a restrição de install scripts fica trivialmente satisfeita; sem risco de fornecedor/abandono.
  - O subconjunto OFX necessário é pequeno e conhecido: header + `BANKMSGSRSV1/STMTTRNRS/STMTRS` + `STMTTRN` (data, valor, descrição, FITID) + `LEDGERBAL`.
- Custos e riscos:
  - Implementar a conversão SGML→XML da OFX 1.x e um parser XML estrito para a 2.x (estimativa ~200–300 LOC + fixtures) — é o principal custo e o motivo de as opções B/C existirem.
  - Variantes de bancos não previstas virão como retrabalho (RK-7: formatos extras são evolução futura, fora do MVP).

#### Opção B — `ofx-js@1.1.2` (+ camada de validação própria)

Evidências (registry npm e fonte `ofx.ts` no GitHub, consultados em 2026-10-23):

- Ativa: v1.1.2 publicada em **2026-09-30** (antes: 2026-05-13, 2026-05-20); **MIT**; **sem dependências de runtime** desde a 1.0.0; ESM com tipos embutidos (`types: ./ofx.d.ts`); ~63 KB; ~140 mil downloads/mês. Trata SGML 1.x (regex de conversão) e XML 2.x (parser estrito com validação de tag de fechamento, com *fallback* para SGML).
- **Limitações verificadas na fonte** (`ofx.ts`, branch master):
  - `parseStrict` **não é estrito**: o próprio código diz *"not any more strict than the normal parseOFX, but the TypeScript types … are much more strict"* — ele é um *cast* de tipo.
  - Arquivo **sem `<OFX>` ainda vira objeto** (o `split` gera `'<OFX>'+undefined` e o *fallback* SGML fecha a tag) — ou seja, **não rejeita lixo**.
  - **Não trata encoding**: recebe string já decodificada; BOM/charset/carga de acentuação ficam do nosso lado.
- Benefícios: tokenizador SGML/XML com histórico de correções; economia de ~150–250 LOC; ativa e sem deps nativas.
- Custos e riscos: a camada que garante CA-53 (sniff + Zod + transação) e o decoding **seriam nossos do mesmo jeito** — a lib só compra o tokenizador; mantenedor único; o nome `parseStrict` é uma armadilha para quem confiar nele sem a camada própria.

#### Opção C — demais libs do registry (todas descartadas com evidência)

| Lib | Última versão / data (registry) | Evidência de descarte |
|---|---|---|
| `ofx` (= node-ofx) | 0.5.0 / 2020-02-13 | Dependência `xml2json@^0.12.0` → **`node-expat@^2.3.18`, módulo nativo compilado no install** (node-gyp) — incompatível com a restrição npm 11.17. README admite leniência: *"It may or may not work for your own use"* |
| `ofx4js` | 2.1.0 / 2019-02-26 | Parada desde 2019; README: *"Good enough to get started, but expect bugs"*; port Java com java-isms; licença mista MIT/Apache-2.0 nos arquivos portados |
| `node-ofx-parser` | 0.5.1 / 2021-03-01 | Fork do `ofx`, parado desde 2021; depende de `fast-xml-parser@^3` (linha antiga) |
| `ofx-data-extractor` | 1.5.0 / 2026-03-24 | Ativa, MIT e sem deps, porém nicho (~3 mil downloads/semana), dist **minificado** (auditoria difícil) e mantenedor único — sem vantagem sobre `ofx-js` |

#### Sub-decisão CSV de importação — tokenizer próprio vs `csv-parse`

- Nenhuma lib remove a validação de layout que CA-53 exige (linhas de preâmbulo, separador `;`, decimal com vírgula, datas `dd/MM/yyyy`, colunas por banco) — isso é Zod, nosso.
- Tokenizar CSV (aspas, delimitador embutido, CRLF, BOM) é ~40 LOC totalmente cobertos por fixtures.
- `csv-parse@7.0.3` (2026-09-25, MIT, **zero deps**, tipos embutidos, provenance SLSA, estrito por padrão — erro em contagem de colunas divergente) é o substituto pré-vetado caso os fixtures revelem complexidade maior.

### Frente 2 — geração de PDF (T019)

| Candidata | Versão / data (registry) | Manutenção | Layout tabular | Tipos | Licença | Tamanho | Veredito |
|---|---|---|---|---|---|---|---|
| **`pdfmake`** | 0.3.12 / **2026-10-17** | Muito ativa (~1,6 mi downloads/semana; publicação via GitHub Actions/OIDC) | **Declarativo e de primeira classe**: `table` com `widths`, `headerRows` (cabeçalho repetido a cada página), alinhamentos, `pageBreak`; funções `header`/`footer` por página | `@types/pdfmake@0.3.3` (2026-05-16, DefinitelyTyped) | MIT | 12,0 MB | **Escolhida** |
| `pdfkit` | 0.20.2 / 2026-08-30 | Ativa (~6,6 mi downloads/semana) | Baixo nível: tabelas e paginação montadas à mão (doc.text em coordenadas) | `@types/pdfkit@0.17.7` (2026-10-22) | MIT | 10,5 MB | Alternativa de baixo atrito |
| `pdf-lib` | 1.17.1 / 2021-11-06 | **Parada há ~5 anos** | Sem tabelas nem quebra de linha automática; tudo à mão | Embutidos | MIT | 19,5 MB / 1647 arquivos | Descartada |
| Puppeteer / `@react-pdf/renderer` | — | — | — | — | — | navegador / React dentro da API | Fora do critério server-side (reasoning arquitetural, sem consulta de registry) |

- `pdfmake` roda **sobre `pdfkit`** (dependência direta `pdfkit@^0.20.2`), portanto satisfaz literalmente o *"pdfkit ou equivalentes"* do ADR-0001/ADR-0006, e é server-side puro (Node `PdfPrinter`, sem browser).
- A dependência de runtime de `pdfmake` é `pdfkit` + `xmldoc` + `linebreak` — todas JS puro, **nenhuma com install script**.

## Decisão

1. **Parse OFX/CSV (T018): pressuposto do ADR-0001 CONFIRMADO COM EVIDÊNCIA — parser próprio** para OFX (1.x SGML e 2.x XML) e CSV, com pipeline fixo:
   **sniff/reconhecimento → parse → validação estrita Zod (estrutura, campos, datas, valores) → normalização para centavos → inserção transacional única**;
   falha em qualquer etapa ⇒ recusa com mensagem em pt-BR e **ZERO itens** (CA-53). Decodificação (remoção de BOM, CRLF, UTF-8 com fallback `windows-1252` conforme header OFX) é responsabilidade nossa.
2. **Substitutos pré-vetados registrados (gatilho de fallback, sem mudança de desenho):** se os fixtures da T018 revelarem SGML/XML além do estimado, adota-se `ofx-js@1.1.2` (tokenização OFX) e/ou `csv-parse@7.0.3` (CSV) — ambos MIT, sem deps nativas e ativos em 2026 — mantendo **inalterada** a camada Zod/CA-53. `ofx4js`, citado no ADR-0001, fica **substituído** por `ofx-js` como lib de referência (evidência de abandono acima).
3. **Exportação CSV (T019): `csv-stringify@6.9.0`** (2026-09-25, MIT, sem deps, tipos embutidos) — **confirmação** das libs já nomeadas no ADR-0001/ADR-0006. Atende o formato do ADR-0006: `bom: true` (UTF-8+BOM, desde v5.4.0), `delimiter: ';'`; **decimal com vírgula é formatação nossa** sobre os centavos na camada de apresentação (a lib só faz quoting/escaping). Bônus de segurança: `escape_formulas: true` (defesa contra CSV injection).
4. **Exportação PDF (T019): `pdfmake@0.3.12` + `@types/pdfmake`** — o *"equivalente"* do pdfkit nomeado no ADR-0001/ADR-0006, escolhido porque o layout tabular declarativo (`headerRows`, larguras, alinhamentos) e o `header`/`footer` por página atendem diretamente o cabeçalho **empresa + período + data/hora de emissão** exigido pelo ADR-0006 nos 4 relatórios, com menos código de paginação do que o `pdfkit` puro. **A lib de PDF não tem relação com o CSV** — a exportação CSV segue com `csv-stringify` e não depende desta escolha.

## Como a escolha atende o CA-53

CA-53 exige: exemplo com 3 itens ⇒ 3 itens conciliáveis; formato não reconhecido ⇒ recusa com mensagem e **nenhum** item. Na decisão acima, isso é garantido por quatro pontos sob nosso controle, e **não** por nenhuma lib:

1. **Reconhecimento antes de qualquer escrita** — ausência de header OFX (`OFXHEADER`/`<OFX>`) ou de cabeçalho CSV esperado rejeita na primeira etapa;
2. **Validação estrita em Zod** — estrutura completa obrigatória (transações presentes, campos não vazios, datas válidas, valores convertíveis para centavos); a leitura da fonte do `ofx-js` prova que nenhuma candidata faz isso por nós (`parseStrict` só tipa; lixo sem `<OFX>` vira objeto);
3. **Transação única** — parse e validação concluídos antes do INSERT; qualquer falha ⇒ rollback/ausência de escrita (zero itens, nem "meio item" — o wireframe `conciliacao.html` é explícito nisso);
4. **Mensagem de recusa em pt-BR** com orientação, no padrão do codebase.

A evidência portanto **não vence** o pressuposto em favor de uma lib: nenhuma lib candidata entregava a validação estrita que é o critério de peso — a exigência é atendida pela camada que vamos escrever de qualquer forma, e o parser próprio a torna *fail-fast* natural.

## Impacto nos pressupostos e decisões anteriores

- **ADR-0001:** pressuposto **confirmado com evidência** (parser próprio). A alternativa *"lib aberta (ofx4js/equivalente)"* permanece registrada nesta ADR como fallback documentado, com `ofx4js` substituído por `ofx-js` por evidência de abandono. O custo assumido no ADR-0001 (*"parser OFX é trabalho próprio"*) segue válido.
- **ADR-0006:** formato de exportação **inalterado** (UTF-8+BOM, `;`, decimal com vírgula). O gerador CSV é `csv-stringify`, que implementa BOM e separador nativamente; o decimal continua sendo formatação de centavos na camada de apresentação, sem divergência de arredondamento entre tela, CSV e PDF. A escolha de PDF não afeta o CSV.
- **TASK-018 (assumptions):** confirmada como está — parser próprio de OFX/CSV com validação estrita.
- **TASK-019 (scope):** a menção *"csv-stringify/pdfkit ou equivalentes"* é atendida — `csv-stringify` confirmado; `pdfkit` concretizado como `pdfmake` (equivalente construído sobre pdfkit).

## Consequências

- Impactos positivos: caminho de importação sem dependências externas; única dependência nova do projeto é o par `pdfmake` + `@types/pdfmake` (PDF) já previsto orçamentariamente no ADR-0001; decisões de substituição já pré-vetadas evitam reabrir esta ADR no meio da T018.
- Custos ou limitações: a squad mantém o parser OFX (~200–300 LOC + fixtures de SGML/XML); `pdfmake` exige aprender o DSL `docDefinition` (curva pequena, bem documentado).
- Riscos e mitigação:
  - Variantes de OFX de bancos reais fora das fixtures ⇒ fixtures do CA-53 primeiro (arquivo válido 3 itens + arquivo inválido com causa específica) e fallback `ofx-js` documentado; formatos extras continuam sendo RK-7 (futuro).
  - `pdfmake` mantido por mantenedor principal +3 ⇒ risco de abandono baixo e substituição por `pdfkit` (sua base) é de baixo atrito; ambas são JS puro, sem install script (compatível com npm 11.17).
  - Acentuação pt-BR nas fontes padrão (Helvetica/WinAnsi) é compatível em tese, mas **precisa de teste** que confira textos esperados no PDF.
  - **Verificação do PDF no CA-11** (conferência de valores no arquivo) depende de estratégia de extração de texto (ex.: gerar com compressão desligada ou usar `pdfjs-dist` para leitura) — decidir na T019; não bloqueia esta escolha, pois ambas as candidatas repousam sobre `pdfkit`.
- Efeitos sobre implementação e operação: `npm install` passa a incluir `csv-stringify` (T019), `pdfmake` e `@types/pdfmake` (T019); nenhum pacote com binário/postinstall; esta ADR não altera nenhum arquivo de código.

## Validação

- Pendências: (1) aprovação do coordenador desta recomendação; (2) T018: provar o pipeline com fixtures (CA-53) — se o parser próprio não cobrir alguma variante, aciona-se o fallback com registro na tarefa; (3) T019: definir estratégia de conferência do PDF no CA-11.
- **Fontes consultadas em 2026-10-23** (Context7 indisponível na sessão; via `webfetch`):
  - Registry npm: `https://registry.npmjs.org/ofx`, `/ofx4js`, `/node-ofx-parser`, `/ofx-js`, `/ofx-data-extractor`, `/xml2json` e `/xml2json/0.12.0`, `/node-expat` (confirma `gypfile: true` e script `install: node-gyp rebuild`), `/pdfkit`, `/pdfmake`, `/xmldoc`, `/linebreak` (deps de runtime de `pdfmake`, sem script de instalação), `/pdf-lib`, `/csv-stringify`, `/csv-parse`, `/@types/pdfkit`, `/@types/pdfmake`, busca `https://registry.npmjs.org/-/v1/search?text=ofx%20parse`, `...?text=pdfmake`, `...?text=pdfkit`, `...?text=csv-stringify` (datas de publicação e dependências).
  - Código-fonte: `https://raw.githubusercontent.com/bradenmacdonald/ofx-js/master/ofx.ts` (comportamento de `parseStrict`, fallback SGML e ausência de encoding).
  - Documentação oficial: `https://csv.js.org/stringify/options/` (opções `bom`, `delimiter`, `escape_formulas`), `https://csv.js.org/parse/options/relax_column_count/` (por padrão csv-parse lança erro em contagem de campos divergente), `https://pdfmake.org/`, `http://pdfkit.org/`, `https://pdf-lib.js.org/`, `https://csv.js.org/parse/`.
  - Requisitos e decisões do projeto: `docs/requirements/SISTEMA-CONTABIL.md` (RF-16, RF-18, CA-11, CA-53), `docs/decisions/ADR-0001-*.md`, `docs/decisions/ADR-0006-formato-exportacao-h9.md`, `.squad/tasks/TASK-018.json`, `.squad/tasks/TASK-019.json`.

## Histórico

- 2026-10-23: decisão criada (tarefa T018-ARCH) — pressuposto do ADR-0001 confirmado com evidência; lib de PDF escolhida (`pdfmake`).
