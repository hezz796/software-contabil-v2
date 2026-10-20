# Plano de implementação — Sistema Contábil (MVP)

- **Documento:** docs/plans/PLAN-IMPLEMENTACAO.md
- **Tarefa:** TASK-009 (coordinator)
- **Data:** 2026-10-20
- **Fontes:** `docs/requirements/SISTEMA-CONTABIL.md` (v3), ADR-0001 (stack), ADR-0003 (implantação)
- **Status:** plano aprovado pelo usuário ("Prossiga de acordo com sua recomendação", 2026-10-20)

---

## 1. Estratégia

1. **Fundação primeiro:** monorepo + harness de teste + segurança base antes de qualquer regra contábil — todo o resto depende de sessão, papéis, escopo de tenant e trilha de auditoria.
2. **Cadeia do núcleo contábil em sequência** (plano de contas → lançamentos → relatórios/encerramentos): cada etapa só é testável sobre a anterior.
3. **Paralelismo por partição de arquivos**, nunca por edição compartilhada:
   - `T020 (frontend)` roda em worktree paralela à cadeia do núcleo a partir de T011 (contrato da API já existe para auth/usuários).
   - `T019 (fluxo de caixa)` é somente leitura ⇒ paralelo seguro com `T018 (conciliação)`.
   - `T017 (fiscal)` entra **depois** de T016 e **antes** de T018/T019, porque altera o cálculo da baixa (mesmos arquivos).
4. **Cada tarefa só conclui com seus CA verificados por teste automatizado** (ou limitação registrada). Sem "testar depois".
5. **FIX-01 é fixture canônica:** implementada uma vez (`tests/fixtures/`), usada por CA-04, CA-05, CA-31, CA-32.
6. **Frontend não bloqueia backend** (API-first) e **backend não espera frontend**: integração final ocorre em T021.

### Grafo de dependências

```
T010 fundação
  └─ T011 segurança base (auth, sessão, papéis, tenant, auditoria)
       ├─ T012 empresas + gestão de usuários + permissões
       │    └─ T013 plano de contas + períodos
       │         └─ T014 lançamentos, partidas, imutabilidade, estorno
       │              └─ T015 balancete/razão/balanço + encerramentos
       │                   └─ T016 financeiro (títulos, baixas, estorno de baixa)
       │                        └─ T017 fiscal (tabelas, retenções, multa/juros, DAS)
       │                             ├─ T018 conciliação + importação OFX/CSV   ┐ paralelo
       │                             └─ T019 fluxo de caixa + exportação        ┘ (worktrees)
       └─ T020 frontend completo (paralelo à cadeia, incremental) ─────────────┐
                                                                              ├─ T021 verificação integral + reviews
                                    (T015..T020 convergem) ◄──────────────────┘
                                             └─ T022 implantação: backup/restore + runbook
```

---

## 2. Tarefas

| ID | Tarefa | Deps | Horas (agente) |
|----|--------|------|----------------|
| **T010** | Fundação do monorepo e harness de teste | T009 | 5 |
| **T011** | Segurança base: usuários, sessão, papéis, escopo de tenant, auditoria | T010 | 9 |
| **T012** | Empresas, gestão de usuários/atribuições e permissões admin×contador | T011 | 6 |
| **T013** | Plano de contas hierárquico e períodos contábeis | T012 | 5 |
| **T014** | Lançamentos em partidas dobradas, imutabilidade e estorno | T013 | 7 |
| **T015** | Balancete, razão, balanço, encerramento de período e exercício (FIX-01) | T014 | 7 |
| **T016** | Financeiro: títulos, baixa total/parcial, cancelamento, estorno de baixa | T015 | 8 |
| **T017** | Fiscal configurável: tabelas, retenções, multa/juros, DAS | T016 | 7 |
| **T018** | Conciliação bancária e importação OFX/CSV | T017 | 7 |
| **T019** | Fluxo de caixa e exportação CSV/PDF | T017 | 5 |
| **T020** | Frontend completo pt-BR (todas as telas) | T011* | 14 |
| **T021** | Verificação integral CA-01..55, FIX-01, code review e security review (RK-6) | T015..T020 | 10 |
| **T022** | Implantação: backup/restore testado, runbook e checklist de publicação | T021 | 3 |
| | **Total** | | **93** |

