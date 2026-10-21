# ADR-0005: Aprovação da direção visual (docs/design/ESTILO.md, PA-1..PA-7)

- **Status:** Aceito (aprovação humana em 2026-10-21)
- **Data:** 2026-10-21
- **Responsáveis:** Squad (product-analyst + coordenador), com aprovação do usuário
- **Relacionado:** TASK-020 (incremento 1 = fase de estilo); TASK-023; `docs/design/ESTILO.md` (fonte desta decisão); `docs/design/UIUX-DIRETRIZES.md`; `docs/decisions/ADR-0004-decisoes-interface-q-ui.md` (recessa "será preto e branco?"); `docs/decisions/ADR-0003-implantacao-web-vps-sqlite.md` (deploy em VPS, sem CDN)

## Contexto

O ADR-0004 respondeu a ressalva do usuário — o produto **não é preto e branco** — e definiu que a fase de estilo (paleta, tipografia, estados) seria etapa da T020, documentada em `docs/design/ESTILO.md` e **sujeita a aprovação humana** antes de a T020 poder ser concluída.

O documento foi entregue em 2026-10-21 (sessão `ses_ea15bcbc4ffdedlyZF2ekdH7Sw`), com 116 tokens, ~40 pares de contraste WCAG, mapeamento dos 22 CEs para estados visuais e correspondência das 11 telas dos wireframes. Ele levantou 7 pendências de aprovação (PA-1..PA-7).

## Decisões

Respostas do usuário em 2026-10-21 (aprovou as três decisões de produto; as demais seguem a recomendação do documento, sem objeção):

### PA-1 — Paleta geral (aprovada pelo usuário)

**Decisão:** azul institucional `#2143D1` como primária (botão/link; branco 7,53:1), teal `#0F766E` como secundária **restrita a dados e progresso** (nunca ação), neutros frios `#F5F7FA` / `#FFFFFF` / `#EEF1F6` e semânticas em trio texto/fundo/sólido (erro `#B91C1C`/`#FEE2E2`, aviso `#B45309`/`#FEF3C7`, sucesso `#15803D`/`#DCFCE7`, info `#1D4ED8`/`#DBEAFE`).

- Barra superior `#162567` (14,05:1) substitui o cinza `#242424` dos wireframes — é o que cumpre materialmente o ADR-0004.
- Borda de controle `#667085` (4,97:1), e não `#D0D5DD` (1,47:1), para atender o WCAG 1.4.11 (3:1 em componentes).

### PA-2 — Tipografia: fonte do sistema (aprovada pelo usuário)

**Decisão:** fonte do sistema (`Segoe UI, system-ui, ...`) com stack de fallback, sem CDN e sem arquivo de fonte self-hosted.

- Justificativa: o deploy é em VPS (ADR-0003) e as diretrizes proíbem CDN; self-hosted adicionaria dependência de build e ~50-200 KB sem ganho de fidelidade — os wireframes aprovados já usam fonte do sistema.
- `font-variant-numeric: tabular-nums` obrigatório em toda célula numérica e de data (tabelas densas).

### PA-6 — Microtexto em 10,5px (aprovada pelo usuário)

**Decisão:** manter `10,5px` em badges/chips/rótulos auxiliares, conforme a escala herdada dos wireframes (densidade "denso no dado, calmo na forma").

- Condição: conferência de legibilidade na revisão de aplicação (T020/T021); se frustrar em tela real, a troca para `11px` é mudança de um token.

### PA-3, PA-4 e PA-5 — Aprovadas pelos defaults recomendados

Sem objeção registrada do usuário; baixo impacto e reversíveis por token antes do fechamento da T020:

- **PA-3:** mapa de cores dos badges de situação (§3.7) e da linha de totais `#EEF3FF`.
- **PA-4:** botão primário em diálogos de efeito amplo (inativar, cancelar título, encerrar período/exercício) usa `--cor-primaria-600`, **não** `--cor-erro` — não existe exclusão dura no produto (R9/R11/H13) e rotina em vermelho contradiz `RK-4` (estorno é rotina, não erro).
- **PA-5:** gráficos com débito `#0F766E` × crédito `#6D28D9`; fluxo positivo/negativo em verde/vermelho.

### PA-7 — Registro formal

**Decisão:** esta ADR é o registro formal da aprovação (a pendência pedia "ADR ou `.squad/`").

## Consequências

- O critério de aceite da T020 "`docs/design/ESTILO.md` criado e o estilo aplicado ao app; **aprovação humana do estilo registrada**" tem sua segunda parte cumprida por esta ADR; falta a aplicação prática no `apps/web`.
- `docs/design/ESTILO.md` deixa de ser proposta e passa a ser **contrato de estilo**: os tokens do §6 são o que o código vai consumir. Mudança de cor/tamanho significativo a partir daqui é nova decisão, não ajuste livre.
- A tipografia fixa a stack de componentes: sem dependência de build de fonte, o `apps/web` não ganha novo artefato estático por causa do estilo.
- Nenhuma alteração de requisitos: tudo aqui é decisão de apresentação.

## Validação

- **Limitação registrada:** os ~40 pares de contraste do `ESTILO.md` foram calculados por fórmula WCAG (luminância relativa sRGB), **não medidos em navegador** (zoom 200%, tela real). A medição acontece na aplicação do estilo e na verificação da T021; se algum par frassar, a correção é de token.
- Pendências de produto restantes, alheias a esta ADR: v4 de segurança de exposição pública, H9 (formato de exportação), RK-8 (validação fiscal com caso real).

## Histórico

- 2026-10-21: documento entregue pela fase de estilo da T020; PA-1, PA-2 e PA-6 aprovadas pelo usuário na mesma data (respostas diretas); PA-3, PA-4 e PA-5 aprovadas pelos defaults recomendados; PA-7 cumprida por esta ADR.
