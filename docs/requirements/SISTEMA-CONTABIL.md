# Requisitos — Sistema Contábil (MVP)

- **Documento:** docs/requirements/SISTEMA-CONTABIL.md
- **Tarefa:** TASK-002 (product-analyst)
- **Data:** 2026-10-19
- **Status:** rascunho — 3ª rodada (ajustes pontuais da re-inspeção aplicados)
- **Rodadas:** v1 (2026-10-19) primeira escrita; **v2 (2026-10-19)** decisões PB-1..PB-4 e achados I1..I5 / M1..M11 aplicados; **v3 (2026-10-19)** ajustes pontuais da re-inspeção (achados menores 1..3): encerramento de períodos/exercício só pelo contador, fronteira de permissão da configuração fiscal e recusa de estorno de baixa em período encerrado.
- **Nota de renumeração:** nenhum RF ou CA existente foi renumerado. A 2ª rodada acrescentou **RF-19..RF-24**, **CA-32..CA-53** e a fixture **FIX-01**; a 3ª rodada acrescentou **CA-54**, **CA-55**, **CE-21** e **CE-22**; alguns RF/CA/CE existentes foram editados no texto (ver retorno da tarefa).
- **Nota de escopo:** este documento define requisitos de produto e critérios de aceite. Ele **não** escolhe stack, framework, banco de dados ou provedor (etapa de arquitetura, TASK-003).

---

## 1. Objetivo

**Problema:** um escritório contábil que atende vários clientes precisa de um sistema para registrar e consultar o financeiro e a contabilidade dessas empresas em um só lugar, com as práticas usuais do Brasil.

**Resultado esperado (MVP):** aplicação web, multiempresas, usada pela equipe do escritório, em que o contador consegue:

1. manter plano de contas e lançamentos em partidas dobradas por empresa;
2. emitir balancete, razão e balanço patrimonial;
3. registrar e dar baixa em contas a pagar e a receber, com cálculo de impostos configuráveis, Simples Nacional (DAS), retenções na fonte e multa/juros de atraso (decisão PB-4);
4. conciliar lançamentos com o extrato bancário (manual ou por importação de arquivo);
5. consultar fluxo de caixa;

com autenticação (incluindo política de senha e limite de tentativas), isolamento de dados entre empresas e trilha de auditoria desde a primeira versão. O administrador gerencia empresas/usuários e tem leitura global auditada, mas não escreve dados contábeis (F13).

---

## 2. Fatos confirmados (intake e respostas de 2026-10-19)

Estes itens foram confirmados pelo usuário e **não** são hipóteses. Nada além do que está aqui é tratado como fato.

| # | Fato |
|---|------|
| F1 | Contexto de uso: escritório contábil multiempresas (contador/escritório gerenciando vários clientes). |
| F2 | Escopo base da primeira versão: plano de contas, lançamentos débito/crédito (partidas dobradas), balancete, razão, balanço patrimonial, contas a pagar/receber, conciliação bancária e fluxo de caixa. |
| F3 | Plataforma: aplicação web (interface em navegador, backend e banco de dados). |
| F4 | Jurisdição: Brasil, com aderência prática brasileira (PCASP). Obrigações fiscais (SPED, ECD/ECF) ficam **fora** do MVP, apenas como evolução prevista. |
| F5 | O código viverá na subpasta `sistema-contabil/` deste repositório; o framework da squad permanece na raiz. |
| F6 | Sem restrição de stack declarada e sem exigência de serviços pagos. |
| F7 | Dados contábeis de múltiplos clientes no mesmo sistema: autenticação, isolamento por empresa e trilha de auditoria são exigidos no MVP; partidas lançadas não podem ser alteradas/excluídas silenciosamente (estornos são o caminho normal). |
| F8 | Não existia produto nem requisitos escritos anteriormente — não há comportamento legado a preservar. |
| F9 | **Resposta PB-1 (2026-10-19):** o MVP é usado **somente pela equipe do escritório**; não há contas de clientes. |
| F10 | **Resposta PB-2 (2026-10-19):** conciliação por **lançamento manual de itens + importação de arquivo (OFX/CSV)**; **sem integração por API de banco**. |
| F11 | **Resposta PB-3 (2026-10-19):** **sem boleto, PIX ou CNAB** no MVP — só registrar, dar baixa e cancelar títulos. |
| F12 | **Resposta PB-4 (2026-10-19) — amplia o escopo:** o MVP **deve** calcular: (a) impostos com **tabelas/alíquotas configuráveis pelo escritório**; (b) **Simples Nacional** (DAS sobre o faturamento do período); (c) **retenção na fonte** em títulos (ex.: IRRF/ISS conforme tabela configurável); (d) **multa e juros de atraso configuráveis por título/contrato** (ex.: 2% de multa + 1% a.m.). **Explicitamente fora:** apuração genérica de "tributos por receita" (PIS/COFINS/IRPJ/CSLL por período). |
| F13 | **Decisão I2 (2026-10-19):** o administrador tem **gestão** (empresas, usuários) + **leitura global auditada**, **sem escrita contábil**; escrita contábil exige papel contador **atribuído à empresa**. |
| F14 | **Decisão I5 (2026-10-19):** **estorno de baixa entra no MVP**: desfaz a baixa, reabre o título (parcial ou total), gera lançamento de estorno imutável e registra tudo na trilha de auditoria. |
| F15 | **Decisão M11 (2026-10-19):** entram no MVP **política de senha**, **limite de tentativas de login** e **auditoria de eventos de acesso** (login/sucesso/falha). |

---

## 3. Usuários e fluxos

### 3.1 Usuários identificados

| Papel | Origem | O que precisa fazer |
|-------|--------|---------------------|
| **Administrador do escritório** | Decidido pelo usuário em 2026-10-19 (F13), formalizando a H6 | Causar empresas (clientes), gerenciar usuários e atribuições, consultar dados de qualquer empresa (**leitura global, auditada**) e consultar a trilha de auditoria. **Não** grava dados contábeis. |
| **Contador / operador contábil** | Decidido pelo usuário em 2026-10-19 (F13), formalizando a H6 | Trabalhar nas empresas **atribuídas**: plano de contas, lançamentos, relatórios, títulos (com impostos/multa/juros), conciliação e fluxo de caixa. |
| ~~Usuário do cliente~~ | **Fora do MVP** — PB-1 respondida negativamente (F9) | Não existe nesta versão. |

> Os papéis são a H6, **confirmada** pela decisão de 2026-10-19 (F9, F13). A separação gestão (sem escrita contábil) × escrita (contador atribuído) é fato (F13), não hipótese.

### 3.2 Fluxos principais (MVP)