\* T020 inicia após T011 e evolui incrementalmente em worktree paralela; cada endpoint entregue pela cadeia do núcleo vira tela correspondente. Integração e correção final em T021.

### Detalhamento

**T010 — Fundação** (`apps/api`, `apps/web`, `packages/shared`)
- Workspaces npm, TypeScript estrito, Fastify com `/health`, React+Vite, Drizzle+SQLite (WAL, `synchronous=FULL`, `busy_timeout`), migrações versionadas, harness de teste com banco temporário por teste, `npm run dev` e `npm test` funcionando.
- Fora: qualquer regra de negócio.
- Aceite: `npm install && npm run dev` sobe API+web; `npm test` roda zero testes com sucesso; migração aplicada do zero em banco limpo.

**T011 — Segurança base**
- `usuario` (papel, ativo, failed_logins, locked_until), `sessao`, `usuario_empresa`, `audit_event` **append-only com triggers `RAISE(ABORT)`**, login/logout com argon2, cookie de sessão (HttpOnly, expiração H14 ≈30 min), middleware de escopo `{usuario, empresa_id}` sobrescrevendo qualquer valor do corpo, política de senha (H15 ≥8), bloqueio após 5 falhas (H16), eventos de acesso na trilha.
- Aceite (CA): **CA-18, CA-19, CA-21, CA-22, CA-38, CA-39, CA-50, CA-51, CA-52**.

**T012 — Empresas, usuários e permissões**
- CRUD de empresa (CNPJ validado, único, ativo/inativo, **sem exclusão dura**), gestão de usuários e atribuições pelo admin, leitura global do admin **auditada**, escrita contábil só para contador atribuído, recusa de tentativas cruzadas de tenant (corpo, URL, ID) auditada.
- Aceite (CA): **CA-15, CA-20, CA-23, CA-33, CA-35, CA-36, CA-37**; **CA-34** (permissão) — validação completa com balancete em T021; **CA-40** completo em T016.

**T013 — Plano de contas e períodos**
- Contas hierárquicas (código único por empresa, tipo, pai/filhas), inativação regrada; períodos mensais únicos com estado aberto/encerrado.
- Aceite (CA): **CA-17, CA-27**.

**T014 — Lançamentos e estorno**
- Lançamento transacional (≥2 partidas, ΣD=ΣC, valores >0, data válida, período aberto), imutabilidade (sem UPDATE/DELETE + triggers), estorno único vinculado. Recusas auditadas.
- Aceite (CA): **CA-13, CA-14, CA-24, CA-25, CA-26, CA-29** (falha simulada no meio da transação).

**T015 — Relatórios contábeis e encerramentos**
- Balancete, razão e balanço; encerramento de período (zera resultado) e do exercício (transfere resultado ao PL, H12), **somente contador com escrita ativa**. FIX-01 implementada.
- Aceite (CA): **CA-03, CA-04, CA-05, CA-31, CA-32** + FIX-01 canônica.

**T016 — Financeiro**
- Títulos a pagar/receber, baixa total/parcial com validações, cancelamento, situação derivada das baixas, estorno de baixa (reabre título, lança estorno vinculado, uma única vez, recusado em período encerrado e com lançamento conciliado — esta última em T018), vínculo financeiro-contábil. Empresa inativa bloqueia escrita.
- Aceite (CA): **CA-06, CA-07, CA-16, CA-40, CA-41, CA-42, CA-43, CA-55**.

**T017 — Fiscal configurável**
- Tabelas de imposto (alíquota ≥0), retenções por título (bruto/retido/líquido + lançamento a recolher), multa e juros pro rata diária (H18), regime e apuração do DAS com lançamento vinculado, permissão de configuração = configuração administrativa auditada (CA-54).
- Aceite (CA): **CA-45, CA-46, CA-47, CA-48, CA-49, CA-54**.

**T018 — Conciliação e importação**
- Contas bancárias, itens manuais, importação OFX/CSV validada estritamente (inválido ⇒ 0 itens), conciliação item↔objeto (título **ou** lançamento), desconciliação, retomável; estorno de baixa exige desconciliar.
- Aceite (CA): **CA-08, CA-28, CA-44, CA-53**.

**T019 — Fluxo de caixa e exportação**
- Saldo inicial + entradas/saídas realizadas e previstas, conferência do saldo final (CA-09); exportação CSV e PDF dos 4 relatórios com os mesmos valores da tela.
- Aceite (CA): **CA-09, CA-11**.

