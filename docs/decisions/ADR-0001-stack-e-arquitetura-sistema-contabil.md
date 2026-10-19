# ADR-0001: Stack e arquitetura do sistema contábil (MVP)

- **Status:** Proposta (aguardando aprovação do coordenador — TASK-003)
- **Data:** 2026-10-19
- **Responsáveis:** Squad (arquiteto)
- **Relacionado:** TASK-003; `docs/requirements/SISTEMA-CONTABIL.md` (v3)

## Contexto

O escritório contábil precisa de um app web multiempresas (Brasil, PCASP) para plano de contas, partidas dobradas imutáveis com estorno, períodos mensais com encerramento de exercício, financeiro (títulos, baixa total/parcial, estorno de baixa), conciliação bancária por lançamento manual + importação OFX/CSV, fluxo de caixa, cálulo fiscal configurável (Simples/DAS, retenções, multa/juros) e relatórios com exportação. Segurança é obrigatória no MVP: autenticação com política de senha e bloqueio após tentativas, papéis (administrador com gestão + leitura global auditada e SEM escrita contábil; contador com escrita contábil nas empresas atribuídas), isolamento estrito por tenant em leitura e escrita com revogação imediata, trilha de auditoria imutável e filtrável por empresa/período, e nada escrevendo em período contábil encerrado. Os critérios CA-01..CA-55 e a fixture FIX-01 devem ser verificáveis por teste automatizado.

Restrições (§5 dos requisitos): código em `sistema-contabil/` (framework da squad permanece na raiz); sem serviços pagos obrigatórios; sem API de banco; sem boleto/PIX/CNAB; SPED/ECD/ECF e tributos por receita fora do MVP; interface em pt-BR; sem exclusão dura de empresa; escala assumida baixa (H3: dezenas de empresas/usuários).

### Avaliação operacional do ambiente (fatos medidos em 2026-10-19, máquina Windows)

| Ferramenta | Resultado |
|---|---|
| `node --version` | **v24.19.0** presente |
| `npm --version` | **11.17.0** presente |
| `dotnet --version` | **10.0.401** presente |
| `git --version` | **2.55.0** presente |
| `python --version` | ausente |
| `docker --version` | ausente |
| `java -version` | ausente |
| `psql --version` | ausente |
| `sqlite3` (CLI) | ausente (banco embarcado via driver npm dispensa CLI) |

Conclusão operacional: apenas Node.js e .NET rodam localmente sem instalar serviços externos. Banco servidor (PostgreSQL/SQL Server) exigiria instalação ou Docker — viável como evolução, mas não como dependência obrigatória do MVP.

## Opções consideradas

### Opção A — Node.js + TypeScript (Fastify) + React (Vite) + SQLite (Drizzle) — **escolhida**

- Benefícios:
  - Runtime já presente (Node 24); zero serviços externos obrigatórios; `npm install` é a única dependência de setup.
  - SQLite embarcado: ACID, transações de escrita (exigência das partidas dobradas, CA-29), arquivo único, backup por cópia; escala H3 (dezenas de empresas) é folgada.
  - TypeScript ponta a ponta com tipos compartilhados entre API e UI reduz erros de contrato nos ~55 critérios.
  - Drizzle permite trocar SQLite por PostgreSQL depois com mudança concentrada em configuração/migrações.
  - Ecossistema de teste maduro (Vitest + supertest/inject do Fastify) cobre bem testes de integração HTTP, que é onde está a massa dos CA.
- Custos e riscos:
  - Backend e frontend são dois apps (mais estrutura que um monólito de página única).
  - SQLite tem concorrência de escrita limitada (fine para um escritório; migração para PostgreSQL prevista como ADR futura se houver escalão real).

### Opção B — .NET 10 (minimal API) + React + SQLite (EF Core)

- Benefícios: runtime presente; EF Core maduro; forte tipagem; boa ferramenta de teste (xUnit).
- Custos e riscos: EF Core + SQLite exige cuidado extra com constraints e triggers defensivas; menor velocidade de iteração para a squad (mais verboso); publicação single-file menos simples no fluxo npm já usado pelo framework da squad; nenhum requisito exige o ecossistema .NET.

### Opção C — Next.js full-stack (App Router) + Prisma + SQLite

