# ESTILO — direção visual do Sistema Contábil (fase de estilo da T020)

- **Documento:** `docs/design/ESTILO.md`
- **Tarefa:** T020 / TASK-020 — incremento "fase de estilo" (owner: product-analyst)
- **Data:** 2026-10-21
- **Status:** **rascunho para aprovação humana** — o critério de aceite da T020 exige `aprovacao humana do estilo registrada` antes de a tarefa ser dada por concluída (`.squad/tasks/TASK-020.json` → `acceptance_criteria`).
- **Fontes (rastreabilidade):** `docs/design/UIUX-DIRETRIZES.md` (T023, aprovado) · `docs/design/wireframes/` (11 telas aprovadas em 2026-10-20) · `docs/decisions/ADR-0004-decisoes-interface-q-ui.md` · `docs/plans/PLAN-IMPLEMENTACAO.md` (T020) · `docs/requirements/SISTEMA-CONTABIL.md` (R12, H1, CE-01..CE-22, matriz de papéis) · `docs/decisions/ADR-0003-implantacao-web-vps-sqlite.md` (deploy em VPS).
- **Companion:** `docs/design/UIUX-DIRETRIZES.md` define **forma** (arquitetura de informação, padrões, feedback). Este documento define **estilo** (cor, tipografia, estados, tokens). A forma aprovada **não muda** aqui (ADR-0004: *"A estrutura aprovada agora não muda; cores e tipografia vêm por cima"*).

> **Nota de escopo:** este é um documento de design. Ele **não altera nenhum arquivo de código** (`sistema-contabil/**` intocado neste incremento), não cria funcionalidade (guarda `RK-1`) e não escolhe stack — a aplicação prática acontece na implementação da T020, e a validação de contraste em navegador acontece na verificação (T021).

---

## 1. Problema e resultado esperado

**Problema:** os wireframes aprovados são **baixa fidelidade em cinza de propósito** (fase de forma). O produto **não é preto e branco** — ressalva explícita da aprovação humana de 2026-10-20 registrada no ADR-0004 ("*(1) Eu aprovo com ressalvas (será preto e branco?)*" → "**Decisão: não**"). Sem uma direção visual documentada, a implementação da T020 improvisaria cor e tipografia no código, gerando retrabalho difícil de reverter e inconsistência entre as 11 telas.

**Resultado esperado:** um documento autocontido com **paleta, tipografia, estados e tokens prontos para CSS variables**, que a squad aplica ao `apps/web` e que o usuário aprova (ou ajusta) **antes** de a T020 ser encerrada.

**Usuários/fluxos afetados:** os 2 papéis (administrador, contador) e os 7 fluxos já mapeados na T023 — nenhuma alteração de requisito, de regra de negócio ou de estrutura de tela.

---

## 2. Princípios (derivados de `UIUX-DIRETRIZES`)

| # | Princípio | Origem | O que isso impõe no estilo |
|---|---|---|---|
| **P1** | **Denso no dado, calmo na forma** | UIUX §2.2 | Cor e contraste trabalham para a **leitura de números** (tabelas respiram em dados, não em enfeite). Sem gradientes, sombras pesadas ou ilustrações decorativas em tela de dado. Formulários ganham respiro; grids ganham contraste sutil entre linhas. |
| **P2** | **Desktop-first ≥ 1280px** | R12 + UIUX §7 | Layout com largura mínima 1280px; abaixo disso, rolagem horizontal (sem reflow mobile no MVP). Tokens de layout não precisam de breakpoints mobile no MVP. |
| **P3** | **pt-BR em tudo** | H1 + UIUX §7 | Rótulos, mensagens, estados e botões em português do Brasil (`src/i18n/pt-BR.ts`). Nenhum token de texto em inglês vaza para a UI. |
| **P4** | **Um primário por contexto** | UIUX §7 | `--cor-primaria-600` aparece **uma vez** por tela em ação de destaque; o resto da tela é neutro. |
| **P5** | **Orientação ao estorno (estorno é rotina)** | UIUX §6.3 + `RK-4` | **`--cor-erro` é reservada a recusa/falha**, nunca a rotina de estorno. Diálogo de estorno usa a linguagem e a cor de rotina (primária), não vermelho de perigo. |
| **P6** | **Natureza contábil por texto, não por cor** | UIUX §7 + RF-10/RF-11 | Saldos a débito/crédito usam **sufixo `D`/`C`**; a cor é **reforço visual**, nunca o único portador do significado (acessibilidade + F13). |
| **P7** | **Mensagem = o que houve + o que fazer** | UIUX §7, §6.2 | Todo estado colorido tem título específico e ação sugerida; nada de "erro ao salvar" com fundo vermelho solto. |
| **P8** | **Sem dependência externa de rede** | ADR-0003 (VPS) + R4 (portabilidade) | Nenhuma fonte/ícone/imagem via CDN na proposta: o build deve ser autosuficiente. |

---

## 3. Paleta de cores

### 3.1 Como ler esta paleta

- **Papel obrigatório:** toda cor tem função declarada abaixo; cor sem papel não entra no produto.
- **Azul institucional** como marca (primária): seriedade contábil, alto contraste com texto branco, boa diferença de matiz para os estados semânticos (verde/âmbar/vermelho).
- **Teal (azul-petróleo)** como secundária: usada **só em dados e progresso** (série "débito", barra de conciliação) — nunca como ação principal, para não disputar com a primária.
- **Neutros levemente frios** (azul-acinzentados) para conviverem com a primária sem ruído.
- Toda cor semântica vem em **trio**: texto (fundo claro), fundo (tinta clara) e sólido (fundo cheio com texto branco).

### 3.2 Primária — escala `50..950`

| Token | Hex | Papel de uso | Origem/justificativa |
|---|---|---|---|
| `--cor-primaria-50` | `#EEF3FF` | Fundo de destaque calmo: item de menu ativo, **linha de totais fixa** do grid | UIUX §4.1 (rodapé fixo) e §3.2 (menu ativo) |
| `--cor-primaria-100` | `#DCE5FF` | Hover/estado selecionado sobre destaque; faixa de progresso suave | — |
| `--cor-primaria-200` | `#BFCFFF` | Borda decorativa de destaque (não textual) | — |
| `--cor-primaria-300` | `#93AAF9` | **Anel de foco sobre superfícies escuras** (barra superior) | WCAG 1.4.11 (3:1) |
| `--cor-primaria-400` | `#6283F2` | Elemento gráfico/acentos (≥3:1 vs branco — **não usar para texto**) | WCAG 1.4.11 |
| `--cor-primaria-500` | `#3A5CE8` | **`--cor-foco`**: anel de foco padrão de teclado | WCAG 2.4.7 / 1.4.11 |
| `--cor-primaria-600` | `#2143D1` | **Primária**: fundo do botão primário, link padrão, marcador do menu ativo, borda de item marcado na conciliação | Ação primária = um por contexto (P4) |
| `--cor-primaria-700` | `#1A35A8` | Hover/pressed do botão primário; link visitado com foco; texto sobre `primaria-100` | — |
| `--cor-primaria-800` | `#172C84` | Texto de destaque sobre tinta clara (badges `aberto`, linha de totais) | — |
| `--cor-primaria-900` | `#162567` | **Barra superior** (`topbar`), título da marca | Substitui o `--barra #242424` cinza do wireframe (ADR-0004: não é preto e branco) |
| `--cor-primaria-950` | `#0F1B4B` | Hover da barra superior | — |

