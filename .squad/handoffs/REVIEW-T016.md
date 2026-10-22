# Handoff — revisões da T016 (reviewer + security-reviewer) e triagem

- **Data:** 2026-10-22
- **Motivo:** a T016 foi a **primeira** entrega do projeto submetida a revisão independente antes do commit (marcos anteriores passaram só pela verificação do coordenador). Este arquivo preserva os achados — antes eles existiam apenas na conversa.
- **Sessões:** reviewer `ses_e9b625c27ffeHoRNqbYjTHvxQD`; security-reviewer `ses_e9b4bea74ffeNvH7OjQeedZwKP`.
- **Decisões humanas de 2026-10-22:** registradas no **ADR-0008** (`docs/decisions/ADR-0008-riscos-aceitos-e-correcao-concorrencia-t016.md`).
- **Estado deste arquivo ao gravar:** rodada de correção C1..C7 em execução pelo implementer (`ses_e9b3c900cffePf7r5MMxruB2Tx`); itens 5 e 7 **adiados**.

---

## Correção da aceitação do coordenador

O coordenador havia aceitado a T016 verificando o plano **sequencial** (que está correto). O reviewer achou a classe de **concorrência** que a verificação não enxergava. Lição: verificação funcional + testes verdes **não** cobrem read-modify-write; revisão de código é necessária em marco com escrita de estado derivado.

---

## Reviewer de código — 9 achados

| # | Sev. | Achado | Status na triagem |
|---|---|---|---|
| 1 | **Alto** | **Corrida read-modify-write** em `criarBaixa` (`titulos.ts:360-501`), `estornarBaixa` (`:569-718`), `cancelarTitulo` (`:281-307`): validação fora da transação + `UPDATE` sem predicado de revalidação. Duas baixas simultâneas (600+600 sobre 1.000) → `Σbaixas > valor` e saldo mentindo; **CHECK `titulo_saldo_na_faixa` não pega** (valor escrito sempre na faixa). Corrida baixa×cancelamento reescreve `situacao` de título cancelado. | **C1 — correção em voo** (predicado otimista, decisão humana D-R1) |
| 2 | Médio | Estorno de baixa **concorrente** → **500 sem trilha**: o `INSERT` do lançamento de estorno (`:684`) viola `lancamento_estorno_de_uk` **antes** do `UPDATE` guardado (`:699-703`); o ramo `changes !== 1` fica inalcançável nesse cenário e a constraint decididora não é mapeada. | **C2 — correção em voo** (409 auditado com match exato) |
| 3 | Médio | **Bomba de data no CA-55** (`titulos.test.ts:637-655`): teste fixa "hoje" em `2026-10` e depende do `hoje()` da rota — **a partir de 2026-11-01 a suíte inteira quebra** sem mudança de código. | **C3 — correção em voo** |
| 4 | Baixo | `titulo.tipo` **sem `CHECK` no banco** (`0007:29`), enquanto `situacao` tem guarda — e `tipo` decide o sentido D/C (`titulos.ts:453`). Viola a regra 4 do `AGENTS.md`. | **C4 — correção em voo** |
| 5 | Baixo | **Lacunas de teste:** filtros de `GET /titulos` (`tipo`/`situacao`/ordenação) nunca exercitados; 404 de conta (`:218-225`, `:418-429`) sem teste; recusa de estorno quando o **período da data do estorno** está encerrado/faltando (`:657-674`) sem teste; ramos inalcançáveis (`ehViolacaoDeEstornoUnico=true`, `changes!==1`); controle negativo do teste `REPLACE` (roda só com pragma ON). | **ADIADO — vai para T021** (decisão humana D-R3) |
| 6 | Baixo | Recusa por **conta inexistente** é a única não auditada do fluxo (`:215-225`, `:418-429`) — as irmãs auditam todas. | **C5 — correção em voo** |
| 7 | Baixo | **3 cópias** da lógica "404 sem oráculo + trilha" (`tituloParaEscritaOu404`, `baixaParaEscritaOu404`, `lancamentoParaEscritaOu404`, ~28 linhas cada) — a lógica de segurança que não pode divergir. | **ADIADO — vai para T021** (D-R3) |
| 8 | Baixo | Comentário em `lancamentos.ts:479-480` **contradiz o código** (descreve o comportamento antigo da S-T014-3: "mascarada", mas o código repropaga). | **C6 — correção em voo** |
| 9 | Nit | Fixture `titulos.ts:22` cita coluna inexistente `criado_para` (real: `criado_por`). | **C7 — correção em voo** |