- Benefícios: um único app e um único processo; SSR e rotas de servidor simplificam o MVP de UI.
- Custos e riscos: acoplamento da regra de negócio a um framework de UI dificulta testar isoladamente as regras contábeis (imutabilidade, período encerrado, tenant); Prisma tem camada de runtime própria e menos controle fino sobre transações/triggers; migração futura para API separada (ex.: integração futura SPED) seria retrabalho.

Critérios de comparação: adequação funcional (regras contábeis rígidas + isolamento de tenant), integridade transacional, operação sem custos/serviços externos, testabilidade dos CA-01..CA-55, complexidade e manutenção, portabilidade.

## Decisão

**Opção A.** Monorepo npm (workspaces) em `sistema-contabil/`:

- **API:** Node.js 24 + TypeScript + **Fastify**; autenticação por **sessão em cookie assinado** (sessão persistida no banco; validação a cada requisição — garante revogação imediata, R10/CA-22/CA-37); hash de senha com **argon2** (`@node-rs/argonaut` ou `argon2`), política ≥8 caracteres (H15), contador de falhas + bloqueio após 5 tentativas (H16) persistidos no usuário.
- **Banco:** **SQLite** via **Drizzle ORM** (arquivo local, WAL, migrações versionadas via drizzle-kit). Sem Docker, sem servidor, sem serviços pagos.
- **Frontend:** **React 18+ + Vite + TypeScript**, pt-BR, consumindo a API REST; sem SSR (não é requisito).
- **Dinheiro:** valores em **inteiros (centavos)**, colunas `*_centavos INTEGER CHECK (valor > 0)`; cálculos em inteiro; apresentação BRL 2 casas.
- **Relatórios/exportação (H9):** CSV e/ou PDF gerados pela API (bibliotecas abertas `csv-stringify` / `pdfkit` ou equivalentes) — formato final é detalhe de implementação, decisão não bloqueante.
- **Importação OFX/CSV (RF-16):** parser OFX próprio ou lib aberta (`ofx4js`/equivalente), validação estrita; arquivo não reconhecido não gera itens (CA-53).

### Estrutura de diretórios recomendada em `sistema-contabil/`

```
sistema-contabil/
  README.md                  # como instalar, rodar, testar
  package.json               # workspaces: apps/*, packages/*
  .gitignore
  apps/
    api/
      package.json
      drizzle/               # migrações geradas
      src/
        index.ts             # bootstrap Fastify
        config.ts            # env, segredos, expiração de sessão (H14)
        db/                  # conexão Drizzle, schema, seeds
        domain/              # regras puras: partidas, períodos, títulos, impostos, multa/juros
        services/            # casos de uso transacionais (lançar, baixar, estornar, encerrar)
        routes/              # HTTP: auth, empresas, contas, lancamentos, titulos, conciliacao, relatorios, fiscal, auditoria
        middleware/          # sessão, papéis (admin/contador), escopo de tenant, auditoria
        exports/             # geração de CSV/PDF
        importers/           # OFX/CSV
      tests/
        fixtures/            # FIX-01 e factories
        integration/         # cobrem a maioria dos CA-01..CA-55 via HTTP real
        unit/                # domínio: cálculo fiscal, juros pro rata, validações
    web/
      package.json
      src/
        pages/               # por módulo: auth, empresas, plano-contas, lancamentos, titulos, conciliacao, relatorios, fiscal, auditoria
        components/
        api-client/          # cliente tipado da API
        i18n/                # textos pt-BR
  packages/
    shared/                  # tipos e validações compartilhados api↔web (Zod)
```

O app vive inteiro em `sistema-contabil/`, sem tocar no framework da raiz (R3). `.squad/`, `docs/` e `AGENTS.md` permanecem na raiz do repositório.

### Modelo de dados (entidades e relacionamentos)