1. **Abertura de cliente:** admin cria a empresa (ativa) → atribui contadores → o contador define períodos contábeis e plano de contas.
2. **Configuração fiscal:** administrador ou contador autorizado configura tabelas e alíquotas de impostos, retenções, regras de Simples Nacional e multa/juros de atraso (F12) — configuração administrativa auditada, **não escrita contábil** (RF-02, RF-20; CA-54).
3. **Rotina contábil:** contador registra lançamentos em partidas dobradas → consulta balancete/razão → encerra o período quando o mês fecha → estorna em vez de apagar → ao encerrar o 12º período do ano, encerra o exercício (transferindo resultado ao PL).
4. **Rotina financeira:** contador registra títulos a pagar/receber → dá baixa (o sistema calcula impostos, retenções, e multa/juros de atraso conforme configuração) → gera o lançamento contábil vinculado → em erro, estorna a baixa (reabre o título).
5. **Conciliação bancária:** contador informa o extrato da conta bancária **por lançamento manual ou importação de arquivo (OFX/CSV)** → confronta item a item com títulos/lançamentos → marca conciliados (total ou parcialmente).
6. **Relatórios:** contador emite balanço patrimonial e fluxo de caixa e exporta os relatórios.
7. **Auditoria:** admin consulta quem fez o quê, em qual empresa e quando — inclusive os próprios acessos globais auditados e eventos de login.

---

## 4. Requisitos funcionais

### 4.1 Empresas, usuários e acesso

- **RF-01 — Cadastro de empresas:** o sistema permite ao administrador cadastrar empresas (clientes) com, no mínimo, razão social, CNPJ e situação (ativa/inativa). Apenas empresas ativas aparecem nas rotinas diárias; empresas inativas não aceitam novos lançamentos ou títulos, mas preservam o histórico consultável. **Não existe exclusão dura de empresa no MVP** — apenas ativa/inativa (H13).
- **RF-02 — Usuários, papéis e permissões:** o sistema permite ao administrador criar usuários, definir seu papel (no mínimo: administrador e contador) e atribuí-los a uma ou mais empresas. **O administrador exerce gestão (empresas, usuários, atribuições) e leitura global auditada de dados, mas não possui escrita contábil** (F13): toda escrita que **entra no razão ou no financeiro** (lançamentos, baixas, estornos, encerramentos de período/exercício) exige papel contador **atribuído à empresa** (RF-04). **Fronteira de permissão:** a **configuração fiscal** (tabelas e alíquotas, regras de multa/juros, regime do Simples — RF-20..RF-23) é **configuração administrativa do escritório, não escrita contábil**, podendo ser feita por administrador e por contador autorizado, com toda alteração auditada (RF-05, CA-54).
- **RF-03 — Autenticação:** todo acesso a dados exige credenciais válidas. O administrador pode desativar um usuário (acesso revogado imediatamente na tentativa seguinte). Política de senha, limite de tentativas e auditoria de eventos de acesso: ver RF-19.
- **RF-04 — Isolamento por empresa (tenant):** todo dado consultado ou alterado é filtrado pela(s) empresa(s) à(s) qual(is) o usuário está atribuído. Não há caminho de interface ou requisição que retorne **ou aceite alteração** de dado de uma empresa a um usuário sem atribuição a ela. **Exceção única:** a **leitura** global do administrador (F13), que é auditada (RF-05) e não inclui escrita.
- **RF-05 — Trilha de auditoria:** o sistema registra, de forma **não editável e não removível por nenhuma interface ou ação do produto**, quem fez cada operação relevante: criação/alteração de empresa (situação ativa/inativa; sem exclusão dura, H13), de usuário, atribuição, conta, lançamento, estorno, **baixa e estorno de baixa**, conciliação, importação de extrato, encerramento de período/exercício, configuração de tabelas de impostos e **eventos de acesso (login com sucesso, falha e bloqueio)** — com empresa, identificação do objeto, usuário, data e hora. O administrador pode consultar a trilha **por empresa e por período** (CA-39).

### 4.2 Contabilidade

- **RF-06 — Plano de contas:** por empresa, o sistema mantém plano de contas hierárquico (contas pai e filhas) com código, descrição, tipo (ativo, passivo, patrimônio líquido, receita, despesa) e situação (ativa/inativa), aderente à estrutura do PCASP (ver H5). Conta com lançamentos não pode ser excluída, apenas inativada. Uma conta pai não pode ser inativada enquanto tiver contas filhas ativas.
- **RF-07 — Lançamentos em partidas dobradas:** o sistema registra lançamentos com data, período contábil, histórico e duas ou mais partidas, cada uma com conta, valor e natureza débito ou crédito. **Um lançamento só é gravado se a soma dos débitos for igual à soma dos créditos.** Valores são sempre positivos; a natureza é dada pela coluna débito/crédito (H7).
- **RF-08 — Imutabilidade e estorno:** lançamento gravado não pode ser editado nem excluído por interface. Correção se dá por **estorno**: novo lançamento inverso (débito trocado com crédito), do mesmo valor, vinculado ao original, com data e período abertos. Um lançamento só pode ser estornado uma vez.
- **RF-09 — Períodos contábeis e exercício:** cada empresa tem períodos contábeis mensais com estado aberto ou encerrado. **O exercício são os 12 períodos mensais do ano-calendário; o encerramento do exercício é ação manual executada ao encerrar o 12º período, com transferência do resultado acumulado ao patrimônio líquido** (H12). Com período encerrado, nenhum lançamento (inclusive estorno) é aceito com data naquele período. O encerramento do período zera as contas de resultado do mês para o seguinte. O encerramento de períodos e do exercício é feito **apenas pelo contador com escrita contábil ativa**; **o administrador não encerra períodos nem o exercício, mesmo por ação administrativa** (F13).
- **RF-10 — Balancete:** por empresa e período, o balancete mostra, por conta, débitos do período, créditos do período, saldo devedor/credor e acumulado até o período, mais totais gerais — com a garantia de que total de débitos = total de créditos em qualquer momento.
- **RF-11 — Razão:** por empresa, conta e intervalo de datas, o razão lista cada lançamento que afetou a conta (data, histórico, contrapartes, débito, crédito, saldo corrente).
- **RF-12 — Balanço patrimonial:** por empresa e data, o balanço apresenta ativo, passivo e patrimônio líquido, agrupados por conta do plano, com a igualdade ativo = passivo + patrimônio líquido visível.

### 4.3 Financeiro

