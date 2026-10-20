# Diretrizes de UI/UX — Sistema Contábil (MVP)

- **Documento:** `docs/design/UIUX-DIRETRIZES.md`
- **Tarefa:** T023 / TASK-023 (product-analyst)
- **Data:** 2026-10-20
- **Status:** rascunho para **aprovação humana** — a T020 (frontend) só começa depois desta aprovação
- **Fontes:** `docs/requirements/SISTEMA-CONTABIL.md` (v3) · `docs/plans/PLAN-IMPLEMENTACAO.md` (T020/T023) · decisões de design aprovadas pelo usuário em 2026-10-20
- **Companion:** `docs/design/wireframes/` (11 telas + índice, HTML+CSS puro, abre por `file://` sem servidor e sem build)

> **Nota de escopo:** este documento define **arquitetura de informação, padrões e feedback**. Ele **não** define paleta de cores, tipografia final nem acabamento visual — isso é fase de estilo, depois da aprovação da estrutura. Nenhum item aqui cria funcionalidade sem requisito (guarda contra RK-1).

---

## 1. Problema e resultado esperado

**Problema:** a T020 (frontend de todas as telas em pt-BR) precisa partir de uma estrutura aprovada; decidir estrutura em código é caro de reverter e abre espaço para inflar escopo (RK-1) ou contradizer as decisões de papel (F13) e imutabilidade (R9).

**Resultado esperado:** um documento de diretrizes + 11 wireframes navegáveis que permitem ao usuário aprovar, tela por tela, a arquitetura de informação, os padrões de tela, a matriz de visibilidade por papel e as mensagens de recusa — **antes** de o frontend existir.

**Usuários/fluxos afetados:** os 2 papéis (administrador, contador — §3.1) e os 7 fluxos (§3.2); nenhuma alteração de requisito ou de código.

---

## 2. Decisões de design aprovadas (2026-10-20) — não redesbundir

Registradas aqui como **fatos de design** para orientar a implementação:

1. **Referência híbrida por componente:**
   - grid de dados denso, estilo planilha → plano de contas, lançamentos, razão, balancete/balanço, títulos, extrato;
   - conciliação estilo internet banking → marcar item ↔ conciliar, retomável;
   - formulários em coluna com validação visível → todos os cadastros e operações (SaaS moderno).
   - Proibido clonar produto alheio ou propor features de ERP grande.
2. **Densidade "denso no dado, calmo na forma":** tabelas densas, números à direita com fonte tabular, **linha de totais fixa no rodapé do grid**, filtros persistentes, badges de situação (aberto/parcial/pago/cancelado); formulários com mais respiro e validação campo a campo. Desktop-first **>= 1280px** (R12).
3. **Orientação de erro:** toda recusa (CE-01..CE-22) exibe mensagem **específica** + **ação sugerida**; para lançamentos imutáveis a ação sugerida é **"estornar"** (mitigação de RK-4: estorno é o caminho normal, não um problema).
4. Valores em **BRL com 2 casas** e máscara brasileira (`R$ 1.234,56`); interface **pt-BR** (H1).

---

## 3. Arquitetura de informação

### 3.1 Estrutura global

```
Login (RF-03/RF-19)
 └── Aplicação logada
      ├── Barra superior: marca · seletor de empresa (RF-04) · papel · Sair
      ├── Menu lateral (varia por papel — §3.2)
      └── Área de conteúdo: 11 telas (§7)
```

- **Seletor de empresa:** fixo na barra superior em toda tela operacional. O contador só lista as empresas atribuídas (RF-04, CA-20); o administrador pode escolher qualquer empresa — essa leitura é **auditada** e marcada visualmente com o rótulo "leitura global auditada" (F13, RF-05, CA-34).
- **Contador sem atribuição** vê a lista de empresas vazia com o estado vazio explicativo (CA-23) — sem botão de escrita.
- **Empresa inativa:** selecionável para consulta (histórico legível — CA-40), com faixa de aviso e ações de escrita ocultas/recusadas (CE-20).
- Não existe **tela inicial/dashboard** nos requisitos (ver pergunta Q-UI-3, §10): o menu leva direto às 11 telas.

### 3.2 Mapa de navegação (menu × papel)

