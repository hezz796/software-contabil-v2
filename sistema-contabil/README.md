# Sistema Contábil

Monorepo npm (workspaces) conforme ADR-0001:

- `apps/api` — Fastify + Drizzle ORM + SQLite (arquivo local)
- `apps/web` — React + Vite (TypeScript)
- `packages/shared` — tipos e validações Zod compartilhados api↔web

Sem Docker, sem Python, sem servidor de banco: apenas Node 24+ e npm 11+.

## Instalar

```powershell
npm install
```

## Rodar (dev)

```powershell
npm run dev
```

Sobe os dois processos em paralelo com saída prefixada (`[api]` / `[web]`):

- API: `http://127.0.0.1:3001/health` — porta/host configuráveis por env
  (`PORT`, `HOST`; outros: `DATABASE_PATH`, `LOG_LEVEL`, `NODE_ENV`,
  `SESSION_SECRET`, `SESSION_TTL_MINUTES` [padrão 30 min, H14],
  `SESSION_COOKIE_SECURE` [`true|false`, padrão `true` só em produção],
  `LOGIN_MAX_TENTATIVAS` [padrão 5, H16], `LOGIN_BLOQUEIO_MINUTOS`
  [padrão 15, H16]).
- Web: `http://localhost:5173` — porta por `WEB_PORT` (o Vite escuta em
  `localhost`).

**Há proxy entre web e API em dev.** O `apps/web/vite.config.ts` declara
`server.proxy` para os prefixos de rota da API (`ROTAS_API`), de modo que
`npm run dev` no web consome a API local **sem CORS e sem passo manual** —
mesma origem no dev e no deploy (ADR-0003). O alvo do proxy é `API_URL`
(ex.: `http://127.0.0.1:4000`) ou, na ausência, `API_HOST`/`API_PORT` (ou
`PORT`) com default `http://127.0.0.1:3001`, que casa com o default da API.

Verificação rápida, com os dois processos no ar:

```powershell
Invoke-RestMethod http://localhost:5173/health   # deve responder {"status":"ok","database":"ok"}
```

Detalhes, env vars e estrutura do front: `apps/web/README.md`. Quando a API
ganhar rotas novas, acrescente o prefixo em `ROTAS_API` no `vite.config.ts`.

## Testar

```powershell
npm test
```

Cada teste cria o próprio banco SQLite temporário (diretório único em `%TEMP%`)
e o remove ao final — `tests/setup.ts` falha a suíte se algum teste vazar um
banco aberto.

## Typecheck

```powershell
npm run typecheck
```

TypeScript estrito em todos os pacotes (`tsconfig.base.json`).

## Migrar

```powershell
npm run migrate       # aplica drizzle/ em DATABASE_PATH (idempotente)
npm run db:generate   # regenera migrações a partir de src/db/schema.ts
```

Migrações também são aplicadas na subida da API (`npm run dev`), de forma
idempotente. Caminhos relativos de `DATABASE_PATH` são resolvidos a partir de
`apps/api`; o banco de dev padrão é `apps/api/data/sistema-contabil.db`
(gitignorado).

## SQLite

Toda conexão é aberta com `journal_mode=wal`, `synchronous=FULL` e
`busy_timeout=5000` (`apps/api/src/db/index.ts`); esses valores são verificados
por teste automatizado em `apps/api/tests/unit/sqlite-config.test.ts`.

Valores em dinheiro são inteiros em **centavos** (nunca ponto flutuante).