- **RF-13 — Contas a pagar:** por empresa, registra títulos a pagar com fornecedor/descrição, vencimento, valor, conta contábil, **tabelas de impostos/retenções aplicáveis e regras de multa/juros aplicáveis (RF-20..RF-23)** e situação (aberto, parcialmente pago, pago, cancelado). Permite baixa total ou parcial (H8), com data e valor do pagamento, e cancelamento de título em aberto. Título quitado/cancelado não aceita nova baixa. Baixa pode ser desfeita por estorno de baixa (RF-24).
- **RF-14 — Contas a receber:** idem RF-13 na perspectiva de clientes e recebimentos (inclusive retenções sofridas na fonte, RF-22).
- **RF-15 — Vínculo financeiro-contábil:** toda baixa (total ou parcial), estorno de baixa e apuração de DAS gera ou vincula automaticamente lançamento(s) contábil(eis) identificável(is), de modo que o histórico financeiro, o fiscal e o contábil sejam rastreáveis entre si.
- **RF-16 — Conciliação bancária:** a empresa possui contas bancárias próprias. O sistema registra itens de extrato por **lançamento manual** (data, descrição, valor, entrada/saída) ou por **importação de arquivo de extrato (formatos OFX/CSV — F10)**, com validação do arquivo (arquivo não reconhecido não gera itens). Permite conciliar cada item a um título **e/ou a um lançamento** correspondente. Conciliação é item a item, admite estado parcial (alguns itens conciliados, outros não) e é retomável. Item conciliado só volta a ficar disponível por desconciliação.
- **RF-17 — Fluxo de caixa:** por empresa e intervalo de datas, o fluxo de caixa mostra saldo inicial, entradas e saídas **realizadas (títulos já baixados no intervalo) e previstas (títulos em aberto e seus vencimentos)** por dia (ou período de agrupamento) e saldo final. O saldo final de qualquer intervalo confere: `saldo inicial + entradas − saídas`.
- **RF-24 — Estorno de baixa (decisão I5 — F14):** o sistema permite desfazer uma baixa (total ou parcial) por **estorno de baixa**: o título reabre com o saldo anterior restaurado (volta a "aberto" ou "parcialmente pago" conforme o caso), um **lançamento de estorno imutável** é gerado e vinculado à baixa original, e tudo é registrado na trilha de auditoria (RF-05). Se o lançamento vinculado à baixa estiver conciliado, o estorno é recusado até que a desconciliação ocorra (H20). O estorno de baixa também é **recusado** quando a baixa pertence a **período contábil encerrado** — nada escreve em período encerrado (RF-08, RF-09): o estorno só é lançado no período de hoje quando o período da baixa está aberto; a tentativa recusada não altera o título e é registrada na trilha (CA-55). Um estorno de baixa só pode ser aplicado uma vez por baixa.

### 4.4 Fiscal configurável (escopo ampliado pela decisão PB-4 — F12)

- **RF-20 — Tabelas e alíquotas de impostos configuráveis:** a **configuração fiscal é configuração administrativa do escritório, não escrita contábil** (fronteira explicitada em RF-02): por empresa, **administrador ou contador autorizado** configura tabelas de impostos com nome, alíquota (percentual) e aplicação, que podem ser associadas a títulos e baixas. Toda alteração fica registrada na trilha de auditoria (RF-05) e tentativa de usuário sem essa permissão é recusada (CA-54). O sistema calcula e exibe o valor do imposto e o valor líquido correspondentes; a configuração aceita apenas alíquotas numéricas não negativas (ver CA-45). Operações que **escrevem no razão/financeiro** (lançamentos, baixas, estornos, encerramentos) continuam exigindo contador com escrita contábil ativa (RF-02, RF-08, RF-09).
- **RF-21 — Simples Nacional (DAS):** empresa com regime configurado como Simples Nacional apura o DAS do período aplicando a alíquota do regime sobre o **faturamento do período** (base: ver H17), exibe o valor apurado e permite gerar o lançamento contábil correspondente (RF-15). Sem regime configurado, a apuração é recusada com mensagem.
- **RF-22 — Retenção na fonte em títulos:** títulos podem ter retenções conforme tabela configurável (ex.: IRRF/ISS — F12). Na baixa, o sistema separa o valor bruto, o valor retido (que não é pago/recebido) e o valor líquido, gerando lançamento de retenção a recolher (RF-15) além do lançamento do pagamento/recebimento.
- **RF-23 — Multa e juros de atraso configuráveis:** por título e/ou contrato, o escritório configura multa (percentual, ex.: 2%) e juros (ex.: 1% a.m., calculados pro rata diária até a data da baixa — H18). Na baixa de título em atraso, o sistema calcula e exibe multa, juros e total devido, e o lançamento contábil vinculado reflete o total (RF-15). Baixa dentro do vencimento não gera multa/juros.

### 4.5 Relatórios e saída

- **RF-18 — Exportação:** balancete, razão, balanço patrimonial e fluxo de caixa podem ser gerados como arquivo para compartilhamento com o cliente (formatos: ver H9), contendo os mesmos valores exibidos na tela.

### 4.6 Contas de acesso (decisão M11 — F15)

- **RF-19 — Política de senha, limite de tentativas e eventos de acesso:** o sistema exige política de senha na criação/alteração (mínimo de caracteres conforme H15), limita tentativas de login consecutivas falhas (bloqueio temporário conforme H16) e registra na trilha de auditoria os **eventos de acesso**: tentativa de login com sucesso, tentativa com falha e bloqueio por limite atingido — com usuário, data e hora.

---

## 5. Restrições

### 5.1 Negócio

- **R1 (F2/F12):** o MVP cobre o escopo de F2 **mais** o escopo fiscal ampliado de F12. SPED, ECD/ECF e apuração genérica de tributos por receita estão fora do MVP (seção 11).
- **R2 (F4):** a terminologia, a estrutura do plano de contas e os relatórios seguem práticas brasileiras (PCASP).
- **R3 (F5):** todo o código do produto vive em `sistema-contabil/`; o framework da squad na raiz não é alterado.
- **R4 (F6):** o MVP não pode depender de serviços pagos para seu funcionamento (sem exigência de licenças, APIs comerciais ou serviços gerenciados obrigatórios) — inclusive no módulo fiscal: tabelas e alíquotas são configuradas localmente pelo escritório (F12a).
- **R5 (F8):** sem compatibilidade com produto anterior a preservar.

### 5.2 Segurança (F7)

- **R6:** autenticação obrigatória para qualquer acesso a dados de empresa; sem sessão válida, não há retorno de dados. Política de senha, limite de tentativas e auditoria de acesso são requisitos do MVP (RF-19, F15).
- **R7:** isolamento estrito por empresa — um usuário só lê e escreve nas empresas atribuídas, inclusive via tentativa de acesso direto a identificador de dado de outra empresa. **Única exceção: leitura global auditada do administrador (F13), que não inclui escrita.**
- **R8:** toda escrita é atribuída a um usuário autenticado e registrada na trilha de auditoria (RF-05).
- **R9:** lançamentos são imutáveis após gravação; exclusão silenciosa e edição de lançamento não existem como ações disponíveis (RF-08).
- **R10:** revogação de acesso (usuário desativado, **atribuição de empresa removida**) tem efeito imediato na tentativa seguinte, inclusive em sessão já aberta (CA-37).
- **R11:** a trilha de auditoria não pode ser editada nem removida por nenhuma interface ou ação disponível no produto (RF-05, CA-38).

