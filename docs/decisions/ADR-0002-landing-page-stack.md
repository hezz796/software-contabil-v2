# ADR-0002: Stack da landing page (squad-framework-2.0)

- **Status:** Proposta (aguardando aprovação do coordenador — TASK-005)
- **Data:** 2026-10-20
- **Responsáveis:** Squad (arquiteto)
- **Relacionado:** TASK-005; `docs/requirements/landpage.md` (rascunho v1)

## Contexto

O repositório precisa de uma landing page estática que apresente o próprio squad-framework-2.0: página única em PT-BR com as seções hero → recursos → como funciona → CTA → rodapé, legível a alguém de fora do projeto. Fonte de verdade dos requisitos: `docs/requirements/landpage.md`.

Requisitos técnicos que condicionam a escolha:

| # | Requisito |
|---|-----------|
| RT-1 | Página estática: apenas markup, estilo e script, **sem framework e sem etapa de build**. |
| RT-2 | Abre via `file://` com duplo clique no arquivo principal, sem servidor e sem comando de build. |
| RT-3 | Responsiva e sem rolagem horizontal de 320px a 1440px. |
| RT-4 | Console do navegador sem erros nem avisos após carregamento e rolagem completa. |
| RT-5 | Sem dependência de rede obrigatória: renderiza offline; recursos opcionais só se aceitos com degradação. |
| RT-6 | A implementação só cria os próprios arquivos da página. |

Fatos relevantes: **F1** o repositório ainda não tem código de produto da landing page; **F4** não há landing anterior nem comportamento legado; a landing é a **primeira implementação** do projeto de página (não há padrão visual existente a seguir). A hipótese **H1** (HTML/CSS/JS puro, sem build) está registrada nos requisitos mas **não foi confirmada pelo usuário** — esta ADR é o lugar onde ela é avaliada e, se aprovada, deixaria de ser hipótese para virar decisão. As perguntas abertas **PB-1..PB-3** (público/CTA, idioma, publicação) não alteram a escolha de stack; apenas PB-3 pode exigir requisitos novos depois.

Critérios de comparação: adequação funcional aos RTs, complexidade de setup e manutenção, segurança/superfície de dependência, operação sem custos, verificabilidade dos critérios de aceite e compatibilidade com a primeira implementação do repositório.

## Opções consideradas

### Opção A — HTML/CSS/JS estático puro (sem framework, sem build) — **escolhida**

- Benefícios:
  - Atende RT-1 e RT-2 por construção: não existe toolchain, logo não há etapa de build a executar e nenhum artefato gerado — o arquivo aberto é o arquivo entregue.
  - Atende RT-5 por construção: sem `node_modules`, sem CDN obrigatório, sem bundle; offline a página se comporta igual.
  - Custo de setup zero (nenhuma dependência a instalar) e superfície de segurança mínima — nenhum pacote de terceiro no caminho crítico da página.
  - Verificação direta dos CA-5..CA-8: abrir por `file://`, checar console, alternar viewport 320/1440 e rede offline diretamente no navegador.
  - É a primeira implementação do repositório: escopo pequeno e reversível (apagar os arquivos desfaz tudo), sem regressão possível.
- Custos e riscos:
  - Sem componentização: repetição de marcação/estilo entre seções e esforço manual para manter consistência visual.
  - Responsividade (RT-3) depende de CSS escrito com cuidado, sem helpers de framework.
  - Se a página crescer (múltiplos idiomas, várias páginas, componentes reutilizados), a manutenção manual fica cara — nesse caso a stack precisaria ser reavaliada em nova ADR.
  - Sem minificação/otimização automática (irrelevante para uma página única servida localmente).

### Opção B — Gerador de site estático (ex.: Astro) com etapa de build

- Benefícios:
  - Componentes reutilizáveis, templates e frontmatter resolvem a manutenção se a página crescer; saída final é HTML/CSS/JS estático (boa para publicação futura, PB-3).
  - Automação de otimização (imagens, CSS crítico) e ecossistema de temas.
- Custos e riscos:
  - **Viola RT-1 e RT-2**: exige `npm install` + `npm run build` antes de existir uma página abrível; o arquivo aberto por `file://` seria artefato gerado, não fonte, e qualquer alteração exige rebuild.
  - Introduz toolchain, `node_modules` e dependências de terceiros na primeira implementação do repositório, sem que nenhum requisito atual as peça.
  - Não melhora nenhum requisito vigente (RT-3/RT-4/RT-5 continuam sendo satisfeitos pelo CSS/JS escritos à mão).

### Opção C — SPA com framework (ex.: React + Vite, ou Next.js)

- Benefícios:
  - Componentização e estado programático úteis se a página ganhar interatividade real (formulários, busca, i18n dinâmico); Next ofereceria SSR/SEO para publicação.
- Custos e riscos:
  - **Viola RT-1 e RT-2** de forma mais forte que a Opção B: SPA precisa de servidor ou de build; rotas e assets costumam quebrar sob `file://` (caminhos relativos, módulos, histórico de navegação).
  - Contradiz RT-5 no caso de CDNs/bundles exigindo rede ou runtime remoto, e adiciona superfície de dependências a auditar.
  - Nenhum requisito atual (página informativa única, sem estado, sem login, sem formulário com backend) justifica o custo de framework e toolchain.

## Decisão

**Opção A — HTML/CSS/JS estático puro, sem framework e sem etapa de build.**