| Item do menu | Tela | Administrador | Contador (atribuído) |
|---|---|---|---|
| Empresas | empresas | ✔ gestão (criar, ativar/inativar) | ○ somente as atribuídas (leitura) |
| Usuários e atribuições | usuarios | ✔ gestão completa | — **não exibido** (CA-21) |
| Plano de contas | plano-contas | ○ leitura global auditada | ✔ leitura + escrita (RF-06) |
| Períodos contábeis | periodos | ○ leitura (sem encerrar — CA-31/CA-32) | ✔ leitura + encerrar período/exercício (RF-09) |
| Lançamentos | lancamentos | ○ leitura (sem escrita — CA-33) | ✔ leitura + novo/estornar (RF-07/RF-08) |
| Títulos | titulos | ○ leitura (sem escrita — CA-33) | ✔ leitura + novo/baixa/estorno/cancelar (RF-13/RF-14/RF-24) |
| Conciliação | conciliacao | ○ leitura (hipótese H-UI-4) | ✔ importar/conciliar/desconciliar (RF-16) |
| Relatórios | relatorios | ✔ emitir + exportar (leitura global, CA-34; ver H-UI-3) | ✔ emitir + exportar (RF-10..RF-12, RF-17, RF-18) |
| Fiscal | fiscal | ✔ configuração de tabelas/regime/multa-juros (RF-20, CA-54) | ✔ configuração (contador autorizado) + apuração DAS/retenções (RF-21..RF-23) |
| Auditoria | auditoria | ✔ consultar trilha (RF-05, CA-39) | — **não exibido** (CA-21) |
| Sair | login | ✔ | ✔ |

Legenda: ✔ ação disponível · ○ somente leitura · — item/ação não exibida (e recusada no servidor: CA-21 para contador, CA-33 para admin).

**Regra de ouro (F13):** o administrador **não vê nenhuma ação de escrita contábil** (lançamentos, baixas, estornos, encerramentos de período/exercício, plano de contas, conciliação). Ele vê as telas em modo leitura, com o distintivo `somente-leitura` na barra de ações. O contador **não vê** gestão de usuários nem trilha de auditoria.

---

## 4. Padrões de tela

### 4.1 Padrão A — Grid de dados denso (estilo planilha)

Aplicação: plano de contas, lançamentos, títulos, períodos, extrato da conciliação, relatórios tabulares, auditoria.

Estrutura, de cima para baixo:
1. **Cabeçalho da tela:** título + chips de RF/CA; ações do papel (ex.: `+ Novo lançamento` — só contador).
2. **Filtros persistentes:** linha de filtros fixa acima do grid (empresa, período/data, situação, busca). Filtros sobrevivem à navegação de volta à tela (retomabilidade, coerente com CE-08).
3. **Grid:** cabeçalho grudento no topo do painel (`position: sticky`), linhas com padding curto, **números alinhados à direita com fonte tabular**, colunas de data em `dd/mm/aaaa`.
4. **Linha de totais fixa no rodapé do grid** (`tfoot` sticky): somatórios sempre visíveis durante a rolagem — exigência da densidade aprovada e base dos CAs numéricos (CA-04, CA-05, CA-09).
5. **Paginação/contador de registros** no rodapé ("Mostrando 1–50 de 312").

Estados do grid: **vazio** (ilustração textual + ação primária contextual), **carregando** (esqueleto de linhas, não spinner genérico), **erro** (mensagem + `Tentar novamente`), **sem permissão** (mensagem neutra, sem dados — CE-12).

### 4.2 Padrão B — Formulário em coluna (calmo na forma)

Aplicação: nova empresa, novo usuário, nova conta, novo lançamento, nova baixa, importação de extrato, configuração fiscal.

- Uma coluna principal (~720px), grupos separados por seção com título; **espaço entre campos maior que no grid** (respiro aprovado).
- **Validação campo a campo:** a validação aparece **sob o campo**, com mensagem específica e o valor esperado (ex.: `CNPJ 12.345.678/0001-90 já cadastrado em "Alfa Ltda".` — CE-06). Campo inválido: borda destacada + foco no primeiro inválido.
- Erros que não pertencem a um campo (ex.: lançamento desbalanceado — CE-01) viram **banner no topo do formulário** com a diferença calculada.
- Botões no rodapé do formulário: `Secundário (Cancelar)` à esquerda, `Primário (Gravar)` à direita — **um primário por contexto**.
- Valores monetários com máscara `R$ 1.234,56` e alinhamento à direita mesmo em campo de edição; datas com máscara `dd/mm/aaaa`.
- Linhas de partidas (lançamento): tabela editorial densa dentro do formulário (débito/crédito por linha) + **faixa de totalizadores débito/crédito fixa** com indicador de equilíbrio (`Débitos R$ 1.000,00 = Créditos R$ 1.000,00`).