| Entidade | Campos essenciais | Relacionamentos / regras |
|---|---|---|
| `empresa` | razão social, CNPJ (único, validado), situação ativa/inativa | sem exclusão dura (H13); inativa bloqueia escrita nova, mantém leitura (CA-40) |
| `usuario` | email único, senha_hash, papel (administrador\|contador), ativo, failed_logins, locked_until | N:N com `empresa` via `usuario_empresa` |
| `usuario_empresa` | usuario_id, empresa_id | remoção tem efeito imediato (R10) |
| `sessao` | id, usuario_id, criada_em, expira_em | validada a cada requisição junto com `usuario.ativo` (CA-22, H14) |
| `conta` | empresa_id, código (único por empresa), descrição, tipo (ativo/passivo/PL/receita/despesa), conta_pai_id, ativa | hierárquia PCASP configurável (H5); pai com filhas ativas não inativa (CA-27); conta com lançamentos só inativa (CA-17) |
| `periodo_contabil` | empresa_id, ano, mês (único por empresa), encerrado_em | nenhum lançamento com data em período encerrado (CA-24); encerramento do 12º ⇒ exercício (CA-32) |
| `lancamento` | empresa_id, periodo_id, data, historico, estorno_de_id (NULL), criado_por, criado_em | imutável: sem UPDATE/DELETE no produto + triggers no DB; estorno = novo lançamento inverso vinculado, uma única vez (CA-26) |
| `partida` | lancamento_id, conta_id, natureza (D\|C), valor_centavos (>0) | ≥2 partidas; ΣD = ΣC validado em transação (CA-13/14) |
| `titulo` | empresa_id, tipo (pagar\|receber), contraparte, descrição, vencimento, valor_centavos, conta_id, situação (aberto\|parcial\|pago\|cancelado), saldo_centavos | gera baixas; situação deriva das baixas (CA-41) |
| `baixa` | titulo_id, data, valor_centavos, multa_centavos, juros_centavos, lancamento_id, estornada_em, estorno_de_baixa_id | vínculo financeiro-contábil (RF-15); estorno de baixa uma única vez (CA-42/43); recusado se conciliado (CA-44) ou período encerrado (CA-55) |
| `conta_bancaria` | empresa_id, nome, saldo_inicial_centavos, data_saldo_inicial | base do fluxo de caixa (CA-09) |
| `importacao_extrato` | conta_bancaria_id, arquivo_hash, formato, status | validação estrita; inválido ⇒ 0 itens (CA-53) |
| `item_extrato` | conta_bancaria_id, data, descricao, valor_centavos, origem (manual\|ofx\|csv), conciliado em | conciliação item a item, retomável (CA-08) |
| `conciliacao` | item_extrato_id, tipo_objeto (baixa\|lancamento), objeto_id, conciliado_em, desconciliado_em | um item ↔ um objeto por vez; desconciliação restaura (CA-28); estorno de baixa exige desconciliar (CA-44) |
| `tabela_imposto` | empresa_id, nome, aliquota_percent (≥0), aplicação, ativa | configuração administrativa auditada (RF-20, CA-45/54) |
| `retencao_titulo` | titulo_id, tabela_imposto_id, aliquota_percent | separa bruto/retido/líquido na baixa (CA-47) |
| `regime_fiscal` | empresa_id, regime (simples\|outro), aliquota_das_percent | DAS = alíquota × receitas do período (H17, CA-46/49) |
| `config_multa_juros` | empresa_id, multa_percent, juros_mensal_percent, com override por título/contrato | juros pro rata diária = mensal/30 (H18, CA-48) |
| `apuracao_das` | empresa_id, periodo_id, base_centavos, valor_centavos, lancamento_id | gera lançamento vinculado (RF-15) |
| `audit_event` | usuario_id?, empresa_id?, acao, objeto_tipo, objeto_id, dados (JSON), criado_em | append-only; ver desenho abaixo |

### Desenho do isolamento de tenant

1. **Modelo:** tenant = `empresa`. Toda tabela de negócio tem `empresa_id NOT NULL` (direto ou via `titulo`/`conta`).
2. **Camada de serviço:** toda operação passa por um contexto `{ usuario, empresa_id }` resolvido no middleware; o escopo vem da sessão + `usuario_empresa`, **nunca** de campo confiável do corpo da requisição (endereça CA-35/CA-36: adulterar `empresa_id` no formulário é recusado porque o escopo é sobrescrito pelo servidor).
3. **Leitura global do admin (F13):** rota/permissão distinta (`scope: global`), disponível só ao papel administrador, que registra evento de auditoria por leitura global (CA-34). Não existe caminho global de escrita — escrita exige contador atribuído (CA-33).
4. **Revogação imediata (R10):** cada requisição consulta `sessao` + `usuario.ativo` + atribuições vigentes no banco (sem cache longo), então remoção de atribuição ou desativação vale na tentativa seguinte (CA-22/CA-37).
5. **Defesa em profundidade (opcional, recomendada):** views/triggers SQLite que adicionam `empresa_id` ao escopo de escrita; no mínimo, todas as queries passam por repositórios que exigem `empresa_id` explícito — revista de segurança antes da produção (RK-6).