### 5.3 Operação

- **R12:** aplicação web acessível por navegador desktop contemporâneo; não há aplicativo nativo no MVP.
- **R13:** dados persistidos em banco de dados (F3); a operação de backup/recuperação do banco é responsabilidade de implantação/ops e deve estar documentada antes do uso em produção (ver risco RK-5). O F3 ("backend e banco de dados") é fato do intake original, do qual R13 deriva coerentemente.
- **R14:** o produto é multiempresa no mesmo sistema; não é prevista implantação dedicada por cliente no MVP.

---

## 6. Critérios de aceite observáveis

Cada critério indica o método: **[T]** teste, **[I]** inspeção (leitura/configuração), **[D]** demonstração.

### 6.0 Fixtures de referência

- **FIX-01 — conjunto de lançamentos de referência** (usado por CA-04, CA-05, CA-31 e CA-32; empresa em mês M com período aberto; valores em R$):

  | # | Débito (conta — valor) | Crédito (conta — valor) |
  |---|------------------------|--------------------------|
  | L1 | Caixa — 1.000,00 | Capital — 1.000,00 |
  | L2 | Despesas — 600,00 | Fornecedor — 600,00 |
  | L3 | Fornecedor — 400,00 | Caixa — 400,00 |
  | L4 | Cliente — 700,00 | Receita — 700,00 |
  | L5 | Caixa — 300,00 | Cliente — 300,00 |

  **Totais:** débitos = créditos = **3.000,00**. **Saldos esperados:** Caixa 900,00 (D); Cliente 400,00 (D); Despesas 600,00 (D); Fornecedor 200,00 (C); Capital 1.000,00 (C); Receita 700,00 (C). **Balanço esperado:** ativo 1.300,00 (Caixa 900 + Cliente 400); passivo 200,00 (Fornecedor); patrimônio líquido 1.100,00 (Capital 1.000 + lucro do período 100 = Receita 700 − Despesas 600); confere: 200,00 + 1.100,00 = 1.300,00. **Razão de Caixa (ordem cronológica):** 1.000,00; 600,00; **900,00**.

### 6.1 Caminho normal

- **CA-01 [D]:** cadastrando uma empresa com razão social, CNPJ válido e situação ativa, ela aparece na lista do usuário administrador e de um contador a ela atribuído.
- **CA-02 [D]:** criando usuário com papel contador e atribuindo à empresa do CA-01, o contador consegue: criar conta no plano de contas, gravar um lançamento válido, ver balancete, razão e balanço daquela empresa.
- **CA-03 [T/D]:** um lançamento de exemplo com partidas `Débito Caixa R$ 1.000,00` e `Crédito Capital R$ 1.000,00` é gravado e aparece (a) no razão de Caixa como débito de R$ 1.000,00, (b) no razão de Capital como crédito de R$ 1.000,00 e (c) no balancete do período com totais de débitos = créditos.
- **CA-04 [T]:** com **FIX-01**, o balancete do período mostra débitos = créditos = R$ 3.000,00 e os saldos por conta iguais aos de FIX-01; o razão de Caixa lista exatamente L1, L3 e L5, com saldos correntes R$ 1.000,00, R$ 600,00 e R$ 900,00 — iguais ao cálculo manual.
- **CA-05 [T]:** com **FIX-01**, o balanço patrimonial na data final exibe ativo R$ 1.300,00, passivo R$ 200,00 e patrimônio líquido R$ 1.100,00, com a igualdade confere (`ativo − passivo − PL = 0`).
- **CA-06 [D]:** criando título a pagar de R$ 500,00 com vencimento futuro, registrando o pagamento total no vencimento: o título muda para pago, seu saldo zera, ele não aceita nova baixa e existe lançamento contábil de **R$ 500,00** vinculado a ele (visível a partir do título e no razão da conta). Como não houve atraso, **não** há multa/juros (RF-23; contraste com CA-48).
- **CA-07 [D]:** o mesmo fluxo de CA-06 executado para conta a receber resulta em título recebido e lançamento contábil vinculado.
- **CA-08 [T/D]:** registrando 3 itens de extrato e conciliando 2 deles — **um a um título correspondente e outro diretamente a um lançamento avulso (RF-16)** —, o sistema mostra 2 conciliados e 1 pendente; a consulta de conciliação após sair e voltar à tela mantém o mesmo estado, e o item pendente pode ser conciliado depois (conciliação parcial retomável).
- **CA-09 [T]:** com saldo inicial de R$ 10.000,00 na data D−2, um título a receber de R$ 1.500,00 **já recebido (baixa realizada) na data D−2**, um título a receber de R$ 2.000,00 em aberto (vencimento D+5) e um título a pagar de R$ 3.000,00 em aberto (vencimento D+10), o fluxo de caixa no intervalo D−2..D+10 mostra entrada realizada de R$ 1.500,00 (D−2), entrada prevista de R$ 2.000,00 (D+5), saída prevista de R$ 3.000,00 (D+10), e `saldo final = 10.000 + 1.500 + 2.000 − 3.000 = R$ 10.500,00`.
- **CA-10 [D]:** estornando o lançamento do CA-03, o razão de Caixa e de Capital passa a exibir o lançamento original e o estorno vinculado a ele, com efeito líquido zero no saldo.
- **CA-11 [I]:** o balancete, o razão, o balanço e o fluxo de caixa do exemplo acima possuem ação de exportação e o arquivo gerado contém os mesmos valores exibidos na tela (conferência linha a linha do arquivo com a tela).
- **CA-12 [I]:** após gravar lançamento, baixa de título e conciliação, a trilha de auditoria (consultável pelo administrador) contém, para cada evento, o usuário, a empresa, a ação, o identificador do objeto e data/hora.
- **CA-34 [T/D] (I2/F13):** um administrador **sem atribuição** à empresa X consulta um relatório (ex.: balancete) da empresa X e obtém os dados corretos; a consulta aparece registrada na trilha de auditoria identificando o admin, a empresa lida e o horário (leitura global auditada).
- **CA-41 [T] (M4/I5):** título a pagar de R$ 500,00 com baixa parcial de R$ 200,00: o título passa a **parcialmente pago** com saldo de R$ 300,00 e lançamento vinculado de R$ 200,00; nova baixa de R$ 300,00: o título passa a **pago**, saldo zera e os lançamentos vinculados somam R$ 500,00.
- **CA-42 [T] (I5/F14):** título pago de R$ 500,00 com estorno de baixa: o título **volta a aberto** com saldo de R$ 500,00; existe lançamento de estorno imutável vinculado à baixa original; a trilha registra o estorno; novo pagamento do título funciona normalmente.
- **CA-43 [T] (I5/F14):** título parcialmente pago (R$ 500,00, baixa de R$ 200,00, saldo R$ 300,00) com estorno da baixa de R$ 200,00: o título **volta a aberto** com saldo de R$ 500,00 e o lançamento de estorno de R$ 200,00 fica vinculado.
- **CA-45 [I] (F12a):** o escritório configura uma tabela de imposto (nome + alíquota de 4%) e ela fica disponível para associação a títulos/baixas; tentativa de gravar alíquota negativa ou não numérica é recusada com mensagem.
- **CA-46 [T] (F12b):** empresa com regime Simples Nacional configurado com alíquota de 6% e faturamento do período de R$ 10.000,00: a apuração exibe DAS de **R$ 600,00** e permite gerar o lançamento contábil correspondente, visível no razão.
- **CA-47 [T] (F12c):** título a pagar de R$ 1.000,00 com retenção configurada de 5%: a baixa registra pagamento líquido de R$ 950,00 ao fornecedor **e** retenção de R$ 50,00 a recolher (lançamento vinculado separado); o título fica pago.
- **CA-48 [T] (F12d):** título de R$ 1.000,00 vencido há 30 dias, com multa de 2% e juros de 1% a.m. (pro rata diária — H18): a baixa exibe multa de R$ 20,00, juros de R$ 10,00 e total de **R$ 1.030,00**; o lançamento vinculado soma R$ 1.030,00 e o título fica pago.
- **CA-53 [T] (F10/PB-2):** importando arquivo de extrato de exemplo (OFX ou CSV) com 3 itens, o sistema cria 3 itens de extrato conciliáveis como os itens manuais; importação de arquivo em formato não reconhecido é recusada com mensagem e **nenhum** item é criado.