### 3.3 Secundária (teal) — uso restrito a dados e progresso

| Token | Hex | Papel de uso |
|---|---|---|
| `--cor-secundaria-100` | `#CCFBF1` | Fundo de chip/barra de **progresso de conciliação** (CE-08, UIUX §4.4) |
| `--cor-secundaria-600` | `#0F766E` | Série **"débito"** em gráficos e rótulos Débito/Crédito; badge `conciliado` preenchido |
| `--cor-secundaria-700` | `#115E59` | Texto sobre `secundaria-100`; hover da série débito |

> Não existe secundária "500": a secundária é **apoio de dado**, não ação — ações usam sempre a primária (P4).

### 3.4 Neutros

| Token | Hex | Papel de uso |
|---|---|---|
| `--cor-fundo` | `#F5F7FA` | Fundo da área de conteúdo (era `--fundo #f1f1f1`) |
| `--cor-superficie` | `#FFFFFF` | Painéis, formulários, corpo de grid (era `--painel`) |
| `--cor-superficie-2` | `#EEF1F6` | **Cabeçalho de grid**, topo de painel, faixas de filtro (era `--cabec`) |
| `--cor-superficie-hover` | `#F2F4F7` | Hover de linha, chip, fundo de estado desabilitado, badges neutros |
| `--cor-texto` | `#101828` | Texto principal (era `--tinta #171717`) |
| `--cor-texto-2` | `#475467` | Texto secundário, rótulos de cabeçalho, subtítulos (era `--tinta-2`) |
| `--cor-texto-3` | `#667085` | Texto terciário/ajuda (era `--suave`) — **nunca sobre `superficie-2`** (ver §3.9) |
| `--cor-texto-desabilitado` | `#667085` | Texto de controle desabilitado (fundo `superficie-hover`) — ver §5.1 |
| `--cor-borda-controle` | `#667085` | **Borda de input/select/botão secundário** (delimita o controle → 3:1 obrigatório, WCAG 1.4.11) |
| `--cor-borda` | `#D0D5DD` | Divisória decorativa, borda de painel (não é informação de controle) |
| `--cor-borda-suave` | `#E4E7EC` | Linha entre células de tabela, separadores internos |
| `--cor-barra` | `#162567` | = `primaria-900`. Texto da barra: `#FFFFFF` e apoio `#E7EDFF` |
| `--cor-barra-hover` | `#0F1B4B` | = `primaria-950` |

> **Decisão de peso:** a borda de controle fica em `#667085` (1px) e não em `#D0D5DD`/`#98A2B3` — as duas últimas dão 1,47:1 e 2,58:1 contra branco, **abaixo de 3:1** exigido para identificar componente de interface (WCAG 1.4.11). Peso visual de "calma" é alcançado com **espaço**, não com borda invisível (P1).

### 3.5 Semânticas (trio: texto / fundo / sólido)

| Estado | Texto (uso em fundo claro) | Fundo claro | Sólido (com texto branco) | Borda do bloco |
|---|---|---|---|---|
| **Sucesso** (gravação, conciliação ok) | `--cor-sucesso` `#15803D` · texto forte `#146C43` | `#DCFCE7` (suave: `#F0FDF4`) | `#15803D` | `#15803D` |
| **Aviso** (condição do objeto: empresa inativa, período encerrado) | `--cor-aviso` `#B45309` · texto forte `#92400E` | `#FEF3C7` (suave: `#FFFBEB`) | `#92400E` | `#92400E` |
| **Erro** (**recusa/falha** — CE-01..CE-22) | `--cor-erro` `#B91C1C` | `#FEE2E2` (suave: `#FEF2F2`) | `#B91C1C` | `#B91C1C` |
| **Informação** (explicação permanente com ação) | `--cor-info` `#1D4ED8` | `#DBEAFE` (suave: `#EFF6FF`) | `#1D4ED8` | `#1D4ED8` |
| **Neutro** (negação sem dados: permissão, sessão) | `--cor-texto-2` `#475467` / `--cor-texto` `#101828` | `#F2F4F7` | — | `#475467` |
| **Progresso** (retomável, CE-08) | `#115E59` | `#CCFBF1` | `#0F766E` | `#0F766E` |

**Regra de escolha (aplicada na §5.2):** `erro` = algo foi **recusado ou falhou** · `aviso` = **condição** do objeto exige atenção · `sucesso` = operação concluída · `info` = explicação permanente com ação disponível · `neutro` = negação que **não expõe dados** (CE-12/CE-15/CE-21).

> Sobre as variantes *suave*, usar sempre o **texto forte** do trio: `#92400E` sobre `#FFFBEB` = **6,84:1**; `#146C43` sobre `#DCFCE7` = **5,87:1**; `#1D4ED8` sobre `#EFF6FF` = **6,16:1**; `#B91C1C` sobre `#FEF2F2` = **5,91:1**.

### 3.6 Cores para gráficos e tabelas