### 4.3 Padrão C — Diálogo de confirmação

Usado **apenas** para ações com efeito amplo: estorno (lançamento e de baixa), encerrar período, encerrar exercício, cancelar título, inativar conta/empresa/usuário.

- Título claro do que será feito; parágrafo explicando o **efeito concreto** (ex.: "O título volta a 'aberto' com saldo de R$ 500,00 e um lançamento de estorno será gerado e vinculado.").
- Sempre com a ação primária + `Voltar`.
- **Estorno não é tratado como destrutivo:** o diálogo usa linguagem neutra de rotina ("Reverter esta baixa"), nunca "atenção: esta ação não pode ser desfeita" (RK-4).
- Nenhuma ação de exclusão dura de lançamento, evento de trilha ou empresa existe (R9, R11, H13) — os diálogos nunca oferecem "Excluir" nesses casos.

### 4.4 Padrão D — Conciliação (estilo internet banking)

- Duas colunas: **extrato (esquerda)** ↔ **títulos/lançamentos (direita)**; seleção por marcação (`checkbox`-like) em cada lado.
- Estado **parcial e retomável:** cabeçalho com progresso `2 conciliados · 1 pendente` persistido entre sessões (CE-08/CA-08); item conciliado aparece travado com ação `Desconciliar` (CE-09).
- Ações: `Conciliar selecionados`, `Desconciliar`, `Importar extrato (OFX/CSV)`, `Lançar item manual`.
- Item conciliado a dois objetos é bloqueado até desconciliar (CE-09 → mensagem + ação `Desconciliar`).

### 4.5 Estados transversais

| Estado | Padrão visual | Onde se aplica |
|---|---|---|
| Vazio | Título + texto explicando por quê + ação primária contextual | sem empresas (CA-23), sem lançamentos, sem itens de extrato, período sem eventos (CA-39) |
| Carregando | Esqueleto de linhas no grid / blocos no formulário; botão primário desabilitado com rótulo "Gravando…" | toda carga e submissão |
| Erro | Mensagem específica + ação sugerida + `Tentar novamente` (quando repetível) | CE-10, CE-01..CE-22 (§6) |
| Sem permissão | Mensagem neutra "Você não tem permissão para esta ação." **sem expor dados** | CE-12, CE-15, CE-21 |
| Sessão expirada | Redireciona ao login com aviso "Sessão expirada — nada do formulário foi gravado." | CE-11 |
| Somente leitura | Barra de ações com distintivo `somente-leitura` e ações de escrita ausentes | admin nas telas contábeis; empresa inativa |

---

## 5. Matriz de visibilidade por papel (ação × papel)

`✔` = ação exibida e permitida · `○` = apenas leitura (ação ausente da UI **e** recusada no servidor) · `—` = ausente e recusada.