**T020 — Frontend pt-BR**
- Telas: login, empresas, usuários/atribuições, plano de contas, períodos, lançamentos, títulos, conciliação, relatórios, fiscal, auditoria; cliente API tipado (`packages/shared`), erros de recusa exibidos com as mensagens previstas, sem ações proibidas nos papéis errados.
- Aceite (CA [D]/[I]): **CA-01, CA-02, CA-10, CA-12** (trilha na UI), demonstração em UI dos cenários [D] (CA-06, CA-07, CA-31, CA-32), inexistência de ações de gestão para contador (CA-21) e de escrita para admin (CA-33).

**T021 — Verificação integral e reviews**
- Matriz de cobertura: todo CA-01..CA-55 com teste nomeado `CA-XX ...` (ou `[D]` documentado), **CA-30** (sessão expirada no meio do formulário), **CA-12** e **CA-34** completos (multimódulo), re-execução da suíte inteira; **code review** independente; **security review (RK-6)** incluindo o checklist de exposição pública da ADR-0003 (HTTPS, cookies, CSRF, rate limit, headers, CORS); correção de achados.
- Aceite: 100% dos CA com resultado registrado; nenhum achado crítico de segurança aberto; suíte verde.

**T022 — Implantação (sem compra de VPS)**
- Script de backup `VACUUM INTO` + cron de exemplo, **teste de restauração documentado** (RK-5/D3), runbook de subida no VPS da ADR-0003, checklist pré-publicação (RK-6, v4 de segurança aprovada, H9 resolvido).
- Aceite: restore a partir do backup reproduz o banco; runbook executa do zero; checklist com itens `not_run/blocked` explícitos para o que depende de aprovação humana.

---

## 3. Matriz de critérios de aceite → tarefa

| Tarefa | CA cobertos |
|--------|-------------|
| T011 | 18, 19, 21, 22, 38, 39, 50, 51, 52 |
| T012 | 15, 20, 23, 33, 35, 36, 37 (34 permissão; 34 completo em T021) |
| T013 | 17, 27 |
| T014 | 13, 14, 24, 25, 26, 29 |
| T015 | 03, 04, 05, 31, 32 (+FIX-01) |
| T016 | 06, 07, 16, 40, 41, 42, 43, 55 |
| T017 | 45, 46, 47, 48, 49, 54 |
| T018 | 08, 28, 44, 53 |
| T019 | 09, 11 |
| T020 | 01, 02, 10, 12 (UI) + demonstrações [D] 06, 07, 31, 32 + papéis em UI (21, 33) |
| T021 | 30, 12 (completo), 34 (completo) + **matriz final de todos os 55** |

Conferência: 55 CA, todos atribuídos; CA-12/21/33/34 aparecem em duas tarefas (implementação e verificação final), o que é intencional.

---

## 4. Estimativas e prazo

- **Somatório das tarefas: ≈93 h de trabalho de agente** (estimativa revisada para cima em relação à faixa pré-plano de 50–80 h — o plano detalhou testes e reviews que antes estavam estimados por palpite).
- **Calendário:** 3 a 4 semanas com paralelismo (2–3 agentes em worktrees) e 1 rodada de revisão humana por dia; até 5 semanas se correções pós-review e a verificação dos 55 CA renderem o esperado no lado de cima.
- **Marcos:** fim da semana 1 ≈ T011 (login funcional); semana 2 ≈ T015 (relatórios com FIX-01); semana 3 ≈ T018/T019 + frontend avançado; semana 4 ≈ T021/T022.

### Precisão e quando revisar

Estimativas são horas de agente, não compromisso de calendário. Revisar oficialmente ao fim de T011 (fundação real, não estimativa) e ao fim de T016 (metade da cadeia): se a variância passar de ±30%, reajustar este documento e o `project-state`.

---

## 5. Fora do escopo deste plano

- Compra/contratação de VPS (ação humana — ADR-0003).
- Requisitos v4 de segurança de exposição pública (pendência de aprovação humana — ADR-0003 seção segurança).
- Formato final de exportação H9 (recomendação CSV+PDF, não bloqueante).
- Qualquer conteúdo da landing page (fluxo paralelo — `landpage/`, ADR-0002).
- SPED/ECD/ECF, tributos por receita, boleto/PIX/CNAB, API de banco (seção 11 dos requisitos).