| Token | Hex | Onde |
|---|---|---|
| `--cor-grafico-debito` | `#0F766E` | Série "débito" (balancete, razão, balanço); rótulo **Débitos**; faixa de equilíbrio |
| `--cor-grafico-credito` | `#6D28D9` | Série "crédito"; rótulo **Créditos**; segunda cor de série |
| `--cor-grafico-neutro` | `#667085` | Série neutra, referência, linhas de base |
| `--cor-fluxo-positivo` | `#15803D` | **Entradas/positivo do fluxo de caixa** (RF-17, CA-09) |
| `--cor-fluxo-negativo` | `#B91C1C` | **Saídas/negativo do fluxo de caixa** |
| `--cor-saldo-debito` / `--cor-saldo-credito` | `#0F766E` / `#6D28D9` | Reforço opcional do sufixo **D**/**C** em células e no cabeçalho de totais |

**Restrição (P6):** em **tabelas de saldo**, o significado é carregado pelo sufixo `D`/`C` (UIUX §7: *"natureza explícita por sufixo D/C (não cor negativa)"*). **Só o fluxo de caixa** usa verde/vermelho de sinal, porque ali o sinal é o dado (entradas/saídas realizadas e previstas).

### 3.7 Badges de situação (mapa cor ← UIUX §7)

| Badge | Estilo | Texto | Fundo | Borda |
|---|---|---|---|---|
| `aberto` | contorno | `#172C84` | `#FFFFFF` | `#667085` |
| `parcialmente pago` | contorno **tracejado** | `#0F766E` | `#FFFFFF` | `#0F766E` |
| `pago` | **preenchido** | `#FFFFFF` | `#15803D` | `#15803D` |
| `cancelado` | riscado | `#667085` | `#F2F4F7` | `#D0D5DD` |
| `conciliado` | preenchido | `#FFFFFF` | `#0F766E` | `#0F766E` |
| `pendente` | contorno tracejado | `#475467` | `#FFFFFF` | `#667085` |
| `ativo` | preenchido | `#FFFFFF` | `#2143D1` | `#2143D1` |
| `inativo` | preenchido fraco | `#667085` | `#F2F4F7` | `#D0D5DD` |
| `somente-leitura` | contorno pontilhado | `#475467` | `#F2F4F7` | `#667085` |
| situação de período (aberto/encerrado) | contorno / preenchido neutro | `#172C84` / `#667085` | `#FFFFFF` / `#F2F4F7` | `#667085` / `#D0D5DD` |

### 3.8 Contraste WCAG AA — pares principais (justificado)

> Metas: **4,5:1** para texto normal (WCAG 2.1 **1.4.3**, nível AA) e **3:1** para elementos gráficos/controles (**1.4.11**). Valores calculados pela fórmula de luminância relativa WCAG (sRGB), não medidos em tela — ver §8.3.

| # | Par | Foreground | Background | Razão | Meta | Situação |
|---|---|---|---|---|---|---|
| 1 | Texto de corpo / fundo da aplicação | `#101828` | `#F5F7FA` | **16,54:1** | 4,5 | AAA |
| 2 | Texto de corpo / superfície | `#101828` | `#FFFFFF` | **17,75:1** | 4,5 | AAA |
| 3 | Texto secundário / superfície | `#475467` | `#FFFFFF` | **7,69:1** | 4,5 | AAA |
| 4 | Texto secundário / fundo | `#475467` | `#F5F7FA` | **7,16:1** | 4,5 | AAA |
| 5 | Texto terciário (ajuda) / superfície | `#667085` | `#FFFFFF` | **4,97:1** | 4,5 | AA |
| 6 | Texto terciário / fundo | `#667085` | `#F5F7FA` | **4,64:1** | 4,5 | AA |
| 7 | Texto terciário / linha em hover | `#667085` | `#F2F4F7` | **4,51:1** | 4,5 | AA |
| 8 | Rótulo de cabeçalho de grid | `#475467` | `#EEF1F6` | **6,79:1** | 4,5 | AAA |
| 9 | **Texto de botão primário** | `#FFFFFF` | `#2143D1` | **7,53:1** | 4,5 | AAA |
| 10 | Texto de botão primário em hover | `#FFFFFF` | `#1A35A8` | **9,91:1** | 4,5 | AAA |
| 11 | **Link padrão / fundo** | `#2143D1` | `#F5F7FA` | **7,02:1** | 4,5 | AAA |
| 12 | Link/fantasma (`Estornar`, `Inativar`) | `#1A35A8` | `#FFFFFF` | **9,91:1** | 4,5 | AAA |
| 13 | Item de menu ativo · linha de totais | `#172C84` | `#EEF3FF` | **10,93:1** | 4,5 | AAA |
| 14 | Texto da barra superior | `#FFFFFF` | `#162567` | **14,05:1** | 4,5 | AAA |
| 15 | Texto de apoio da barra superior | `#E7EDFF` | `#162567` | **12,01:1** | 4,5 | AAA |
| 16 | **Erro: título/borda sobre fundo de erro** | `#B91C1C` | `#FEE2E2` | **5,30:1** | 4,5 | AA |
| 17 | Erro: texto sobre fundo de erro suave | `#B91C1C` | `#FEF2F2` | **5,91:1** | 4,5 | AA |
| 18 | Erro: corpo do banner | `#101828` | `#FEE2E2` | **14,53:1** | 4,5 | AAA |
| 19 | Erro sólido (toast/primário de recusa) | `#FFFFFF` | `#B91C1C` | **6,47:1** | 4,5 | AA |
| 20 | Aviso: texto sobre fundo de aviso | `#92400E` | `#FEF3C7` | **6,37:1** | 4,5 | AA |
| 21 | Aviso: texto sobre branco | `#B45309` | `#FFFFFF` | **5,02:1** | 4,5 | AA |
| 22 | Sucesso: texto sobre fundo de sucesso | `#146C43` | `#F0FDF4` | **6,16:1** | 4,5 | AAA |
| 23 | Sucesso: texto sobre `fundo-sucesso` | `#15803D` | `#DCFCE7` | **4,57:1** | 4,5 | AA |
| 24 | Sucesso sólido / texto branco | `#FFFFFF` | `#15803D` | **5,02:1** | 4,5 | AA |
| 25 | Info: texto sobre fundo de informação | `#1D4ED8` | `#DBEAFE` | **5,49:1** | 4,5 | AA |
| 26 | Info sobre fundo suave / sobre branco | `#1D4ED8` | `#EFF6FF` / `#FFFFFF` | **6,16:1** / **6,70:1** | 4,5 | AAA/AA |
| 27 | Neutro (negação de permissão) | `#101828` | `#F2F4F7` | **16,11:1** | 4,5 | AAA |
| 28 | Progresso (CE-08) | `#115E59` | `#CCFBF1` | **6,73:1** | 4,5 | AAA |
| 29 | **Borda de controle** vs superfície (não textual) | `#667085` | `#FFFFFF` | **4,97:1** | 3,0 | AA (1.4.11) |
| 30 | **Anel de foco** vs fundo (não textual) | `#3A5CE8` | `#F5F7FA` | **5,05:1** | 3,0 | AA (1.4.11) |
| 31 | Anel de foco vs superfície branca | `#3A5CE8` | `#FFFFFF` | **5,42:1** | 3,0 | AA (1.4.11) |
| 32 | Anel de foco sobre barra escura | `#93AAF9` | `#162567` | **6,26:1** | 3,0 | AA (1.4.11) |
| 33 | Badge `pago` | `#FFFFFF` | `#15803D` | **5,02:1** | 4,5 | AA |
| 34 | Badge `ativo` / `conciliado` | `#FFFFFF` | `#2143D1` / `#0F766E` | **7,53:1** / **5,47:1** | 4,5 | AAA/AA |
| 35 | Badge `cancelado`/`inativo` | `#667085` | `#F2F4F7` | **4,51:1** | 4,5 | AA |
| 36 | Badge `aberto`/`pendente`/`somente-leitura` | `#475467` | `#FFFFFF` | **7,69:1** | 4,5 | AAA |
| 37 | Gráfico: série **débito** vs superfície | `#0F766E` | `#FFFFFF` | **5,47:1** | 4,5 | AA (rótulos) |
| 38 | Gráfico: série **crédito** vs superfície | `#6D28D9` | `#FFFFFF` | **7,10:1** | 4,5 | AAA |
| 39 | Fluxo **positivo** / **negativo** vs superfície | `#15803D` / `#B91C1C` | `#FFFFFF` | **5,02:1** / **6,47:1** | 4,5 | AA |
| 40 | Texto desabilitado (estado dispensado pela WCAG, mantido legível) | `#667085` | `#F2F4F7` | **4,51:1** | 4,5 | AA |

### 3.9 Pares proibidos (aprendidos no cálculo)

| Par | Razão | Regra |
|---|---|---|
| `#667085` (texto-3) sobre `#EEF1F6` (superfície-2) | **4,39:1 — reprovado** | Rótulos de cabeçalho de grid usam **`--cor-texto-2 #475467`** (6,79:1). |
| `#6283F2` (primária-400) como **texto** sobre branco | 3,47:1 — só ≥3:1 | Primária-400 só em elementos **gráficos**; texto usa 600+. |
| `#D0D5DD` como borda de **controle** | 1,47:1 | `--cor-borda` é decorativa; controles usam `--cor-borda-controle`. |
| `#93AAF9`/`#BFCFFF`/`#6283F2` como texto | ≤3,47:1 | Uso exclusivamente decorativo/gráfico. |
| Qualquer texto pequeno só com cor para mudar o sentido | — | D/C e sinal sempre acompanhados de **texto** (P6). |

---

## 4. Tipografia

### 4.1 Família e stack (com justificativa de indisponibilidade de CDN)

**Decisão:** usar **a fonte do sistema** — nenhuma requisição externa de fonte.

```css
--fonte-corpo: "Segoe UI", system-ui, -apple-system, "Roboto",
               "Helvetica Neue", Arial, "Noto Sans", sans-serif;

--fonte-mono: ui-monospace, "Cascadia Mono", "SFMono-Regular",
              Consolas, "Liberation Mono", "Courier New", monospace;
```

**Justificativa (rastreável):**

1. **Deploy em VPS própria, sem CDN (ADR-0003 + R4 portabilidade):** o produto deve subir em qualquer VPS com Node, sem depender de rede externa; Google Fonts/CDN criariam dependência de terceiros, latência adicional e falha silenciosa se o provedor bloquear (escritório em intranet/VPN é cenário real).
2. **Zero custo de licença e zero CLS/FOUT:** texto renderiza imediatamente com a métrica de fonte do sistema.
3. **Fidelidade com a forma aprovada:** o stack é **exatamente** o usado nos wireframes aprovados (`estilos.css`: `"Segoe UI", system-ui, Roboto, Arial, sans-serif`), então o estilo aplicado não desloca a estrutura aprovada.
4. **Cobertura:** Windows `Segoe UI` · macOS/iOS `system-ui`/`-apple-system` · Android `Roboto` · Linux `Noto Sans` · fallback final `Arial`.

**Pendência (humana):** se o escritório quiser uma fonte de marca (ex.: Inter), ela precisa ser **self-hosted** (arquivo `.woff2` no build ou pacote npm) — nunca por CDN. Isso muda identidade visual e adiciona dependência de build; decisão fora deste documento (§8.2, PA-2).

### 4.2 Escala, pesos e regras

> A escala **mantém os valores dos wireframes aprovados** (22px/15px/14px/13px/12px/10.5px) — mudança de densidade aqui mudaria a forma aprovada.

| Token | Valor | Uso | Peso |
|---|---|---|---|
| `--fonte-tamanho-display` | `22px` | `h1` da tela (cabeçalho) | `600` |
| `--fonte-tamanho-titulo` | `16px` | Título de painel, título de diálogo | `600` |
| `--fonte-tamanho-subtitulo` | `15px` | Título de estado vazio; `h2` | `700` |
| `--fonte-tamanho-corpo` | `14px / 1.55` | Texto corrente, campos de formulário | `400` (label `600`) |
| `--fonte-tamanho-tabela` | `13px / 1.5` | Grid denso, filtros, botões, menus | `400` (célula de destaque `600`) |
| `--fonte-tamanho-pequeno` | `12px` | Texto de ajuda, ação sugerida, paginação | `400` |
| `--fonte-tamanho-micro` | `10.5px` | Badges, chips `RF/CA`, rótulos de filtro (UPPERCASE, `letter-spacing .05em`) | `600` |

- **Pesos disponíveis:** `400` (regular), `600` (semibold, títulos/labels), `700` (negrito, totais/estado vazio). Não usar 500/300 — fontes do sistema variam demais nesses pesos.
- **UPPERCASE** só em rótulo curto de filtro/cabeçalho de coluna/etiqueta de seção; nunca em mensagens (legibilidade, P7).
- **Números sempre à direita** em colunas de valor/data (UIUX §4.1).

### 4.3 Números tabulares (regra obrigatória em tabelas)

```css
td.num, th.num, .kpi .valor, .campo.num input, .item-extrato .valor {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

- **Regra:** **toda** célula monetária, quantitativa ou de data/hora usa `tabular-nums` — alinhamento de coluna sem quebra de linha ao atualizar valor (UIUX §2.2, §4.1, §7).
- **Fallback:** `Segoe UI`, `Roboto`, `Arial`/`Helvetica` e `system-ui` têm dígitos de largura uniforme mesmo sem `tnum`, então a regra é redundante-segura — não há cenário em que a coluna "dance".
- Vale também para `R$ 1.234,56` com máscara e para `dd/mm/aaaa HH:MM:SS` da trilha de auditoria.
- Chips/códigos técnicos (`RF-xx`, `CA-xx`, IDs `L-0042`) usam `--fonte-mono`.

---

## 5. Estados

### 5.1 Estados de interação e de sistema

| Estado | Definição visual (tokens) | Onde | Origem |
|---|---|---|---|
| **Repos** | Texto `--cor-texto`; link `--cor-primaria-600` sublinhado só em texto corrido | base | — |
| **Hover** | Linha de grid → `--cor-superficie-hover`; botão primário → `--cor-primaria-700`; botão secundário → `--cor-superficie-hover` + borda `--cor-borda-controle`; item de menu → `--cor-superficie-hover`; barra superior → `--cor-barra-hover` | tabelas, menus, botões | UIUX §4.1 |
| **Foco (teclado, visível)** | `outline: 2px solid var(--cor-foco); outline-offset: 2px;` sobre superfícies claras (5,05–5,42:1); sobre a barra escura, `outline-color: var(--cor-foco-escuro)` (6,26:1). **Nunca** `outline: none` sem substituto | todo controle interativo | WCAG 2.4.7/1.4.11 |
| **Ativo/pressed** | Botão primário → `--cor-primaria-700`; item de menu ativo → fundo `--cor-primaria-50`, texto `#172C84`, **borda esquerda 3px `--cor-primaria-600`**; item de conciliação marcado → borda 2px `--cor-primaria-600` + fundo `--cor-primaria-50` | menu, grid, conciliação | wireframe `.ativo`/`.marcado` (`--destaque` antes sem valor) |
| **Desabilitado** | Fundo `--cor-superficie-hover`, texto `--cor-texto-desabilitado` (4,51:1), `cursor: not-allowed`, `aria-disabled="true"` (+ `disabled` quando a regra for de GUIA, não de dado). **Não usar `opacity .45`** sobre texto — o wireframe usava, aqui o estado é definido por token legível | botões, ações ausentes por papel | UIUX §4.5, F13 |
| **Carregando (grid)** | Esqueleto de linhas: fundo `--cor-superficie-2`, pulso 1,1s (respeitar `prefers-reduced-motion: reduce` → sem animação) | toda carga | UIUX §4.1 |
| **Carregando (submissão)** | Botão primário desabilitado + rótulo **"Gravando…"** (pt-BR) | formulários | UIUX §4.5 |
| **Vazio** | Painel `--cor-superficie`, borda tracejada `--cor-borda`, título `700` `--cor-texto`, texto `--cor-texto-3` (4,97:1) + **ação primária contextual** | sem empresas (CA-23), sem itens, período sem eventos | UIUX §4.5 |
| **Erro de campo (FB-1)** | Borda **2px `--cor-erro`**, fundo do campo `#FEF2F2`, mensagem sob o campo `--cor-erro` (5,91:1) + valor esperado; foco no primeiro inválido | validação campo a campo | UIUX §4.2, §6.2 |
| **Alerta/recusa (FB-2/FB-3)** | ver §5.2 | CE-01..CE-22 | UIUX §6 |
| **Sucesso** | Flash/inline: fundo `#DCFCE7`, borda 4px `--cor-sucesso`, título `#146C43` (6,16:1), corpo `--cor-texto` (16,16:1) | após gravação/conciliação | UIUX §4.5 |
| **Somente leitura** | Barra de ações com distintivo `somente-leitura` (borda pontilhada) e ações de escrita **ausentes**; fundo da faixa `--cor-superficie-hover` | admin nas telas contábeis; empresa inativa (CE-20) | UIUX §4.5, F13 |

### 5.2 Recusa e erro — mapeamento CE-01..CE-22 → estado visual

> **Regra semântica:** recusa/falha = `erro` · condição do objeto = `aviso` · negação sem dados = `neutro` · explicação permanente com ação = `info` · conclusão = `sucesso`. Toda mensagem mantém a estrutura **"o que houve (com valores) + o que fazer"** (UIUX §7, P7).

| CE | Padrão (UIUX §6.1) | Estado/tokens | Ação sugerida na cor |
|---|---|---|---|
| CE-01 desbalanceado | FB-2 banner | `erro` — fundo `#FEE2E2`, borda `#B91C1C`, título 5,30:1 | Ajustar partidas |
| CE-02 campo inválido | FB-1 | `erro` campo — borda 2px `#B91C1C`, msg 5,91:1 | Corrigir campo |
| CE-03 período encerrado | FB-2/FB-3 | `erro` — banner + diferença citada | Usar período aberto |
| CE-04 imutabilidade | FB-3 (+ ação ausente) | **`info` permanente** (`#DBEAFE`/`#1D4ED8` 5,49:1) com ação `Estornar`; **`erro`** só se tentativa direta | `Estornar` (**RK-4**: não alarmar) |
| CE-05 já estornado | FB-3 | `erro` + link ao lançamento vinculado | Ver estorno vinculado |
| CE-06 CNPJ duplicado | FB-1/FB-2 | `erro` campo + banner com link à empresa existente | Corrigir / abrir empresa |
| CE-07 valor excede saldo / título pago | FB-1/FB-3 | `erro` campo + `erro` in-contexto | Ajustar / `Estornar a baixa` |
| CE-08 progresso salvo | FB-7 | **`progresso`** — chip `#CCFBF1`/`#115E59` (6,73:1) | Continuar quando quiser |
| CE-09 item já conciliado | FB-3 | `erro` in-contexto junto ao item | `Desconciliar` |
| CE-10 falha ao gravar | FB-6 | `erro` banner — "nada foi registrado" | `Tentar novamente` |
| CE-11 sessão expirada | FB-5 | **`neutro`** no login (`#F2F4F7`, texto 16,11:1) | Entrar novamente |
| CE-12 sem permissão | FB-5 | **`neutro`** (sem expor dados) | Voltar |
| CE-13 conta com lançamentos | FB-4 | `erro` + ação `Inativar` (caminho permitido) | `Inativar` |
| CE-14/CE-20 empresa inativa | FB-3 + faixa | **`aviso`** — faixa no topo `#FEF3C7`, texto `#92400E` (6,37:1) | Consultar histórico |
| CE-15 escrita cruzada | FB-5 | **`neutro`** | Falar com administrador |
| CE-16 trilha somente leitura | FB-3 | **`neutro`** permanente (sem ações na UI) | Consultar por filtros |
| CE-17 login bloqueado | FB-5 | `erro` (condição impeditiva ativa, com contagem) | Aguardar / contatar admin |
| CE-18 estorno com item conciliado | FB-3 + link | `erro` + link de navegação | `Ir para conciliação` → `Estornar` |
| CE-19 alíquota/regime | FB-1/FB-3 | `erro` campo / `erro` banner | Corrigir / configurar regime (RF-20) |
| CE-21 configuração fiscal sem permissão | FB-5 | **`neutro`** | Tentativa auditada |
| CE-22 baixa em período encerrado | FB-3 | `erro` — estorno recusado, título inalterado | Em período aberto é normal |

**Consequência de `RK-4` (P5):** **nenhum** diálogo de estorno usa `--cor-erro`. Diálogos de rotina (estorno, baixa, desconciliar) usam `--cor-primaria-600` no botão primário e linguagem neutra; `--cor-erro` aparece **apenas** nas linhas da tabela acima (recusa/falha).

### 5.3 Acessibilidade transversal dos estados

- Foco sempre visível e ≥3:1 contra o fundo adjacente (§3.8, itens 30–32).
- Estado nunca comunicado **só por cor**: erro sempre com texto + ícone; saldo com sufixo `D`/`C` (P6); badge com rótulo escrito.
- `prefers-reduced-motion: reduce` desliga o pulso do esqueleto e transições >0ms.
- Alvo mínimo de clique ~32px de altura em botões de grid (já que densidade reduz padding).

---

## 6. Tokens — contrato pronto para CSS variables

> Bloco único, nomeado, pronto para colar em um `:root` global do app (arquivo de estilo do `apps/web` — **criado na implementação da T020, não neste incremento**).

```css
:root {
  /* ===== 1. PRIMÁRIA (azul institucional) ===== */
  --cor-primaria-50:  #EEF3FF;
  --cor-primaria-100: #DCE5FF;
  --cor-primaria-200: #BFCFFF;
  --cor-primaria-300: #93AAF9;   /* foco sobre superfície escura */
  --cor-primaria-400: #6283F2;   /* só gráfico */
  --cor-primaria-500: #3A5CE8;   /* --cor-foco */
  --cor-primaria-600: #2143D1;   /* PRIMÁRIA: botão/link/marcador */
  --cor-primaria-700: #1A35A8;   /* hover/pressed */
  --cor-primaria-800: #172C84;   /* texto de destaque */
  --cor-primaria-900: #162567;   /* barra superior */
  --cor-primaria-950: #0F1B4B;   /* hover da barra */

  /* ===== 2. SECUNDÁRIA (teal — só dados/progresso) ===== */
  --cor-secundaria-100: #CCFBF1;
  --cor-secundaria-600: #0F766E;
  --cor-secundaria-700: #115E59;

  /* ===== 3. NEUTROS ===== */
  --cor-fundo:            #F5F7FA;
  --cor-superficie:       #FFFFFF;
  --cor-superficie-2:     #EEF1F6;   /* cabeçalho de grid, faixas */
  --cor-superficie-hover: #F2F4F7;
  --cor-texto:            #101828;
  --cor-texto-2:          #475467;
  --cor-texto-3:          #667085;
  --cor-texto-desabilitado: #667085;
  --cor-borda-controle:   #667085;   /* 3:1 (WCAG 1.4.11) */
  --cor-borda:            #D0D5DD;   /* decorativa */
  --cor-borda-suave:      #E4E7EC;   /* linhas de célula */
  --cor-barra:            #162567;
  --cor-barra-hover:      #0F1B4B;
  --cor-barra-texto:      #FFFFFF;
  --cor-barra-texto-2:    #E7EDFF;

  /* ===== 4. SEMÂNTICAS ===== */
  --cor-sucesso:           #15803D;
  --cor-sucesso-texto:     #146C43;
  --cor-sucesso-fundo:     #DCFCE7;
  --cor-sucesso-fundo-suave: #F0FDF4;
  --cor-aviso:             #B45309;
  --cor-aviso-texto:       #92400E;
  --cor-aviso-fundo:       #FEF3C7;
  --cor-aviso-fundo-suave: #FFFBEB;
  --cor-erro:              #B91C1C;
  --cor-erro-texto:        #B91C1C;
  --cor-erro-fundo:        #FEE2E2;
  --cor-erro-fundo-suave:  #FEF2F2;
  --cor-info:              #1D4ED8;
  --cor-info-fundo:        #DBEAFE;
  --cor-info-fundo-suave:  #EFF6FF;
  --cor-neutro-fundo:      #F2F4F7;
  --cor-neutro-borda:      #475467;
  --cor-progresso:         #0F766E;
  --cor-progresso-fundo:   #CCFBF1;

  /* ===== 5. GRÁFICOS E TABELAS ===== */
  --cor-grafico-debito:   #0F766E;
  --cor-grafico-credito:  #6D28D9;
  --cor-grafico-neutro:   #667085;
  --cor-fluxo-positivo:   #15803D;
  --cor-fluxo-negativo:   #B91C1C;
  --cor-saldo-debito:     #0F766E;
  --cor-saldo-credito:    #6D28D9;

  /* ===== 6. FOCO ===== */
  --cor-foco:        #3A5CE8;
  --cor-foco-escuro: #93AAF9;

  /* ===== 7. TIPOGRAFIA ===== */
  --fonte-corpo: "Segoe UI", system-ui, -apple-system, "Roboto", "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --fonte-mono:  ui-monospace, "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", "Courier New", monospace;
  --fonte-tamanho-display: 22px;
  --fonte-tamanho-titulo:  16px;
  --fonte-tamanho-subtitulo: 15px;
  --fonte-tamanho-corpo:   14px;
  --fonte-tamanho-tabela:  13px;
  --fonte-tamanho-pequeno: 12px;
  --fonte-tamanho-micro:   10.5px;
  --fonte-peso-regular: 400;
  --fonte-peso-medio:   600;
  --fonte-peso-forte:   700;
  --fonte-entrelinha-corpo: 1.55;
  --fonte-entrelinha-tabela: 1.5;
  --fonte-numeros: tabular-nums;   /* aplicar como font-variant-numeric */

  /* ===== 8. ESPAÇAMENTO (base 4px) ===== */
  --espacamento-0-5: 2px;
  --espacamento-1:   4px;
  --espacamento-1-5: 6px;
  --espacamento-2:   8px;
  --espacamento-3:   12px;
  --espacamento-4:   16px;
  --espacamento-5:   20px;
  --espacamento-6:   24px;
  --espacamento-8:   32px;
  --espacamento-12:  48px;
  /* estruturais herdados dos wireframes aprovados */
  --espacamento-painel:   14px;
  --espacamento-campo:    18px;   /* respiro entre campos (UIUX §4.2) */
  --espacamento-grupo:    22px;
  --espacamento-celula-y: 4px;
  --espacamento-celula-x: 8px;

  /* ===== 9. RAIOS ===== */
  --raio-1: 3px;      /* botões, inputs, abas (wireframe) */
  --raio-2: 6px;      /* cards, banners */
  --raio-3: 10px;     /* diálogo, painel de estado */
  --raio-pilula: 999px; /* badges, chips */

  /* ===== 10. SOMBRAS ===== */
  --sombra-1: 0 1px 2px rgba(16, 24, 40, .06);
  --sombra-2: 0 4px 12px rgba(16, 24, 40, .10);
  --sombra-3: 0 10px 30px rgba(16, 24, 40, .30); /* diálogo */

  /* ===== 11. MEDIDAS DE BORDA E MOVIMENTO ===== */
  --largura-borda-controle: 1px;
  --largura-borda-foco:     2px;
  --largura-borda-destaque: 3px;   /* marcador lateral do menu ativo */
  --duracao-rapida: 120ms;

  /* ===== 12. ALIASES POR COMPONENTE (contrato de uso) ===== */
  --botao-primario-fundo:     var(--cor-primaria-600);
  --botao-primario-fundo-hover: var(--cor-primaria-700);
  --botao-primario-texto:     #FFFFFF;
  --botao-secundario-fundo:   var(--cor-superficie);
  --botao-secundario-borda:   var(--cor-borda-controle);
  --menu-ativo-fundo:         var(--cor-primaria-50);
  --menu-ativo-texto:         #172C84;
  --menu-ativo-marcador:      var(--cor-primaria-600);
  --grid-cabecalho-fundo:     var(--cor-superficie-2);
  --grid-cabecalho-texto:     var(--cor-texto-2);
  --grid-linha-hover:         var(--cor-superficie-hover);
  --grid-totais-fundo:        var(--cor-primaria-50);
  --grid-totais-texto:        #172C84;
  --campo-borda:              var(--cor-borda-controle);
  --campo-borda-invalida:     var(--cor-erro);
  --campo-fundo-invalido:     var(--cor-erro-fundo-suave);
}
```

---

## 7. Aplicação no app (`sistema-contabil/apps/web`)

> **Somente mapeamento** — nenhum arquivo de código foi alterado neste incremento. Hoje o `apps/web` **não tem framework de CSS** (`package.json`: apenas `react`, `react-dom`, `vite`) nem folha de estilo global — os tokens entram como CSS puro num stylesheet global importado no `main.tsx`. Se a implementação escolher uma solução de utilitários, o **mapeamento** é decisão técnica de implementação, não decisão de produto.

### 7.1 Pontos de aplicação

| Área do app | Onde (arquitetura atual) | Tokens/estilos |
|---|---|---|
| Folha de estilos global | arquivo de estilo do app (a criar na T020) | bloco `:root` da §6 + reset + `body { font: var(--fonte-tamanho-corpo)/var(--fonte-entrelinha-corpo) var(--fonte-corpo); color: var(--cor-texto); background: var(--cor-fundo); }` |
| Shell / navegação | `src/components/AppShell.tsx` | barra superior `--cor-barra` + texto `--cor-barra-texto`; menu lateral `--cor-superficie`; item ativo `--menu-ativo-*`; seletor de empresa com rótulo "leitura global auditada" (`--cor-info`) para o admin |
| Área de conteúdo | `AppShell` / páginas | `--cor-fundo`, `max-width` do conteúdo, `min-width: 1280px` (R12) |
| Grids densos | componentes de tabela | `--grid-cabecalho-*`, `td.num` com `tabular-nums`, hover `--grid-linha-hover`, **`tfoot` fixo com `--grid-totais-*`**, paginação `--fonte-tamanho-pequeno` |
| Formulários | componentes de campo | coluna 720px, `--espacamento-campo`/`--espacamento-grupo`, `--campo-*`, erro `--cor-erro` sob o campo, banner `--cor-erro-fundo` no topo |
| Conciliação (internet banking) | telas de conciliação | duas colunas; item marcado = borda 2px `--cor-primaria-600` + fundo `--cor-primaria-50`; conciliado = fundo `--cor-sucesso-fundo` + badge `conciliado`; bloqueado (CE-09) = `--cor-superficie-hover` + mensagem `erro`; progresso = `--cor-progresso-fundo` |
| Botões | componente `Button` | primário/fantasma/secundário conforme §6.12; estados da §5.1 |
| Badges | componente `Badge` | §3.7 |
| Diálogos | componente `Dialog` | `--sombra-3`, `--raio-3`, primário `--cor-primaria-600` (**nunca** `--cor-erro` — `RK-4`) |
| Mensagens de recusa | componentes de feedback | §5.2 (CE-01..CE-22), textos via `src/i18n/pt-BR.ts` |
| Relatórios/KPIs | telas de relatório | números `tabular-nums`; fluxo de caixa com `--cor-fluxo-positivo`/`--cor-fluxo-negativo` + rótulo escrito |
| Login | `pages/` de login | cartão centrado `--cor-superficie` + `--sombra-2`; estados `neutro` (CE-11) e `erro` (CE-17) |

### 7.2 Mapa wireframe (cinza) → token de produto

| Variável em `wireframes/estilos.css` | Valor do wireframe | Token de produto |
|---|---|---|
| `--tinta` | `#171717` | `--cor-texto` `#101828` |
| `--tinta-2` | `#3f3f3f` | `--cor-texto-2` `#475467` |
| `--suave` | `#6e6e6e` | `--cor-texto-3` `#667085` |
| `--linha` | `#c8c8c8` | `--cor-borda` (divisórias) / `--cor-borda-controle` (controles) |
| `--linha-2` | `#e6e6e6` | `--cor-borda-suave` `#E4E7EC` |
| `--fundo` | `#f1f1f1` | `--cor-fundo` `#F5F7FA` |
| `--painel` | `#ffffff` | `--cor-superficie` |
| `--barra` | `#242424` | `--cor-barra` `#162567` (**deixa de ser cinza** — ADR-0004) |
| `--cabec` | `#ececec` | `--cor-superficie-2` `#EEF1F6` |
| `--rodape` (totais) | `#e0e0e0` | `--grid-totais-fundo` `#EEF3FF` |
| `--destaque` (não definida; fallback `#111`) | — | `--cor-primaria-600` `#2143D1` |
| `#1d1d1d` (botão primário / campo inválido) | cinza escuro | `--cor-primaria-600` (ação) / `--cor-erro` (inválido) |