| Tela | Ação | Administrador | Contador | Base |
|---|---|:-:|:-:|---|
| Login | Autenticar, bloqueio por tentativas | ✔ | ✔ | RF-03, RF-19, CA-51 |
| Empresas | Ver lista | ✔ (todas, auditada) | ○ (só atribuídas) | RF-01, RF-04, CA-20, CA-34 |
| Empresas | Criar/editar situação ativa-inativa | ✔ | — | RF-01 (gestão), F13 |
| Usuários | Criar usuário, papel, atribuir empresas, desativar | ✔ | — (tela não exibida) | RF-02, RF-03, CA-21, CA-22 |
| Plano de contas | Consultar | ✔ (global, auditada) | ✔ | RF-06, F13 |
| Plano de contas | Criar conta, inativar conta | ○ (sem escrita) | ✔ | RF-06 + F13 (ver H-UI-1) |
| Períodos | Consultar | ✔ | ✔ | RF-09 |
| Períodos | Encerrar período / encerrar exercício | — | ✔ | RF-09, CA-31, CA-32 |
| Lançamentos | Consultar | ✔ (global, auditada) | ✔ | RF-07, CA-34 |
| Lançamentos | Novo lançamento / estornar | — (sem escrita) | ✔ | RF-07, RF-08, CA-33 |
| Títulos | Consultar | ✔ (global, auditada) | ✔ | RF-13/RF-14 |
| Títulos | Novo título / baixa / estorno de baixa / cancelar | — | ✔ | RF-13, RF-24, CA-33 |
| Conciliação | Consultar extrato e conciliação | ○ (ver H-UI-4) | ✔ | RF-16 |
| Conciliação | Importar extrato / conciliar / desconciliar | — | ✔ | RF-16, CA-53 |
| Relatórios | Emitir balancete/razão/balanço/fluxo | ✔ | ✔ | RF-10..RF-12, RF-17, CA-34 |
| Relatórios | Exportar arquivo | ✔ (ver H-UI-3) | ✔ | RF-18, CA-11 |
| Fiscal | Configurar tabelas/alíquotas, regime, multa/juros | ✔ | ✔ (contador autorizado) | RF-20, CA-54, CE-21 |
| Fiscal | Apurar DAS, gerar lançamento de apuração | — (gera escrita contábil) | ✔ | RF-21, RF-15, F13 |
| Auditoria | Consultar trilha (empresa + período) | ✔ | — (tela não exibida) | RF-05, CA-39, CA-21 |
| Auditoria | Editar/remover eventos | — (não existe ação) | — | RF-05, R11, CE-16 |

**Verificação contra F13/CA-33:** nenhuma linha do admin tem escrita contábil. **Contra CA-21:** nenhuma linha do contador inclui usuários ou auditoria.

---

## 6. Mapeamento CE-01..CE-22 → padrão de feedback visual

### 6.1 Padrões de feedback (FB)

| # | Padrão | Formato |
|---|---|---|
| **FB-1** | Erro de campo (inline) | Mensagem sob o campo, borda destacada, foco no primeiro inválido |
| **FB-2** | Banner de validação do formulário | Topo do formulário, com valores/diferença e links aos campos |
| **FB-3** | Recusa de ação in-contexto | Aviso junto à ação/título: mensagem específica + **ação sugerida** |
| **FB-4** | Diálogo de confirmação explicativo | Efeito concreto + ação primária + Voltar |
| **FB-5** | Negação de acesso / tela de login | Mensagem neutra (sem dados) em login ou área restrita |
| **FB-6** | Falha de dependência | "Nada foi gravado" + `Tentar novamente` |
| **FB-7** | Estado parcial persistido (retomável) | Indicador de progresso salvo; retomada sem perda |

### 6.2 Tabela CE-01..CE-22

> Rótulo: os requisitos nomeiam os nove primeiros casos como `CE-1`..`CE-9`; aqui usamos a forma com zero à esquerda (`CE-01`..`CE-09`) para a numeração contínua `CE-01..CE-22`. `CE-14` e `CE-20` compartilham a mesma linha por descreverem o mesmo cenário (ver nota ao fim da tabela).

