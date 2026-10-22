# Requisitos — Landing Page (squad-framework-2.0)

- **Documento:** docs/requirements/landpage.md
- **Tarefa:** TASK-004 (product-analyst)
- **Data:** 2026-10-20
- **Status:** rascunho — v1
- **Conteúdo da página:** apresentação do próprio projeto **squad-framework-2.0** (framework de squad autônoma com agentes do OpenCode para conduzir o ciclo de desenvolvimento de software). É o único produto real do contexto.
- **Nota de escopo:** este documento define objetivo, seções, guia de copy, requisitos técnicos e critérios de aceite da landing page. Ele **não** implementa código e **não** define stack além da restrição declarada em H1.

---

## 1. Objetivo

**Problema:** o repositório contém um framework de squad (agentes, skills, comandos e ciclo de desenvolvimento), mas não existe nenhuma peça que o apresente de forma legível a alguém de fora — quem abre o repositório não encontra, em um lugar só, o que é, para que serve e como é usado.

**Resultado esperado:** uma landing page **estática**, aberta diretamente pelo navegador sem build e sem servidor, que em uma única rolagem comunica:

1. o que é o squad-framework-2.0 e para quem ele existe;
2. quais são seus diferenciais principais;
3. como funciona o ciclo que ele propõe (entender → planejar → implementar → verificar → revisar → release);
4. qual é o próximo passo para quem se interessou (CTA).

**Resultado não esperado (nesta etapa):** publicação, deploy, domínio, formulário funcional com backend, captura de leads, métricas de analytics.

---

## 2. Fatos confirmados e hipóteses

### 2.1 Fatos confirmados

| # | Fato |
|---|------|
| F1 | O repositório é `squad-framework-2.0`; ainda não há commit nem código de produto. |
| F2 | O único produto real do contexto é o próprio framework da squad (agentes do OpenCode + skills + comandos + ciclo de desenvolvimento). |
| F3 | O usuário pediu apenas "landpage" e dispensou perguntas de esclarecimento. |
| F4 | Não existe landing page anterior nem comportamento legado a preservar. |

### 2.2 Hipóteses adotadas (reversíveis, de baixo impacto)

Registradas explicitamente porque **não foram confirmadas pelo usuário**. Cada uma pode ser desfeita por decisão humana sem reescrever o restante do documento.

| # | Hipótese | Impacto de errar | Como reverter |
|---|----------|------------------|----------------|
| **H1** | Landing page **estática em HTML/CSS/JS puro**, sem framework e sem etapa de build. | Baixo — afeta apenas a forma de implementar. | Trocar a implementação mantendo seções, copy e critérios. |
| **H2** | Objetivo principal é **apresentar/informar**; o CTA é **secundário** e de contato. | Médio — muda a hierarquia visual e o texto do CTA. | Reordenar seções e trocar o rótulo/destino do CTA. |
| **H3** | Idioma **português (BR)**; copy **genérica**, produzida pela squad, sem dados de terceiros. | Baixo — texto é editável isoladamente. | Reescrever o guia de copy no idioma escolhido. |
| **H4** | Escopo **interno ao repositório**; **sem deploy/publicação** nesta etapa. | Médio — define o que é aceito como pronto. | Incluir tarefa separada de publicação. |

> Nenhuma restrição de stack foi escolhida além de H1, que é uma restrição de escopo (sem build), não uma escolha de tecnologia.

---

## 3. Usuários e fluxos afetados

| Perfil | Origem | O que precisa obter |
|--------|--------|---------------------|
| **Visitante curioso** (colega de squad, revisor, futuro usuário) | Inferido — H2 | Entender em poucos segundos o que é o projeto e para que serve. |
| **Interessado em adotar/contribuir** | Inferido — H2 | Saber como o ciclo funciona e ter um caminho claro de contato (CTA). |

**Fluxo único da página:** visitante abre o arquivo → lê o hero → percorre recursos → entende como funciona → encontra o CTA → acessa o rodapé (fontes/contato). Não há etapa de login, formulário com estado nem navegação entre páginas.

---

## 4. Seções da página e guia de copy (PT-BR)

Ordem mínima obrigatória: **hero → recursos → como funciona → CTA → rodapé**.
Cada seção traz **texto pronto**; onde a informação depende de decisão humana, traz **instrução clara** do que escrever e sinaliza `[a confirmar]`.

### 4.1 Hero (proposta de valor)

**Obrigatório:** título, subtítulo e um CTA visível no primeiro quadro (320px de largura sem rolagem horizontal).