### 6.2 Entradas inválidas

- **CA-13 [T]:** tentativa de gravar lançamento com débitos somando R$ 100,00 e créditos somando R$ 90,00 é recusada, com mensagem indicando o desequilíbrio, e nada é persistido (o razão permanece sem o lançamento).
- **CA-14 [T]:** lançamento recusado e nada persistido quando: (a) tem apenas uma partida; (b) partida com valor zero; (c) partida com valor negativo; (d) partida sem conta; (e) data em formato inválido; (f) data em período encerrado (ver CA-24).
- **CA-15 [T]:** cadastro de empresa recusado quando: razão social vazia; CNPJ com dígito inválido; CNPJ já cadastrado em empresa existente. Em todos os casos aparece mensagem específica e nada é persistido.
- **CA-16 [T]:** baixa de título recusada quando: valor informado maior que o saldo do título; valor ≤ 0; data inválida; título já pago ou cancelado. Nenhuma alteração de título ou lançamento ocorre nas recusas.
- **CA-17 [T]:** criação de conta no plano de contas recusada quando: código duplicado na mesma empresa; tipo ausente; tentativa de excluir conta com lançamentos (apenas inativar é oferecido).
- **CA-49 [T] (F12b):** tentativa de apurar DAS em empresa **sem regime** Simples Nacional configurado é recusada com mensagem específica e nenhum valor ou lançamento é gerado.
- **CA-50 [T] (F15/M11):** criação de usuário com senha com menos de 8 caracteres é recusada com mensagem citando a política de senha (H15); senha com 8 ou mais caracteres é aceita.

### 6.3 Permissões e autenticação

- **CA-18 [T]:** sem sessão autenticada, qualquer tentativa de obter ou alterar dados (inclusive acessando a URL/tela de dados diretamente) é negada e não retorna conteúdo de empresa.
- **CA-19 [T]:** com credenciais inválidas, o login é recusado e nenhuma sessão é criada.
- **CA-20 [T]:** **contador** A, atribuído somente à empresa X, ao consultar a lista de empresas e a tela/URL de um registro da empresa Y (identificador conhecido), não obtém conteúdo de Y — a resposta é negação, não dado vazio de outra empresa nem dado de Y. (O caso do administrador, que tem leitura global auditada, é CA-34.)
- **CA-21 [T]:** usuário com papel contador não encontra as ações de criar/editar usuários, alterar papéis ou consultar a trilha de auditoria; tentativa direta é recusada.
- **CA-22 [T]:** após desativar um usuário, a nova tentativa de acesso dele (inclusive com sessão iniciada anteriormente) é recusada.
- **CA-23 [T]:** sem atribuição a nenhuma empresa, o usuário logado (contador) vê lista vazia de empresas e não consegue gravar lançamento em nenhuma.
- **CA-33 [T] (I2/F13):** administrador logado, com empresa existente e contador atribuído: o admin **não encontra** ação de gravar lançamento/título na empresa; tentativa direta (requisição de escrita) é recusada e nada é persistido (admin tem gestão + leitura, sem escrita contábil).
- **CA-35 [T] (I1):** contador atribuído somente a X envia formulário de lançamento adulterado apontando empresa Y: a escrita é **recusada**, nada é persistido em Y e o evento fica registrado na trilha como tentativa.
- **CA-36 [T] (I1):** contador atribuído somente a X envia requisição direta de gravação com identificador de empresa Y: a resposta é negação, nada é persistido em Y e o evento fica registrado na trilha como tentativa.
- **CA-37 [T] (I1/R10):** contador com sessão **ativa**, atribuído a X e Z: o admin remove a atribuição a Z; **sem novo login**, a tentativa seguinte de leitura ou escrita em Z é negada imediatamente, enquanto operações em X continuam funcionando normalmente.
- **CA-51 [T] (F15/M11):** após 5 tentativas de login falhas consecutivas de um usuário, a tentativa seguinte é **bloqueada** com mensagem indicando o bloqueio — mesmo que a senha esteja correta — e o evento de bloqueio fica registrado na trilha (H16).
- **CA-52 [T] (F15/M11):** a trilha de auditoria registra, para um mesmo usuário no mesmo dia: login bem-sucedido (sucesso), tentativa com senha errada (falha) e o bloqueio do CA-51 — cada evento com usuário, tipo e data/hora.
- **CA-54 [T] (RF-02/RF-20):** (a) um usuário **sem a permissão de configuração fiscal** (ex.: contador não atribuído à empresa X, ou usuário sem papel habilitado) tenta alterar a alíquota de tabela de imposto de X — via interface ou requisição direta —: a alteração é **recusada**, nada é persistido e a tentativa fica registrada na trilha; (b) em seguida, o **administrador** do escritório altera a mesma tabela: a alteração é **permitida**, o novo valor passa a valer para as associações seguintes e a ação fica registrada na trilha (usuário, empresa, objeto e data/hora).

### 6.4 Estados extremos e limites