Justificativa: os requisitos RT-1, RT-2 e RT-5 não são preferências estilísticas — são condições de aceite verificáveis (CA-5, CA-7, CA-8) que a Opção A satisfaz por construção, enquanto as Opções B e C as violam ao exigir toolchain, geração de artefato e/ou servidor. Como a landing page é a **primeira implementação** do repositório (F1/F4), não há padrão a herdar nem legado a preservar, e a solução de menor complexidade é a que introduz menos dependência, menos superfície de segurança e menos custo de operação. A decisão **confirma a direção de H1** (que permanece registrada como hipótese não confirmada pelo usuário até o coordenador validar esta ADR); se H1 for negada, RT-1/RT-2/RT-5 precisam ser renegociados antes de qualquer outro trabalho — como já previsto em `docs/requirements/landpage.md` §8.

Concretamente: a página será composta por arquivos de markup, estilo e script entregues como estão, sem `package.json` de build, sem gerador e sem dependência de rede obrigatória. O local exato dos arquivos da página (raiz ou subdiretório próprio) é definição de plano da TASK-006, não desta ADR.

## Consequências

- **Impactos positivos:**
  - RT-1, RT-2 e RT-5 são atendidos por construção, não por esforço de conformidade — verificação da TASK-007 reduz-se a abrir o arquivo e observar.
  - Setup inexistente: qualquer um abre o repositório e edita; sem instalação, sem custo, sem lockfile de build.
  - Superfície de segurança mínima: zero dependências de terceiro no caminho da página.
  - Mudanças são pequenas, revisáveis e reversíveis por natureza (um arquivo editado por vez), compatível com o modo de trabalho da squad.

- **Custos ou limitações:**
  - Sem componentização: consistência visual e de copy depende de disciplina de revisão, não de bibliotecas compartilhadas.
  - Responsividade 320–1440px (RT-3) é CSS manual, sem utilitários prontos.
  - Sem minificação, cache-busting ou otimização automática — aceitável para página única servida localmente, mas insuficiente se virar produto publicado com tráfego.
  - Escala limitada: múltiplas páginas, idiomas ou interatividade stateful tornariam a manutenção cara.

- **Riscos e mitigação:**
  - *JS à mão quebrar RT-4 (erros no console)* — mitigação: manter o script mínimo, preferir recursos nativos (`scroll-behavior`, âncoras HTML) e conferir console em DevTools após rolagem completa (CA-7).
  - *CSS quebrar RT-3 em 320px* — mitigação: testar viewport em 320px e 1440px na verificação (CA-6); usar layout fluido (flex/grid, unidades relativas) desde a primeira versão.
  - *Recurso opcional virar dependência obrigatória (RT-5)* — mitigação: sem fontes/imagens externas na primeira versão; se algum recurso remoto for aceito, exigir degradação verificada com a rede desativada no DevTools (CA-8).
  - *Escopo crescer e a stack não acompanhar* — mitigação: este ADR é revisto (não ignorado) se PB-3 levar a publicação ou se a página deixar de ser de arquivo único; trocar de stack depois envolve renegociar RT-1/RT-2/RT-5.
  - *Colisão de numeração* — resolvida pelo coordenador: este arquivo foi renumerado de ADR-0001 para **ADR-0002** (o ADR-0001 pertence ao sistema contábil). Nenhum arquivo de outro escopo foi alterado.

- **Efeitos sobre implementação e operação:**
  - Implementação: arquivos de página abertos diretamente; sem `npm install`, sem dev server, sem pipeline. Verificação = navegador + DevTools, replicável por qualquer revisor.
  - Operação: "deploy" nesta etapa é inexistente (H4/escopo interno); abrir localmente é o modo de uso esperado.
  - Publicação futura (PB-3) passaria a servir os mesmos arquivos estáticos como estão — a Opção A não bloqueia publicação estática simples; se a publicação impuser requisitos novos (URL própria, domínio, CI, otimização), isso vira ADR nova, não exceção a esta.

## Validação

- **Como será conferida:** inspeção desta ADR pelo coordenador (estrutura, opções, decisão); depois verificação empírica na TASK-007 contra os critérios dos requisitos:
  - CA-5/RT-2: abrir o arquivo principal por `file://` com duplo clique, sem servidor ativo, e observar o render completo.
  - CA-6/RT-3: viewport a 320px e a 1440px sem rolagem horizontal.
  - CA-7/RT-4: DevTools aberto, recarregar, rolar até o fim, console vazio.
  - CA-8/RT-5: carregar com rede desativada (DevTools offline) e confirmar as seções 4.1–4.5.
- **O que permanece em aberto:**
  - Aprovação do coordenador: esta ADR está em **Proposta**; H1 só deixa de ser hipótese quando for aprovada.
  - **PB-3** (publicação): se a resposta for "publicar", revisar esta decisão — publicação pode exigir requisitos novos (URL/domínio, CI, otimização, possivelmente geração de artefatos) que motivam nova ADR. Publicação simples de arquivos estáticos não exige trocar de stack.
  - **PB-1/PB-2** (CTA/idioma): não alteram a stack; afetam copy, tratados nos requisitos.
  - Nenhuma informação disponível altera a escolha; se surgir requisito de interatividade com estado ou de múltiplas páginas, reavaliar.

## Histórico

- 2026-10-20: decisão criada (TASK-005; originalmente escrita como TASK-002 antes da renumeração por colisão com o fluxo do sistema contábil).
- 2026-10-20: renumerada de ADR-0001 para ADR-0002 pelo coordenador (colisão de identificador com o ADR-0001 do sistema contábil).