- **Título:** `squad-framework`
- **Subtítulo:** `Um framework de squad autônoma: agentes do OpenCode que conduzem o ciclo de desenvolvimento de software — do pedido à release.`
- **Texto de apoio:** `Entender, planejar, implementar, verificar, revisar e publicar com papéis definidos, critérios de aceite verificáveis e memória persistente entre sessões.`
- **Rótulo do CTA:** `Como funciona` (ancora para a seção 4.3 — "Como funciona"; correção de numeração registrada em 2026-10-20, o texto original dizia 4.4). *Alternativa se H2 mudar:* `Falar com a squad` `[a confirmar]`

### 4.2 Recursos / diferenciais

**Obrigatório:** entre 3 e 6 itens, cada um com título curto (máx. 4 palavras) e uma frase. Texto pronto:

1. **Ciclo completo** — `Do entendimento à release, com etapas nomeadas e handoffs claros entre especialistas.`
2. **Papéis especializados** — `Coordenador, arquiteto, implementador, revisor, QA e revisor de segurança atuam só no escopo delegado.`
3. **Aceite verificável** — `Tarefa só fecha com critérios observáveis, evidências de verificação e limitações registradas.`
4. **Memória persistente** — `Estado, decisões e progresso ficam no repositório — não apenas no histórico da conversa.`
5. **Agnóstica a tecnologia** — `A stack é escolhida por projeto, a partir de requisitos, restrições e capacidade de operação.`
6. **Execução paralela** — `Subagents em background e worktrees separadas mantêm o trabalho independente sem conflito.`

### 4.3 Como funciona

**Obrigatório:** sequência passo a passo, legível como lista numerada. Texto pronto:

1. `Start — o pedido é transformado em objetivo, requisitos, hipóteses e critérios de aceite.`
2. `Plan — o objetivo vira plano, dependências e critérios verificáveis.`
3. `Implement — tarefas planejadas são executadas em escopo delimitado, com trabalho paralelo quando independente.`
4. `Verify — os critérios são conferidos e as evidências são registradas.`
5. `Review — uma revisão independente relata defeitos, regressões e riscos.`
6. `Release — as notas e os artefatos de release são preparados a partir do que foi verificado.`

### 4.4 CTA (chamada para ação)

**Obrigatório:** um bloco destacado, isolado das outras seções, com verbo no início da frase.

- **Título:** `Pronto para colocar a squad para trabalhar?`
- **Texto:** `Comece por um pedido: descreva o problema e deixe a squad conduzir o ciclo até a release.`
- **Rótulo do botão:** `[a confirmar]` — *instrução:* escrever o rótulo e o destino do CTA **somente depois que a pergunta PB-1 (seção 6) for respondida**; enquanto isso, usar como rótulo provisório `Ver o ciclo da squad` apontando para a âncora da seção 4.3. Não inventar endereço de e-mail, URL externa ou formulário.

### 4.5 Rodapé

**Obrigatório:** identificação do projeto e fonte. Texto pronto:

- `squad-framework-2.0 — framework de squad autônoma com agentes do OpenCode.`
- `Documento de origem: docs/requirements/landpage.md.`
- `Conteúdo em português (BR).`
- *Se houver link de repositório:* incluir `[a confirmar]` — só adicionar URL que exista de fato.

### 4.6 Regras de copy

- PT-BR, voz ativa, frases curtas; evitar jargão não explicado na primeira aparição.
- Nenhum número, estatística, nome de cliente ou promessa de resultado que não seja verificável no repositório.
- Nenhum endereço de e-mail, telefone ou domínio sem confirmação humana.
- A mesma terminologia do repositório (`squad`, `task`, `critério de aceite`, `release`) deve ser usada sem tradução interna conflitante.

---

## 5. Requisitos técnicos

| # | Requisito |
|---|-----------|
| RT-1 | Página **estática**: apenas arquivos de markup, estilo e script, sem framework e sem etapa de build. |
| RT-2 | Abre via **`file://`** com duplo clique no arquivo principal, sem servidor local e sem comando de build. |
| RT-3 | **Responsiva** e sem rolagem horizontal de 320px a 1440px de largura de viewport. |
| RT-4 | **Sem erros nem avisos no console** do navegador (JS) após o carregamento e após rolar a página inteira. |
| RT-5 | **Sem dependência de rede obrigatória**: a página renderiza e mantém as seções 4.1–4.5 mesmo offline. Recursos opcionais (fonte remota, imagem externa) só são aceitos se a página degrada sem eles. |
| RT-6 | Não modifica nada fora de `docs/requirements/landpage.md` nesta etapa de requisitos; a implementação futura só cria os próprios arquivos da página. |