| CE | Onde aparece na UI | Padrão | Mensagem (exemplo, pt-BR) | Ação sugerida |
|---|---|---|---|---|
| CE-01 | Novo lançamento (banner) | FB-2 | "Lançamento desbalanceado: débitos R$ 100,00 × créditos R$ 90,00 — diferença de R$ 10,00." | Ajustar as partidas até equilibrar (nada foi gravado) |
| CE-02 | Novo lançamento (campos) | FB-1 | "Informe a conta da partida 2." / "O valor deve ser maior que zero." / "Data inválida (use dd/mm/aaaa)." | Corrigir o campo indicado |
| CE-03 | Novo lançamento/estorno (banner) | FB-3 | "O período 03/2026 está encerrado: nada é gravado em período encerrado." | Usar data em período aberto; correção de lançamento gravado só por **estorno** |
| CE-04 | Tela de detalhe do lançamento | FB-3 (+ ausência da ação) | "Lançamento gravado não pode ser editado nem excluído. **Caminho normal de correção: Estornar.**" | `Estornar` (ação primária da tela) — **RK-4** |
| CE-05 | Ao tentar estornar 2ª vez | FB-3 | "Este lançamento já foi estornado em 10/04/2026 (L-0042)." | Ver lançamento de estorno vinculado |
| CE-06 | Nova empresa (campos) | FB-1 (+FB-2) | "CNPJ 12.345.678/0001-90 já cadastrado em "Alfa Ltda"." / "Razão social é obrigatória." | Corrigir o campo; link para a empresa existente |
| CE-07 | Baixa de título (campo + estado) | FB-1 / FB-3 | "O valor informado (R$ 600,00) excede o saldo de R$ 300,00." / "Título pago não aceita nova baixa." | Ajustar valor; para reabrir título pago → **Estornar a baixa** (RK-4) |
| CE-08 | Conciliação | FB-7 | Cabeçalho: "3 itens — 2 conciliados · 1 pendente (progresso salvo)." | Continuar conciliando quando quiser |
| CE-09 | Ao vincular item já conciliado | FB-3 | "Item já conciliado ao lançamento L-0042. Desconcilie antes de vincular a outro objeto." | `Desconciliar` |
| CE-10 | Qualquer gravação | FB-6 | "Falha ao gravar — nada foi registrado. Tente novamente." | `Tentar novamente`; se persistir, verificar o sistema |
| CE-11 | Redirecionamento ao login | FB-5 | "Sessão expirada após inatividade. A operação interrompida não foi gravada." | Entrar novamente e repetir a operação |
| CE-12 | Área/tentativa restrita | FB-5 | "Você não tem permissão para esta ação." (sem citar dados da outra empresa) | Voltar; evento fica na trilha |
| CE-13 | Plano de contas (ação excluir) | FB-4 | "A conta "Fornecedor" possui lançamentos e não pode ser excluída. O caminho permitido é inativar." | `Inativar` |
| CE-14 / CE-20 | Tela com empresa inativa | FB-3 (+ faixa no topo) | "Empresa inativa: não aceita novos lançamentos ou títulos. O histórico continua consultável." | Consultar histórico; admin pode reativar (RF-01) |
| CE-15 | Tentativa de escrita cruzada | FB-5 | "Escrita recusada: esta empresa não está atribuída a você." | Gerir atribuições com o administrador |
| CE-16 | Auditoria | FB-3 | "A trilha de auditoria é somente leitura: não existe edição ou remoção." (nenhuma ação na UI) | Consultar por empresa/período |
| CE-17 | Login | FB-5 | "Acesso bloqueado após 5 tentativas falhas. Tente novamente em 15 minutos (H16) ou contate o administrador." | Aguardar/contatar admin; evento auditado |
| CE-18 | Estorno de baixa (recusa) | FB-3 + link | "O lançamento vinculado está conciliado. **Desconcilie-o antes de estornar a baixa.**" | `Ir para conciliação` → depois **Estornar** (RK-4) |
| CE-19 | Fiscal / baixa | FB-1 / FB-3 | "A alíquota deve ser um número maior ou igual a zero." / "Empresa sem regime Simples Nacional configurado — DAS não apurado." | Corrigir alíquota; configurar regime em Fiscal (RF-20) |
| CE-21 | Fiscal (sem permissão) | FB-5 | "Você não tem permissão para alterar a configuração fiscal desta empresa." | Tentativa registrada na trilha |
| CE-22 | Estorno de baixa (recusa) | FB-3 | "A baixa pertence ao período 03/2026 (encerrado): estorno recusado e o título permanece inalterado." | Em período aberto o estorno é normal; tentativa auditada |

> Sobreposições herdadas dos requisitos: **CE-14 e CE-20** descrevem o mesmo cenário (empresa inativa) em níveis diferentes (estado × recusa) e compartilham o mesmo feedback. **CE-12/CE-15** usam a mesma mensagem neutra de negação.

### 6.3 Orientação ao estorno (RK-4) — regras obrigatórias de redação

1. Toda recusa relacionada a **lançamento gravado ou baixa** termina apontando **Estornar** como a ação correta — nunca "entre em contato", "corrija o registro" ou "exclua".
2. **Nenhuma tela** oferece "editar"/"excluir" lançamento, título já baixado, evento de trilha ou empresa (R9, R11, H13): as ações simplesmente não existem, e a tentativa direta responde FB-3 com o caminho do estorno.
3. O **Estornar** é ação primária visível na linha/detalhe (não escondida em menus), com ícone de reversão textual ("Reverter"), não de alerta.
4. Diálogos de estorno explicam o **efeito reversível** (título reabre, lançamento de estorno é gerado e vinculado) — reforçando que estorno é rotina (CA-10, CA-42, CA-43).