### 7.3 Correspondência com as 11 telas dos wireframes

| # | Tela | Padrão de forma (UIUX §4) | Estilo aplicável / estados da §5 |
|---|---|---|---|
| 1 | `login` | Formulário (B) reduzido | cartão `superficie`, botão primário, estados `neutro` (CE-11) e `erro` (CE-17) |
| 2 | `empresas` | Grid (A) + Form (B) | badges `ativo`/`inativo`, faixa `aviso` CE-20/14, campo `erro` CE-06, estados vazio/carregando |
| 3 | `usuarios` | Grid (A) + Form (B) | badges de papel, `neutro` CE-12, flag `pode_configurar_fiscal` (ADR-0004/Q-UI-1) como controle com estados on/off (primária/`superficie-hover`) |
| 4 | `plano-contas` | Grid hierárquico (A) | recuo `hier2/hier3`, `erro` CE-13, ação fantasma `Inativar` (`--cor-primaria-700`) |
| 5 | `periodos` | Grid (A) + Diálogo (C) | badges de situação do período, diálogo com primária (**não** `erro`), `erro` CE-03/CE-22 |
| 6 | `lancamentos` | Grid (A) + Form com partidas (B) + Diálogo (C) | faixa de totalizadores `--grid-totais-*` + indicador equilíbrio (`sucesso`/`erro`), `erro` CE-01..CE-05, diálogo de estorno neutro (RK-4) |
| 7 | `titulos` | Grid (A) + Form (B) + Diálogo (C) | badges §3.7, `erro` CE-07/CE-18/CE-22, valores `tabular-nums` |
| 8 | `conciliacao` | Conciliação (D) | colunas, marcado (primária), conciliado (`sucesso`), bloqueado (`neutro`+`erro`), progresso (CE-08) |
| 9 | `relatorios` | Grid (A) + abas | abas (`superficie-2`/ativa `superficie` + marcador primária), KPIs `tabular-nums`, fluxo `positivo`/`negativo`, FIX-01 nos totais |
| 10 | `fiscal` | Grid (A) + Form (B) + abas | tabelas de alíquota, `erro` CE-19, `neutro` CE-21, badges de regime |
| 11 | `auditoria` | Grid (A) somente leitura | distintivo `somente-leitura`, `neutro` CE-16, data/hora `tabular-nums` |