**Vereditos do reviewer por área:** correção = achados (só sequencial correto; D1/D2/D3 honrados); consistência = achados (só o nº 6; demais padrões conformes); testes = achados (asserções dos CAs **discriminam** de verdade e pré-condições reais são criadas — regra 2 respeitada); migração = achados (só nº 4; SQL↔schema↔snapshot conferidos, nada em 0005/0006 tocado); manutenibilidade = achados (7, 8, 9).

**Limitações declaradas pelo reviewer:** shell negado para comandos não-git (não rodou `npm test`/`typecheck` — usou a confirmação do coordenador como premissa); corridas **não reproduzidas por execução** (análise estática).

---

## Security-reviewer — 4 achados + 5 correções confirmadas

**Confirmado no código (sem achado):** S-T014-1 (predicado no `WHERE`), S-T014-2 (trilha sem oráculo, teste prova 404 idêntico), S-T014-3 (`ehViolacaoDeEstornoUnico` exige código **e** nome exatos, fail-closed), S-T014-5 (`recursive_triggers` em dois níveis + sem risco de recursão: nenhum trigger escreve em outra tabela, grep sem `ON CONFLICT`/`REPLACE` em `src/`), S-T014-6 (FKs compostas + índices-pai + teste cross-tenant abortado por FK). Superfície nova (5/5 rotas autenticadas, guards, empresa do guard, Zod, sem vazamento no error handler) = **sem achados**. Guarda D2 = confirmada (cobre L1 e L2, auditada, sem bypass). Migração 0007 = complementa, nada enfraquece.

| ID | Sev. | Achado | Status na triagem |
|---|---|---|---|
| S-T016-SEC-1 | Baixo | **Oráculo de timing cross-tenant**: id alheio executa 2ª consulta + `INSERT` em `audit_event` (fsync) antes do mesmo 404; id inexistente não. Resposta idêntica (CA-22 cumprido), latência difere. | **Risco aceito** (ADR-0008 — equalizar custo poluiria a trilha) |
| S-T016-SEC-2 | Baixo | `baixa`/`titulo` **sem imutabilidade no banco** (diferente de `lancamento`/`partida`/`audit_event`); SQL direto desalinha saldo sem recoje. `BEFORE UPDATE` genérico é **impossível** (o estorno é um UPDATE legítimo); `BEFORE DELETE` seria viável. | **Risco aceito** (ADR-0008, decisão humana D-R2) |
| S-T016-SEC-3 | Nit | `empresa_id` do objeto alheio gravado em `dados` do evento — **sem disclosure** (`GET /auditoria` é admin-only + leitura global já auditada). | Informativo, nenhuma ação |
| — | Nit | `POST /baixas/:id/estorno` aceita `empresa_id` só no corpo (guard aceita body+query; rota é mais estrita) — **mais restritivo, sem bypass**. | Informativo — rotear para lógica de negócio/testes se algum dia importar |

**Limitação declarada:** análise estática; shell negado para `npm test`/`typecheck`.

---

## Pendências que a T021 precisa absorver

1. **Lacunas de teste da T016** (achado 5 do reviewer) — filtros de `GET /titulos`, 404 de conta, período da data do estorno, ramos inalcançáveis, controle negativo do `REPLACE`.
2. **Deduplicação da lógica "404 sem oráculo"** (achado 7) — 3 cópias; unificar exige generics sobre tabelas Drizzle (não trivial); as duas cópias dentro do próprio `titulos.ts` já seriam evitáveis.
3. **Comportamentos sem CA nenhum** (pre-flight T016): cancelamento de título, baixa em período encerrado, baixa em empresa inativa — a matriz CA-01..55 nunca os verificaria.
4. **Re-verificar C1..C7** — os testes de corrida dependem de a interleaving se manifestar no harness; a prova de discriminação (vermelho sem correção) está sendo exigida do implementer, mas a T021 deve rechecar que os predicados continuam presentes em escritas novas de `titulo`.
5. **Riscos aceitos (ADR-0008)** — se o modelo de ataque mudar (ex.: app multi-processo com write contention real), reavaliar a decisão 2 (imutabilidade de `baixa`).

## Nota de processo

Nenhum dos dois revisores pôde rodar shell além de `git` — leitura estática pura, com limitação declarada em ambos. Se a T021 for delegada a `qa`/`reviewer`, **confirmar antes** se o perfil de permissão deles permite executar a suíte; se não, o valor da revisão cai bastante.