- **CA-24 [T]:** com período M encerrado, tentativa de gravar lançamento (inclusive estorno) com data em M é recusada com mensagem de período encerrado; lançamento com data em M+1 (aberto) é aceito.
- **CA-25 [T]:** tentativa de editar ou excluir um lançamento já gravado é indisponível/recusada; não existe ação no produto que produza a remoção silenciosa de um lançamento (inspeção das telas de lançamento + tentativa).
- **CA-26 [T]:** tentativa de estornar um lançamento já estornado é recusada com mensagem; estornar dois lançamentos distintos do mesmo período funciona normalmente.
- **CA-27 [T]:** inativar uma conta do plano que possui lançamentos é aceito (a conta sai das escolhas novas), mas excluí-la é recusado; conta pai com filhas ativas não pode ser inativada antes das filhas.
- **CA-28 [T]:** desconciliar um item conciliado devolve-o a pendente, preservando o histórico na trilha de auditoria; item já conciliado não pode ser conciliado a dois objetos distintos sem antes ser desconciliado.
- **CA-29 [T]:** com o banco de dados indisponível no momento de gravar um lançamento, o usuário recebe mensagem de erro e o lançamento não é registrado parcialmente (ao restaurar a dependência, o razão não contém lançamento incompleto nem lançamento duplicado).
- **CA-30 [T]:** operação interrompida por sessão expirada no meio de um formulário (**expiração conforme H14**): o usuário é levado ao login e nada é gravado pela operação interrompida (sem registro parcial).
- **CA-31 [D] (M10/I4):** com **FIX-01** lançado em um período qualquer, o **encerramento do período** zera as contas de resultado (Despesas e Receita com saldo zero no balancete seguinte) e mantém os saldos das contas permanentes (Caixa 900,00; Cliente 400,00; Fornecedor 200,00; Capital 1.000,00). **Variação de permissão (RF-09/F13):** a tentativa de encerrar o período por um **administrador** (inclusive por ação administrativa) é **recusada** com mensagem de permissão, nada é alterado e a tentativa fica registrada na trilha (RF-05); a mesma ação executada pelo contador com escrita contábil ativa funciona normalmente.
- **CA-32 [D] (M10/I4):** com **FIX-01** lançado no **12º período do ano** e o período encerrado, a **ação manual de encerramento do exercício** (RF-09/H12) transfere o resultado acumulado (lucro de R$ 100,00) ao patrimônio líquido: as contas de resultado ficam zeradas, o PL passa a R$ 1.100,00 e o balanço em 31/12 permanece equilibrado (ativo R$ 1.300,00 = passivo R$ 200,00 + PL R$ 1.100,00). **Variação de permissão (RF-09/F13):** a tentativa de encerrar o exercício por um **administrador** é **recusada** com mensagem de permissão e fica registrada na trilha (RF-05); a ação é concluída apenas pelo contador com escrita contábil ativa.
- **CA-38 [T/I] (I3/RF-05):** inspeção das telas e ações do produto: **não existe** edição ou remoção de eventos da trilha; tentativa direta de remoção é recusada; os eventos originais de um lançamento (criação, estorno, estorno de baixa) permanecem na trilha mesmo após os estornos, como novos eventos acrescidos.
- **CA-39 [T] (I3/RF-05):** admin consulta a trilha da empresa X, período M: a lista contém **apenas** eventos da empresa X naquele período (eventos da empresa Y e de outros meses não aparecem); consulta de um período sem eventos retorna lista vazia sem erro.
- **CA-40 [T] (M3/CE-20):** após inativar a empresa, tentativa de gravar lançamento ou criar título nela é recusada com mensagem de empresa inativa; balancete, razão e demais históricos da empresa continuam consultáveis.
- **CA-44 [T] (I5/CE-18):** baixa cujo lançamento vinculado está **conciliado**: tentativa de estorno de baixa é recusada com mensagem orientando a desconciliar; após desconciliar, o estorno é aceito e segue o fluxo do CA-42.
- **CA-55 [T] (RF-24/RF-08/RF-09):** com uma baixa registrada em período contábil **M já encerrado**, a tentativa de estornar essa baixa é **recusada** com mensagem de período encerrado; o título permanece com estado e saldo inalterados, nenhum lançamento de estorno é gerado e a tentativa fica registrada na trilha (RF-05). O estorno de baixa de uma baixa em período **aberto** funciona normalmente (fluxo do CA-42).

---

## 7. Casos de erro e limites relevantes

| # | Caso | Comportamento esperado |
|---|------|------------------------|
| CE-1 | Lançamento desbalanceado | Recusa com mensagem citando a diferença; nada persistido (CA-13). |
| CE-2 | Lançamento malformado (sem partidas, valor zero/negativo, conta inexistente, data inválida) | Recusa campo a campo com mensagem específica (CA-14). |
| CE-3 | Lançamento/estorno com data em período encerrado | Recusa com mensagem de período encerrado (CA-24). |
| CE-4 | Tentativa de edição/exclusão de lançamento gravado | Ação indisponível; caminho normal é estorno (CA-25). |
| CE-5 | Estorno duplicado | Recusa com mensagem (CA-26). |
| CE-6 | CNPJ duplicado/inválido, campos obrigatórios vazios | Recusa com mensagem específica (CA-15). |
| CE-7 | Baixa indevida (valor > saldo, valor ≤ 0, título quitado) | Recusa; nenhuma alteração parcial (CA-16). |
| CE-8 | Conciliação parcial interrompida | Estado parcial persistido e retomável; sem "meia conciliação" gráfada em falso (CA-08). |
| CE-9 | Dupla vinculação na conciliação | Bloqueada até desconciliar (CA-28). |
| CE-10 | Falha de dependência (banco indisponível) na gravação | Mensagem de erro ao usuário; nenhuma escrita parcial ou duplicada (CA-29). |
| CE-11 | Sessão expirada em operação (expiração conforme H14) | Retorno ao login sem gravação parcial (CA-30). |
| CE-12 | Usuário sem permissão/tentativa cruzada de tenant (leitura ou escrita) | Negação sem exposição nem alteração de dados (CA-18 a CA-23, CA-33, CA-35, CA-36, CA-37). |
| CE-13 | Conta com lançamentos tentada ser excluída | Recusa; caminho permitido é inativar (CA-27). |
| CE-14 | Empresa inativa | Não aceita lançamentos/títulos novos; histórico permanece consultável (CA-40). |
| CE-15 | Escrita em empresa não atribuída (contador), via formulário ou requisição direta | Recusa, nada persistido, evento registrado na trilha (CA-35, CA-36). |
| CE-16 | Tentativa de editar/remover eventos da trilha de auditoria | Nenhuma ação existe no produto; tentativa direta recusada; eventos originais permanecem (CA-38). |
| CE-17 | Login após limite de tentativas atingido | Bloqueio temporário com mensagem; evento de bloqueio auditado (CA-51). |
| CE-18 | Estorno de baixa com lançamento conciliado | Recusado até desconciliar; depois aceito (CA-44). |
| CE-19 | Cálculo fiscal sem configuração (DAS sem regime) ou alíquota inválida (negativa/não numérica) | Recusa com mensagem; nada calculado nem gravado (CA-45, CA-49). |
| CE-20 | Operações em empresa inativa | Recusa de lançamentos/títulos novos com mensagem; leitura liberada (CA-40). |
| CE-21 | Tentativa de alterar configuração fiscal sem permissão | Recusa com mensagem; nada persistido; tentativa registrada na trilha (CA-54). |
| CE-22 | Estorno de baixa de baixa em período contábil encerrado | Recusa com mensagem de período encerrado; estado do título inalterado; tentativa registrada na trilha (CA-55). |

