# `apps/web` — interface do Sistema Contábil

React + Vite (TypeScript), pt-BR (H1), desktop-first ≥1280px (R12). Sem
framework de CSS: **CSS puro com variáveis** (contrato de estilo ADR-0005).

## Rodar (dev)

Na raiz do monorepo (`sistema-contabil/`):

```powershell
npm run dev      # sobe API (127.0.0.1:3001) e web (localhost:5173) juntos
```

Ou só o web, com a API já em execução em outro terminal:

```powershell
npm run dev --workspace apps/web
```

## Como o dev alcança a API (proxy)

**Não há passo manual.** O `vite.config.ts` deste pacote declara
`server.proxy` para os prefixos de rota da API (`ROTAS_API`: `/health`,
`/login`, `/logout`, `/me`, `/empresas`, `/usuarios`, `/auditoria`, …),
encaminhando-os para:

| Variável de ambiente | Uso | Padrão |
|---|---|---|
| `API_URL` | alvo completo, sobrepõe host/porta | — |
| `API_HOST` | host do alvo | `127.0.0.1` |
| `API_PORT` | porta do alvo | `PORT`, senão `3001` |
| `PORT` | porta da API (mesmo nome do `apps/api`) | `3001` |
| `WEB_PORT` | porta do Vite | `5173` |

Com o proxy, browser e API falam **da mesma origem** em dev — igual ao
deploy (ADR-0003), sem CORS e com o cookie de sessão `HttpOnly` fluindo
normalmente. Ao adicionar um prefixo de rota novo na API, acrescente-o em
`ROTAS_API` no `vite.config.ts`.

Verificação rápida (PowerShell), com API + web no ar:

```powershell
Invoke-RestMethod http://localhost:5173/health   # deve devolver { status: ok, database: ok }
```

## Sessão e autenticação

- `POST /login` grava o cookie de sessão assinado (`HttpOnly`, `SameSite=Lax`,
  TTL 30 min — H14); `POST /logout` apaga; `GET /me` diz se há sessão válida.
- **O JS não guarda token algum** — não existe `localStorage` nesta aplicação:
  o estado é apenas "estou autenticado?", consultado em `src/sessao/`.
- Cliente HTTP tipado em `src/api-client/` (`login`, `logout`, `me`,
  `fetchHealth`), validando as respostas com os esquemas Zod de
  `packages/shared` (contrato api↔web, sem tipos duplicados).
- Erros seguem o padrão `{ erro: string }` da API; a UI exibe a mensagem do
  servidor e classifica o estado (CE-11/CE-12/CE-17 — ESTILO.md §5.2).

## Estilo

- `src/styles/tokens.css` — bloco `:root` com os ~120 tokens de
  `docs/design/ESTILO.md` §6. **Nenhum hex/medida de cor fora deste arquivo.**
- `src/styles/base.css` — reset, `body` com tipografia/cores dos tokens,
  foco visível (WCAG 2.4.7), `tabular-nums` em células numéricas, estados
  hover/ativo/desabilitado/erro/carregando/vazio e os componentes da
  fundação (topbar, sidebar, painéis, botões, campos, banners de recusa).
- Os dois arquivos são importados em `src/main.tsx`, nessa ordem.

## Estrutura

```
src/
  api-client/     cliente HTTP tipado (login/logout/me/health)
  components/     AppShell (topbar + menu + conteúdo), Mensagem (banners CE)
  i18n/           todos os textos em pt-BR
  pages/          LoginPage, TelaPendente (placeholders), AcessoNegado (CE-12)
  sessao/         estado "autenticado?" via GET /me
  styles/         tokens.css + base.css
  telas.ts        catálogo das 11 telas (grupo, visibilidade por papel, RF/CA)
  App.tsx         gate de sessão + navegação por hash
```

## Typecheck

```powershell
npm run typecheck --workspace apps/web   # tsc --noEmit
```

Este pacote ainda **não tem testes automatizados** (sem script `test`);
`npm test` na raiz do monorepo o pula com `--if-present`.