---

## 6. Critérios de aceite verificáveis

| # | Critério | Forma de verificação |
|---|----------|----------------------|
| CA-1 | O documento registra objetivo (problema) e resultado esperado. | Abrir `docs/requirements/landpage.md` e localizar a seção 1 contendo "Problema" e "Resultado esperado". |
| CA-2 | As 5 seções mínimas estão definidas: hero com proposta de valor, recursos/diferenciais, como funciona, CTA e rodapé. | Conferir a presença das seções 4.1, 4.2, 4.3, 4.4 e 4.5 no documento. |
| CA-3 | Cada seção tem guia de copy em PT-BR com texto pronto ou instrução clara do que escrever. | Inspecionar que toda seção 4.1–4.5 contém texto entre crases ou uma instrução com `[a confirmar]`. |
| CA-4 | Requisito de página **estática** declarado. | Localizar RT-1 no documento. |
| CA-5 | Requisito de abrir via `file://` **sem build** declarado. | Localizar RT-2; além disso, na implementação, abrir o arquivo principal por `file://` em navegador sem servidor ativo e observar o render completo. |
| CA-6 | Requisito de responsividade **320px–1440px** declarado. | Localizar RT-3; na implementação, ajustar o navegador a 320px e a 1440px e verificar ausência de rolagem horizontal. |
| CA-7 | Requisito de **console sem erros** declarado. | Localizar RT-4; na implementação, abrir DevTools, recarregar, rolar até o fim e conferir console vazio. |
| CA-8 | Requisito de **sem dependência de rede obrigatória** declarado. | Localizar RT-5; na implementação, carregar com a rede desativada (DevTools offline) e conferir que as seções 4.1–4.5 aparecem. |
| CA-9 | Existem critérios de aceite observáveis, **cada um com sua forma de verificação**. | Conferir que toda linha de CA-1 a CA-10 tem uma coluna "Forma de verificação" preenchida e distinta do enunciado. |
| CA-10 | H1–H4 estão registradas como hipóteses e as perguntas abertas (alvo, CTA, idioma) estão listadas. | Localizar a seção 2.2 com H1–H4 e a seção 7 com as perguntas abertas, marcadas como não confirmadas. |

---

## 7. Perguntas que permanecem abertas

A resposta pode alterar escopo ou comportamento e **não foi inventada**. Nenhuma delas bloqueia a escrita da página; todas bloqueiam a publicação ou a troca do copy.

| # | Pergunta | O que muda | Bloqueia |
|---|----------|------------|----------|
| PB-1 | Qual é o **público-alvo** e qual ação concreta o CTA deve provocar (contato, leitura do README, adoção)? | Rótulo, destino e destaque visual do CTA (seção 4.4) | Publicação; promover o CTA a principal |
| PB-2 | O **idioma** é mesmo português (BR) ou há versão em outro idioma? | Todo o guia de copy (H3) | Publicação |
| PB-3 | A página pode ser **publicada** (repositório público, Pages, domínio) ou fica apenas local? | Inclui tarefa de deploy e possíveis requisitos de URL (H4) | Qualquer entrega externa |

> Os rótulos provisórios das seções 4.1 e 4.4 existem para que PB-1 não bloqueie o andamento; eles devem ser revisados assim que houver resposta.

---

## 8. Dependências e riscos de escopo

- **Dependência:** nenhum código de produto anterior — a landing page é a primeira implementação do repositório, portanto não há regressão possível, mas também não há padrão visual existente a seguir (o guia de copy é a fonte de verdade).
- **Dependência:** H1 condiciona a implementação; se o coordenador escolher um framework depois, RT-1, RT-2 e RT-5 precisam ser renegociados.
- **Risco:** copy genérica produzir uma página que não diferencia o projeto — mitigado pela exigência CA-3 de texto pronto ancorado no ciclo real descrito na seção 4.3.
- **Risco:** CTA sem destino válido (e-mail ou URL inventados) — mitigado pela regra de não publicar dado de contato não confirmado (seção 4.6) e por PB-1.
- **Fora de escopo desta etapa:** qualquer arquivo de código, `.squad/`, `.opencode/`, `AGENTS.md`, `docs/decisions/` e arquivos na raiz.