**Limites declarados do MVP:**

- valores em reais (BRL) com 2 casas decimais; sem suporte a moeda estrangeira (H7);
- cálculo fiscal **limitado** ao decidido em F12: impostos com alíquotas configuráveis, Simples Nacional (DAS), retenções na fonte e multa/juros de atraso; apuração genérica de tributos por receita fica fora (seção 11);
- sem emissão de boleto, PIX ou arquivos de cobrança/remessa (decidido em PB-3, F11);
- sem integração direta com bancos por API (decidido em PB-2, F10);
- sem controle de edições simultâneas do mesmo registro por dois usuários além da imutabilidade dos lançamentos (H10);
- sem requisito de escala definido — ver H3.

---

## 8. Hipóteses

Hipóteses reversíveis de baixo impacto; qualquer uma pode ser refutada pelo coordenador sem reescrever o documento inteiro. **Confirmadas** em 2026-10-19 estão marcadas; as demais seguem abertas.

| # | Hipótese | Status / base / impacto se errada |
|---|----------|-----------------------------------|
| H1 | Idioma da interface e dos relatórios: **português do Brasil**. | Aberta; usuários do Brasil (F1/F4); reverter = i18n posterior. |
| H2 | O código do produto vive em `sistema-contabil/`, mantido o framework na raiz. | **Confirmada** — decisão do usuário (F5). |
| H3 | Escala do MVP: dezenas de empresas e dezenas de usuários por escritório; nenhum requisito de volume/latência definido. | Aberta; se houver exigência de escala, vira restrição mensurável. |
| H4 | Conciliação bancária opera com extrato informado no sistema (manual + importação de arquivo OFX/CSV), sem integração por API de banco. | **Confirmada** — resposta PB-2 (F10). |
| H5 | Plano de contas configurável pelo escritório, estruturado para refletir as classes/grupos do PCASP, **sem pré-carga obrigatória** do PCASP completo. | Aberta; "aderência prática" (F4) lida como estrutura compatível; pré-carga pode ser adicionada depois. |
| H6 | Papéis: administrador (gestão + leitura global auditada, **sem escrita contábil**) e contador (escrita na rotina das empresas atribuídas). | **Confirmada e refinada** — PB-1 (F9) e decisão I2 (F13). |
| H7 | Valores sempre positivos, com natureza dada por débito/crédito; BRL com 2 casas decimais. | Aberta; prática contábil usual; multi-moeda seria escopo novo. |
| H8 | Baixa **total ou parcial** de títulos, com saldo devedor/credor rastreável. | **Confirmada** — F14/M4 pressupõem baixa parcial ("parcial ou total"). |
| H9 | Exportação dos relatórios principais em arquivo (formato a definir na arquitetura: ex. PDF e/ou planilha). | Aberta; compartilhamento é expectativa de escritório; formato é detalhe de implementação. |
| H10 | MVP não resolve edições simultâneas do mesmo registro por dois usuários, além da imutabilidade dos lançamentos. | Aberta; risco aceito no MVP; controle otimista pode ser adicionado depois. |
| H11 | Terminologia e agrupamentos seguem o PCASP; layouts oficiais de obrigação não são requisito. | Aberta; coerente com F4 e R1. |
| H12 | **Exercício = os 12 períodos mensais do ano-calendário; encerramento do exercício é ação manual ao encerrar o 12º período, com transferência do resultado ao PL.** | Definição de domínio registrada pela revisão (I4), usada em RF-09/CA-31/CA-32; se o escritório usar exercício de forma diferente (ex.: encerramento por data), ajusta-se RF-09. |
| H13 | **Não existe exclusão dura de empresa no MVP** — apenas ativo/inativo. | Decisão do coordenador (M7); refletida em RF-01/RF-05. |
| H14 | **Sessão expira após ~30 minutos de inatividade** (valor configurável). | Hipótese de operação (M5); dá pré-requisito a CA-30/CE-11; o valor exato é ajustável na arquitetura. |
| H15 | **Política de senha: mínimo de 8 caracteres** (e demais regras a definir na arquitetura). | Hipótese de valor — o recurso é fato (F15), o número é revisável; CA-50 usa 8 como referência. |
| H16 | **Bloqueio de login após 5 tentativas falhas consecutivas**, por período temporário (ex.: 15 min) ou até desbloqueio administrativo. | Hipótese de valor (M11/F15 dão o recurso, não o número); CA-51 usa 5 como referência. |
| H17 | **Base do DAS = soma das receitas lançadas no período** (faturamento contábil do período). | Hipótese de domínio sobre o termo "faturamento do período" (F12b); se o escritório definir outra base (ex.: recebimentos), ajusta-se RF-21/CA-46. |
| H18 | **Juros de atraso calculados pro rata diária** (taxa mensal ÷ 30) até a data da baixa. | Hipótese de domínio para o ex. "1% a.m." de F12d; CA-48 usa 30 dias = 1%. |
| H19 | **Retenções geram lançamento de "impostos/retenções a recolher"** e reduzem o líquido pago/recebido na baixa. | Hipótese de domínio (RF-22/CA-47); o tratamento contábil detalhado é refinável na arquitetura. |
| H20 | **Estorno de baixa exige desconciliar antes** quando o lançamento vinculado está conciliado. | Regra de domínio (RF-24/CA-44); derivada do princípio de não criar estados contraditórios. |

---

## 9. Perguntas bloqueantes

**Todas as perguntas desta seção foram respondidas em 2026-10-19. Não há pergunta bloqueante aberta.** Qualquer nova ambiguidade de impacto material deve ser adicionada aqui antes de virar hipótese.