---

## 7. Convenções

| Tema | Convenção |
|---|---|
| Idioma | pt-BR em toda a interface e relatórios (H1) |
| Datas | `dd/mm/aaaa` na entrada e exibição; data/hora da trilha `dd/mm/aaaa HH:MM:SS` |
| Valores | BRL, 2 casas, máscara `R$ 1.234,56`; sempre alinhados à direita com fonte tabular; **sem moeda estrangeira** (H7) |
| Saldos contábeis | natureza explícita por sufixo `D`/`C` (não cor negativa), conforme Balancete/Razão (RF-10, RF-11) |
| Botões | **Primário** = um por contexto, fundo escuro (`Gravar`, `Conciliar`, `Confirmar`); **Secundário** = contorno (`Cancelar`); **Fantasma** = texto sublinhado para ações alternativas (`Estornar`, `Inativar`, `Desconciliar`) |
| Ações destrutivas | Só em diálogo explicativo: cancelar título, inativar conta/empresa/usuário, encerrar período/exercício. **Estorno não é destrutivo** (§6.3) |
| Badges de situação | `aberto` (contorno), `parcialmente pago` (contorno tracejado), `pago` (preenchido), `cancelado` (riscado); `conciliado`/`pendente`; `ativo`/`inativo`; `somente-leitura` |
| Mensagens | Estrutura fixa: **o que houve** (específico, com valores) + **o que fazer** (ação sugerida). Sem mensagens genéricas tipo "erro ao salvar" |
| Filtros | Sempre visíveis no topo do grid; limpar filtros é ação explícita |
| Responsividade | Desktop-first, largura mínima **1280px** (R12); abaixo disso, rolagem horizontal — sem reflow mobile no MVP |
| Referências | Chips `RF-xx · CA-xx` nas áreas dos wireframes; nenhuma ação sem requisito (guarda RK-1) |

---

## 8. Wireframes — índice das 11 telas

Diretório: `docs/design/wireframes/` — abrir `index.html` por `file://` (sem servidor, sem build, sem JS de aplicação; apenas âncoras nativas).

| # | Arquivo | Tela | RF principal | CA demonstrados na tela | Conteúdo do arquivo |
|---|---|---|---|---|---|
| 1 | `login.html` | Login e acesso | RF-03, RF-19 | CA-19, CA-50, CA-51, CA-52 (CE-11, CE-17) | credenciais, avisos de sessão expirada/bloqueio |
| 2 | `empresas.html` | Empresas | RF-01, RF-04 | CA-01, CA-15 (CE-06), CA-40 (CE-20) | grid + formulário novo + estados |
| 3 | `usuarios.html` | Usuários e atribuições | RF-02, RF-03 | CA-02, CA-22, CA-50 (CE-12) | grid + formulário com papel/atribuição; só admin |
| 4 | `plano-contas.html` | Plano de contas | RF-06 | CA-17, CA-27 (CE-13) | grid hierárquico + formulário + recusa de exclusão |
| 5 | `periodos.html` | Períodos contábeis | RF-09 | **CA-31, CA-32** [D], CA-24 (CE-03, CE-22) | 12 períodos + encerrar período/exercício |
| 6 | `lancamentos.html` | Lançamentos | RF-07, RF-08 | **CA-10** [D], CA-03, CA-13, CA-25 (CE-01..CE-05) | grid + novo lançamento (partidas) + diálogo de estorno |
| 7 | `titulos.html` | Títulos a pagar/receber | RF-13..RF-15, RF-22..RF-24 | **CA-06, CA-07** [D], CA-41..CA-43, CA-47, CA-48 (CE-07, CE-18, CE-22) | grid + baixa (impostos/multa/juros) + estorno de baixa |
| 8 | `conciliacao.html` | Conciliação bancária | RF-16 | CA-08, CA-28, CA-44, CA-53 (CE-08, CE-09) | extrato ↔ objetos, importação OFX/CSV, retomável |
| 9 | `relatorios.html` | Relatórios | RF-10..RF-12, RF-17, RF-18 | CA-04, CA-05, CA-09, CA-11, CA-34 | abas balancete/razão/balanço/fluxo + exportar |
| 10 | `fiscal.html` | Fiscal | RF-20..RF-23 | CA-45..CA-49, CA-54 (CE-19, CE-21) | tabelas, regime/DAS, retenções, multa/juros |
| 11 | `auditoria.html` | Trilha de auditoria | RF-05 | **CA-12**, CA-39, CA-38 (CE-16), CA-52 | filtros empresa+período, somente leitura, só admin |

