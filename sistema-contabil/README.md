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
  `SESSION_SECRET`, `SESSION_TTL_MINUTES`).
- Web: `http://localhost:5173` — porta por `WEB_PORT` (o Vite escuta em
  `localhost`).

**Não há proxy entre web e API nesta etapa.** O cliente HTTP tipado fica em
`apps/web/src/api-client/` e passa a ser usado nas próximas tarefas; quando a
UI chamar a API, o proxy do Vite (ou CORS) será documentado aqui.

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