---

## 8. Decisões e pendências de aprovação humana

### 8.1 Decisões tomadas neste documento (com origem)

| # | Decisão | Origem |
|---|---|---|
| D-1 | Paleta **colorida** — o produto não é preto e branco; wireframes em cinza são forma, não estilo | ADR-0004 (ressalva "será preto e branco?" → não) |
| D-2 | Primária **azul institucional** `#2143D1`; barra superior `#162567` | Convenção de produto contábil + P4; substitui `--barra #242424` |
| D-3 | Secundária **teal** restrita a dados/progresso, nunca a ação | P1/P4 |
| D-4 | Fonte **do sistema**, sem CDN | ADR-0003 (VPS) + R4 + fidelidade ao wireframe |
| D-5 | Escala tipográfica = escala dos wireframes aprovados (sem troca de densidade) | UIUX §2.2, §4.1 |
| D-6 | `tabular-nums` obrigatório em toda célula numérica/de data | UIUX §2.2, §7 |
| D-7 | Borda de controle `#667085` (≥3:1); divisória `#D0D5DD` | WCAG 1.4.11 |
| D-8 | Semântica de 5 estados (erro/aviso/sucesso/info/neutro) aplicada a CE-01..CE-22 | UIUX §6 + P7 |
| D-9 | `--cor-erro` **nunca** em diálogo de estorno | UIUX §6.3, `RK-4` |
| D-10 | Saldos por sufixo `D`/`C`; verde/vermelho **só** no fluxo de caixa | UIUX §7, RF-10/RF-11 |
| D-11 | Estado desabilitado legível por token (não `opacity .45`) | WCAG 1.4.3 + P1 |
| D-12 | Linha de totais com fundo `--cor-primaria-50` (destaque de marca, não cinza) | UIUX §4.1 + D-1 |