Cada área dos wireframes carrega chip visível + comentário HTML com o RF/CA de origem. Não há botão, campo ou ação fora de RF-01..RF-24.

---

## 9. Hipóteses de UI (reversíveis, de baixo impacto)

| # | Hipótese | Base | E se estiver errada |
|---|---|---|---|
| **H-UI-1** | Escrita em **plano de contas** e **encerramento** é exclusiva do contador (admin só lê). | F13 + fluxo 1 ("o contador define períodos e plano de contas"); RF-02 cita "razão/financeiro" mas CA-33 usa plano de escrita contábil ampla | Se o admin puder gerir plano de contas, muda só a matriz §5 e os chips da tela |
| **H-UI-2** | **Títulos** são uma única tela com filtro `Pagar/Receber`, não duas telas. | RF-13/RF-14 são paralelos ("idem") | Viram 2 itens de menu (aumenta o nº de telas, sem mudar padrões) |
| **H-UI-3** | **Exportar** (RF-18) é ação de leitura e também do administrador. | CA-34 concede leitura global; exportar não escreve no razão | Se restrito ao contador, remove-se o ✔ da matriz §5 |
| **H-UI-4** | **Conciliação** aparece para o admin em modo somente-leitura. | F13 (leitura global auditada) | Se preferir ocultar, remove-se o item do menu do admin |
| **H-UI-5** | **Relatórios** são uma tela com 4 abas (âncoras), não 4 telas. | RF-18 trata os 4 como conjunto exportável | Viram 4 itens de menu, mesmo padrão de grid |
| **H-UI-6** | **Fiscal** é uma tela com seções (tabelas, regime/DAS, retenções, multa/juros) navegadas por âncoras. | RF-20..RF-23 formam um bloco de configuração | Pode separar em subtelas sem alterar conteúdo |

---

## 10. Perguntas que precisam de resposta humana

BLOQUEANTES para a aprovação da estrutura (afetam escopo ou comportamento):

1. **Q-UI-1 — "Contador autorizado" para configuração fiscal (RF-02/RF-20):** como a autorização é concedida e representada na tela de usuários? Opções: (a) marca/flag por usuário "autorizado a configurar fiscal", (b) papel adicional, (c) por atribuição específica à empresa. **Sem esta resposta, a tela `usuarios.html` e a matriz §5 ficam com um campo/coluna ainda a definir.**
2. **Q-UI-2 — Cadastro de contas bancárias (RF-16):** o RF diz "a empresa possui contas bancárias próprias", mas não há RF de criação/cadastro dessas contas — a conciliação precisa de um seletor de conta bancária, e esse seletor pressupõe alguém criando-as. Existe essa ação no MVP? Em qual tela? **Se não, a conciliação fica por empresa sem o seletor.**
3. **Q-UI-3 — Tela inicial (dashboard/KPIs):** não existe nos requisitos e os wireframes não criam uma (guarda RK-1). O MVP pode começar direto no menu, ou há expectativa de uma home? **Criar uma home é escopo novo (novo RF).**

Não bloqueantes (registradas como hipóteses §9 — mudam só chips/itens de menu se refutadas): H-UI-1..H-UI-6.

---

## 11. Dependências e riscos de escopo

- **Dependência:** aprovação humana deste documento + wireframes é pré-condição da T020 (plano §2.7 e §3).
- **RK-1 (inflação de escopo):** mitigado por chips RF/CA em cada área; nenhum botão fora de RF-01..RF-24.
- **RK-4 (imutabilidade percebida como bloqueio):** mitigado pela §6.3 (estorno como caminho normal).
- **RK-6 (segurança/papéis):** mitigado pela matriz §5 — a UI não oferece ação proibida (CA-21, CA-33); a recusa no servidor continua obrigatória.
- **Fora desta etapa:** paleta, tipografia, ícones, microinterações; qualquer código de produto; alteração de requisitos/planos.