| # | Pergunta | Resposta do usuário (2026-10-19) | Efeito no escopo |
|---|----------|----------------------------------|------------------|
| **PB-1** | Quem acessa o sistema: só a equipe do escritório, ou também usuários dos clientes? | **Só a equipe do escritório; sem contas de clientes** (F9). | Confirma H6; modelo de papéis fechado em admin + contador (RF-02, F13). |
| **PB-2** | Como o extrato bancário entra na conciliação: importação de arquivo, lançamento manual ou ambos? API de banco? | **Lançamento manual + importação de arquivo (OFX/CSV); sem API de banco** (F10). | Confirma H4; RF-16 e CA-53 cobrem importação; API fica fora (§11). |
| **PB-3** | Títulos precisam emitir boleto/PIX/CNAB ou só registrar e baixar? | **Sem boleto, PIX ou CNAB; só registrar, baixar e cancelar** (F11). | §11 sem ambiguidade; limites da seção 7 atualizados. |
| **PB-4** | Há necessidade de calcular impostos, multa e juros de atraso nos títulos? | **SIM — amplia o MVP:** impostos com tabelas/alíquotas configuráveis; Simples Nacional (DAS sobre faturamento do período); retenção na fonte (ex.: IRRF/ISS por tabela configurável); multa e juros de atraso configuráveis por título/contrato (ex.: 2% + 1% a.m.). **Fora:** apuração genérica de tributos por receita (PIS/COFINS/IRPJ/CSLL). (F12) | Revoga a hipótese "sem cálculo automático" e o item correspondente de §11; cria RF-20..RF-23 e CA-45..CA-49; exige configuração fiscal (fluxo 3.2). |

---

## 10. Dependências e riscos de escopo

### Dependências

- **D1 — TASK-003 (arquitetura):** escolha de stack, modelo de dados e design de interface dependem deste documento aprovado. Nenhum bloqueio prévio a esta etapa.
- **D2 — Definições remanescentes para a arquitetura:** as PBs estão todas respondidas (§9); restam detalhes de implementação registrados como hipóteses de valor: formatos de exportação (H9), política de senha (H15), limite de tentativas (H16) e expiração de sessão (H14) — revisáveis sem reabrir escopo.
- **D3 — Operação/implantação (posterior):** backup e publicação do ambiente (R13) não fazem parte do MVP de produto e precisam ser definidos antes do uso em produção.
- **D4 — Validação fiscal com caso real (nova):** tabelas, alíquotas e base de cálculo (H17..H19) devem ser conferidas com o escritório antes do uso em produção (ver RK-8).

### Riscos

| # | Risco | Efeito se materializar | Mituição proposta |
|---|-------|------------------------|--------------------|
| RK-1 | Amplitude de "sistema contábil" puxa para fora do MVP (SPED/ECD/ECF, DRE detalhada, tributos por receita, multi-moeda) | Escopo infla e atrasa a primeira versão | Seção 11 (fora do MVP) é explícita, inclusive com a exclusão de "tributos por receita" decidida em PB-4; qualquer inclusão passa por revisão de escopo com o coordenador. |
| RK-2 | ~~Respostas a PBs alterarem escopo depois de iniciada a arquitetura~~ | **Encerrado** — PB-1..PB-4 respondidas em 2026-10-19 (§9); PB-4 ampliou o escopo **antes** da arquitetura. | Manter D2/D4 para os detalhes de valor. |
| RK-3 | Aderência ao PCASP (H5) mal interpretada → plano de contas incompatível com o que o escritório espera | Retrabalho de plano de contas e relatórios | Confirmar H5 com o coordenador se houver dúvida; manter plano configurável, não rígido. |
| RK-4 | Imutabilidade de lançamentos (R9) percebida como "não dá para corrigir" | Resistência de uso | Estorno (e estorno de baixa) como caminho normal documentado nos critérios (CA-10, CA-25, CA-42/43); mensagens orientam ao estorno. |
| RK-5 | Sem rotina de backup definida (R13) | Perda de dados contábeis sensíveis em incidente | Registrar, no plano de implantação, backup/restauração antes de uso em produção. |
| RK-6 | Dados sensíveis de múltiplos clientes no mesmo sistema (F7) | Exposição ou alteração cruzada de tenants | RF-04/RF-05 e critérios CA-18..CA-23, CA-33..CA-39 verificados obrigatoriamente no MVP; revisão de segurança antes de publicar. |
| RK-7 | ~~Conciliação depende de formato de extrato~~ | **Encerrado** — F10 fixou manual + importação OFX/CSV sem API. | Validação de arquivo coberta por CA-53; formatos extras (ex.: outros bancos) são adição futura. |
| RK-8 | **Novo:** escopo fiscal (F12) com tabelas/base de cálculo divergentes da prática real do escritório (H17..H19) | Cálculos incorretos, retrabalho ou decisões fiscais erradas | Validar tabelas, alíquotas e base com um caso real do escritório antes de produção (D4); manter tudo configurável, sem hardcode. |
| RK-9 | **Novo:** crescimento do MVP na 2ª rodada (fiscal, estorno de baixa, política de senha/limite de tentativas) | Atraso da primeira versão | Tudo com CA observável (seção 6) para permitir corte claro de prioridades pelo coordenador sem ambiguidade. |

---

## 11. Fora do MVP (evolução prevista, não requisito desta versão)

Registrado para evitar contaminação de escopo (atualizado após as respostas de 2026-10-19):

- obrigações fiscais e digitais: SPED, ECD, ECF e correlatos (F4);
- **apuração genérica de tributos por receita — PIS, COFINS, IRPJ e CSLL por período — explicitamente fora, conforme resposta a PB-4 (F12)**;
- DRE (demonstração do resultado do exercício) detalhada e livros fiscais;
- emissão de boleto, PIX e arquivos bancários de cobrança/remessa CNAB (**decidido em PB-3: fora**, F11);
- integração por API com bancos e conciliação automática (**decidido em PB-2: fora**, F10);
- contas/portal de clientes e acesso de usuários do cliente (**decidido em PB-1: fora**, F9);
- multi-moeda e operações com câmbio;
- aplicativo nativo, assinatura digital;
- pré-carga completa do PCASP, se H5 for refutada.

---

*Documento da TASK-002 (product-analyst). v3 — 3ª rodada em 2026-10-19: ajustes pontuais da re-inspeção (encerramento de períodos/exercício só pelo contador com escrita ativa; configuração fiscal como configuração administrativa auditada, não escrita contábil; estorno de baixa recusado em período encerrado), com acréscimos CA-54, CA-55, CE-21 e CE-22. v2 — 2ª rodada em 2026-10-19: decisões PB-1..PB-4 (F9..F12), decisões I2/I5/M11 (F13..F15) e achados da revisão I1, I3, I4, M1..M10 aplicados. Nenhum RF/CA renumerado (RF-19..RF-24 e CA-32..CA-55 são acréscimos). Não contém escolha de stack nem implementação. Fatos (seção 2), hipóteses (seção 8) e perguntas bloqueantes (seção 9) permanecem em seções separadas.*