### Desenho da auditoria

- Tabela `audit_event` **append-only**: o produto não expõe nenhuma rota de UPDATE/DELETE; **triggers SQLite `BEFORE UPDATE`/`BEFORE DELETE` que fazem `RAISE(ABORT)`** garantem imutabilidade mesmo contra bug de aplicação (CA-38).
- Todo serviço de escrita grava o evento **na mesma transação** da escrita (consistência: nada muda sem trilha, R8); recusas relevantes (tentativa cruzada de tenant, login bloqueado, estorno recusado) também são auditadas (CA-35/36/51/55).
- Eventos de acesso (login sucesso/falha/bloqueio) gravados na autenticação (CA-52).
- Consulta filtrável por empresa e período, restrita ao administrador (CA-39).
- Campos: usuário, empresa, ação, objeto, dados anteriores/novos em JSON, data/hora.

## Consequências

- Impactos positivos: setup local instantâneo e sem custos; testes de integração rápidos (banco por arquivo/temp por teste); caminho claro de migração para PostgreSQL; regras contábeis centralizadas em `domain/` puro e altamente testável.
- Custos ou limitações: SQLite não escala para alta concorrência de escrita (aceito sob H3); dois apps exigem orquestração de dev (dois processos ou proxy de dev); exportação PDF/CSV e parser OFX são trabalho próprio.
- Riscos e mitigação:
  - Imutabilidade depende também de triggers — cobrir com teste que tenta UPDATE/DELETE direto no banco (CA-38).
  - Valores em centavos eliminam erro de ponto flutuante, mas exigem disciplina na camada de domínio — revisar no code review.
  - Migração futura para PostgreSQL: iniciar migrações Drizzle já portáveis; evitar SQL específico do SQLite fora de triggers/repositórios.
  - Segurança de sessão/cookies (HttpOnly, SameSite, expiração H14) e hash argon2: checklist obrigatório na implementação de RF-19.
- Efeitos sobre implementação e operação: `npm install && npm run dev` roda tudo; backup = cópia do arquivo SQLite (RK-5 fica para o plano de implantação); deploy de produção fica para ADR futura.

## Estratégia de verificação dos CA-01..CA-55

- **Unidade (Vitest):** domínio puro — validação de lançamento (CA-13/14), cálculo de juros pro rata (CA-48), DAS (CA-46/49), retenções (CA-47), multa/juros, regras de período encerrado (CA-24), validação de CNPJ (CA-15), política de senha (CA-50).
- **Integração (Vitest + Fastify.inject com SQLite temporário por teste):** cobre a grande maioria dos CA disparando requisições HTTP reais contra API + banco: autenticação e papéis (CA-18..CA-23, CA-33..CA-37, CA-51/52, CA-54), ciclo contábil completo com FIX-01 (CA-02..CA-05, CA-10, CA-31, CA-32), financeiro (CA-06/07, CA-16, CA-41..CA-44, CA-55), conciliação e importação (CA-08, CA-28, CA-53), fluxo de caixa (CA-09), auditoria (CA-12, CA-38, CA-39), transacionalidade (CA-29 simulando falha no meio da transação; CA-30 com sessão expirada), empresa inativa (CA-40), exportação (CA-11 comparando arquivo gerado com a tela/serviço).
- **Fixtures:** FIX-01 implementada como factory de teste reproduzindo exatamente os valores do documento; assertions conferem os números canônicos (3.000,00; saldos; balanço 1.300/200/1.100).
- **E2E/[D]:** os critérios marcados [D] (CA-01, CA-10, CA-31, CA-32 e variações) são demonstráveis manualmente na UI; se a squad quiser automatizar, Playwright contra o app completo é uma adição opcional — não é pré-requisito do MVP.
- **Mapeamento:** cada CA vira ao menos um teste nomeado `CA-XX ...`; a cobertura é conferível por leitura do diretório `tests/`.

## Validação

- Pendências para o coordenador/produto: (1) aprovar esta ADR; (2) confirmar formato de exportação (H9) — não bloqueante; (3) decisões futuras de deploy/backup (R13) ficam para ADR de implantação.
- Nenhuma informação faltante altera a escolha da stack.

## Histórico

- 2026-10-19: decisão criada (TASK-003).