---

## 12. Checklist de revisão para o usuário

> Aprovação **tela por tela**. Marcar `Aprovado` / `Ajuste: …`. Esta é a base da aprovação humana que habilita a T020.

### Global (aprovar uma vez)

- [ ] **G1** — Densidade "denso no dado, calmo na forma": grids densos com números à direita/fonte tabular, **linha de totais fixa no rodapé**, filtros persistentes; formulários respiados com validação campo a campo (§4.1, §4.2).
- [ ] **G2** — Desktop-first **>= 1280px**, pt-BR, BRL `R$ 1.234,56`, datas `dd/mm/aaaa` (§7).
- [ ] **G3** — Menu por papel (§3.2): admin vê gestão + auditoria e telas contábeis em modo leitura; contador vê rotina sem usuários/auditoria.
- [ ] **G4** — Matriz de visibilidade (§5): **admin sem nenhuma ação de escrita contábil** (F13/CA-33); **contador sem gestão de usuários e trilha** (CA-21). Confirmar as hipóteses H-UI-1, H-UI-3, H-UI-4.
- [ ] **G5** — Padrões de feedback CE-01..CE-22 (§6.2) e redação de estorno (§6.3, RK-4).
- [ ] **G6** — Estados vazio/carregando/erro/somente-leitura/sessão expirada (§4.5).
- [ ] **G7** — Respostas às perguntas Q-UI-1, Q-UI-2, Q-UI-3 (§10).

### Tela a tela

- [ ] **T1 `login.html`** — campos, avisos de sessão expirada (CE-11) e bloqueio após 5 tentativas (CE-17). Algum elemento extra esperado (ex.: "esqueci a senha")? *Obs.: não há RF para recuperação de senha — hoje é ação do administrador.*
- [ ] **T2 `empresas.html`** — grid + formulário (razão social, CNPJ, situação); ativar/inativar **sem exclusão dura** (H13); estados de CNPJ inválido/duplicado (CE-06) e empresa inativa (CE-20).
- [ ] **T3 `usuarios.html`** — criação com papel, atribuição a empresas, desativar; senha segue a política de 8 caracteres (H15/CA-50). **Depende de Q-UI-1** (autorização fiscal).
- [ ] **T4 `plano-contas.html`** — grid hierárquico (pai/filho), tipo e situação; "inativar" no lugar de "excluir" (CE-13). Confirmar H-UI-1 (admin escreve ou só lê).
- [ ] **T5 `periodos.html`** — 12 períodos do ano com situação; encerrar período e encerrar exercício (CA-31/CA-32); ações ocultas para o admin. Exibição do ano-calendário atende ou precisa de seletor de exercício?
- [ ] **T6 `lancamentos.html`** — grid denso; novo lançamento com partidas e faixa de equilíbrio (CE-01); diálogo de estorno (CA-10); ausência total de editar/excluir (CE-04).
- [ ] **T7 `titulos.html`** — badges aberto/parcial/pago/cancelado; baixa com impostos, retenções, multa/juros (CA-47, CA-48); estorno de baixa com recusas CE-18 e CE-22. Confirmar H-UI-2 (uma tela com filtro ou duas).
- [ ] **T8 `conciliacao.html`** — duas colunas extrato ↔ objetos, progresso retomável (CE-08), desconciliar (CE-09), importação OFX/CSV (CA-53). **Depende de Q-UI-2** (contas bancárias).
- [ ] **T9 `relatorios.html`** — 4 abas (balancete/razão/balanço/fluxo) com FIX-01 nos totais, exportar (CA-11). Confirmar H-UI-5 (abas) e H-UI-3 (admin exporta).
- [ ] **T10 `fiscal.html`** — tabelas de alíquota (≥0, CE-19), regime/DAS (CA-46/CA-49), retenções, multa/juros; permissão de configuração (CE-21/CA-54); apuração só pelo contador. Confirmar H-UI-6.
- [ ] **T11 `auditoria.html`** — filtros empresa + período (CA-39), somente leitura sem ações de editar/remover (CE-16/CA-38), eventos de acesso (CA-52); visível só para o admin (CA-21).

### Fora do que este documento decide (não revisar agora)

Paleta, tipografia, ícones, animações e copy final de marketing de tela — fase de estilo após a aprovação da estrutura.