### 8.2 Pendências — exigem aprovação humana antes de a T020 poder ser concluída

> O critério de aceite da T020 é literal: **`docs/design/ESTILO.md` criado e o estilo aplicado ao app; aprovação humana do estilo registrada**. Os itens abaixo são o que precisa de resposta do usuário; a registro deve (idealmente) ocorrer numa ADR ou no `.squad/` pela coordenação.

> **STATUS — RESOLVIDO em 2026-10-21.** Registro formal em `docs/decisions/ADR-0005-aprovacao-direcao-visual-estilo.md`.
> - **PA-1** aprovada pelo usuário (paleta proposta, sem troca de família).
> - **PA-2** aprovada pelo usuário (fonte do sistema; sem CDN e sem arquivo self-hosted).
> - **PA-6** aprovada pelo usuário (manter 10,5px, com conferência de legibilidade na aplicação).
> - **PA-3, PA-4 e PA-5** aprovadas pelos defaults recomendados, sem objeção registrada; reversíveis por token antes do fechamento da T020.
> - **PA-7** cumprida pela ADR-0005.
> Este documento deixa de ser proposta e passa a ser **contrato de estilo**: mudar cor/tamanho significativo a partir daqui é nova decisão registrada, não ajuste livre.

| ID | Pendência | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| **PA-1** | **Paleta geral**: azul institucional `#2143D1` + teal `#0F766E` + neutros frios | (a) aprovar como está · (b) trocar a família da primária · (c) ajustar tons pontuais | (a) | aprovar/reprovar a direção |
| **PA-2** | **Tipografia**: fonte do sistema (sem CDN) × fonte de marca self-hosted | (a) sistema · (b) fonte `.woff2` self-hosted (ex.: Inter via pacote npm — adiciona dependência de build e arquivo de fonte) | (a) | §4.1 |
| **PA-3** | **Cores dos badges de situação** (§3.7) e da linha de totais (D-12) | aprovar mapa ou ajustar | aprovar | §3.7 |
| **PA-4** | **Cor do botão primário em diálogos de efeito amplo** (inativar, cancelar título, encerrar período/exercício): usar `--cor-erro` ou manter `--cor-primaria-600`? | (a) primária (recomendado: nenhuma exclusão dura existe — R9/R11/H13 — e rotina em vermelho contradiz `RK-4`) · (b) vermelho só nesses diálogos | (a) | §5.2 |
| **PA-5** | **Cores de gráfico**: débito `#0F766E` × crédito `#6D28D9`; fluxo positivo/negativo verde/vermelho | aprovar ou ajustar | aprovar | §3.6 |
| **PA-6** | **Tamanho micro** `10.5px` (badges/chips/rótulos) herdado dos wireframes — manter ou subir para `11px`? | (a) manter 10.5px (fidelidade) · (b) 11px (legibilidade) | (a), com conferência na revisão de legibilidade | §4.2 |
| **PA-7** | **Registro formal** da aprovação (ADR ou entrada em `.squad/`) — sem ele o critério de aceite da T020 não é cumprido | registrar aprovação total ou aprovação com ajustes listados | — | conclusão da T020 |

**Não bloqueiam esta etapa (resolvidas por esta fase):** "será preto e branco?" → **não** (ADR-0004, respondido por D-1).

### 8.3 Limitações de verificação (o que **não** foi verificado aqui)

1. **Contraste calculado, não medido em navegador:** os valores da §3.8 vêm da fórmula de luminância WCAG sobre os hexes; a **inspeção em navegador** (devtools/extensão de contraste, print por tela) acontece na aplicação/verificação (T021). Pendência registrada: validar os pares 1..40 em tela real e em zoom 200%.
2. **Nenhum arquivo de código foi criado ou alterado** neste incremento (`sistema-contabil/**` intocado): os tokens **ainda não estão** consumidos pelo app.
3. **Ícones** não fazem parte deste documento (nenhum requisito cita ícones; adicionar ícones externos criaria dependência de CDN — qualquer proposta futura deve ser self-hosted e aprovada).
4. **Teste com usuários / preferências do escritório** sobre a cor da marca não foi feito — daí PA-1.

---

## 9. Checklist de verificação (autoverificação do documento)

- [x] **C1** Documento existe e é autocontido (problema, fontes, decisões e pendências legíveis sem a conversa).
- [x] **C2** Toda cor da §3 tem **hex exato + papel de uso** (primária 11 tons, secundária 3, neutros 14, semânticas 5 trios, gráficos 6, badges 10).
- [x] **C3** Pares principais de contraste **declarados com razão WCAG AA**: §3.8 com **40 pares** (texto ≥4,5:1; controles/gráficos ≥3:1) — inclui texto de corpo, texto de botão primário, links, semânticas, badges e foco.
- [x] **C4** Pares **reprovados** registrados (§3.9) com a regra de uso proibido.
- [x] **C5** Tipografia com **stack completo** (corpo e mono, com fallbacks multiplataforma) + justificativa de **sem CDN/VPS** (§4.1).
- [x] **C6** Regra de **números tabulares** (`tabular-nums`/`tnum`) para tabelas e campos numéricos (§4.3).
- [x] **C7** **Estados cobertos**: hover, foco, ativo, desabilitado, carregando, vazio, erro de campo, **alerta/recusa (CE-01..CE-22)** e sucesso (§5.1–§5.2).
- [x] **C8** Mapeamento **todos os 22 CEs** → estado visual → ação sugerida (§5.2).
- [x] **C9** **Tokens nomeados** em bloco `:root` pronto para CSS variables, incluindo aliases por componente (§6).
- [x] **C10** Seção explícita de **pendências de aprovação humana** com IDs (PA-1..PA-7) e recomendação (§8.2).
- [x] **C11** **Correspondência com as 11 telas** dos wireframes (§7.3) + mapa wireframe→token (§7.2).
- [x] **C12** Rastreabilidade: cada decisão cita a origem (ADR-0004, UIUX §, R12, H1, CE, RF, RK-4).
- [x] **C13** Fora de escopo respeitado: **nenhum arquivo fora de `docs/design/ESTILO.md`** foi criado ou alterado; nenhum comando git executado (commit é da coordenação).

---

## 10. Dependências e riscos de escopo

- **Dependência humana:** ~~PA-1..PA-7 (§8.2)~~ — **RESOLVIDA em 2026-10-21** (ADR-0005); o que ainda bloqueia a conclusão da T020 é a **aplicação** do estilo no app e as demonstrações dos CA.
- **Dependência de implementação:** aplicação dos tokens no `apps/web` + criação do stylesheet global — fora deste incremento.
- **Dependência de verificação:** inspeção de contraste em navegador (T021).
- **RK-1 (inflação de escopo):** nenhum componente novo é criado aqui — o documento só colore/pinta os padrões já aprovados (§7.3 lista exatamente as 11 telas).
- **RK-4 (imutabilidade percebida como bloqueio):** mitigado por D-9/P5 — cor de erro não aparece em estorno.
- **RK-6 (papéis):** os estilos não escondem nem expõem ação alguma; a visibilidade por papel continua sendo a matriz da T023 (§5 do `UIUX-DIRETRIZES`) — cor não substitui permissão (a recusa do servidor permanece obrigatória).
- **Risco de deriva:** se a implementação quiser trocar a paleta no meio da T020, o custo é alto — por isso PA-1/PA-2 devem ser respondidas **antes** de aplicar o estilo nas telas.
