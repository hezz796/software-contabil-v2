# ADR-0008: Riscos aceitos e correção de concorrência no módulo financeiro (T016)

- **Status:** Aceita
- **Data:** 2026-10-22
- **Responsáveis:** humano (decisão) + coordenador (registro); correções via implementer

## Contexto

A T016 (títulos, baixa total/parcial, cancelamento e estorno de baixa) foi entregue e verificada pelo coordenador no plano sequencial (15 arquivos / 79 testes, migração do zero, CA-55 com fixture ordenada). Em 2026-10-22, por iniciativa do coordenador após auditar o uso dos agentes da squad, a T016 passou por duas revisões independentes que **nunca haviam sido aplicadas a nenhum marco do projeto**:

- **Reviewer de código** (`ses_e9b625c27ffeHoRNqbYjTHvxQD`): 9 achados — 1 Alto, 2 Médio, 5 Baixo, 1 Nit.
- **Security-reviewer** (`ses_e9b4bea74ffeNvH7OjQeedZwKP`): 4 achados — 2 Baixo, 2 Nit; e **confirmou no código** as 5 correções de segurança herdadas da T014 (S-T014-1/2/3/5/6).

O achado **Alto** corrige a aceitação anterior do coordenador: as validações de estado em `criarBaixa`/`estornarBaixa`/`cancelarTitulo` rodam **fora** da transação e os `UPDATE` não têm predicado de revalidação — duas baixas simultâneas podem gravar saldo derivado de leitura velha, produzindo `Σbaixas > valor` **sem que o CHECK `titulo_saldo_na_faixa` capture** (o valor escrito sempre cai na faixa). O plano sequencial e os 79 testes não enxergam essa classe.

Este ADR registra as três decisões humanas tomadas sobre esses achados em 2026-10-22.

## Opções consideradas

### Decisão 1 — Correção da corrida read-modify-write (achado Alto)

**Opção A — Predicado otimista no `UPDATE`.**
- Benefícios: sem mudança de schema; é **o padrão que o próprio `estornarBaixa` já usa** (`isNull(estorno_lancamento_id)` + `changes !== 1` → 409); correção pequena, testável e restrita ao módulo.
- Custos e riscos: depende de o estado esperado ser expressível no `WHERE`; não protege escritas futuras que esqueçam o predicado.

**Opção B — Serializar com `BEGIN IMMEDIATE`.**
- Benefícios: cobre a classe inteira de corridas de escrita.
- Custos e riscos: altera o comportamento de **todas** as escritas do sistema; maior exposição a `database is locked` sob carga; blast radius desproporcional para um achado localizado.

**Opção C — Trigger de invariante no banco (`saldo = valor − Σ baixas vigentes`).**
- Benefícios: máxima garantia (invariante no banco, regra 4 do `AGENTS.md`).
- Custos e riscos: correção mais complexa; cálculo de soma dentro de trigger tem efeitos colaterais e custo; maior chance de regressão.

### Decisão 2 — Imutabilidade de `baixa`/`titulo` no banco (achado SEC-2)

**Opção A — Registrar como risco aceito.**
- Benefícios: nenhuma rota de API deleta `baixa`; o ataque exige acesso ao host ou defeito interno; o modelo de segurança do produto sempre escopou append-only a `lancamento`/`partida`/`audit_event`.
- Custos e riscos: SQL direto (ou bug futuro) pode desalinhar `titulo.saldo` sem o banco recoje.

**Opção B — Triggers (`BEFORE DELETE` + colunas congeladas em `UPDATE`).**
- Benefícios: fecha o buraco residual no banco.
- Custos e riscos: o estorno **precisa** atualizar `baixa` (grava `estorno_lancamento_id`), então um `BEFORE UPDATE` genérico é impossível sem quebrar o fluxo; exigiria ajuste em teste de controle — custo maior que o risco do cenário realista.

### Decisão 3 — Oráculo de timing cross-tenant (achado SEC-1)

**Opção A — Aceitar e registrar.**
- Benefícios: a resposta (status/corpo) é **idêntica**, cumprindo a letra de R7/CA-22; a exploração exige sessão válida e **é auditada** (`*.tentativa_negada`), tornando-se rastreável e de baixo valor.
- Custos e riscos: a latência distingue "existe em outro tenant" de "não existe" (1 SELECT + 1 INSERT com fsync).

**Opção B — Equalizar o custo nos dois ramos.**
- Benefícios: fecha a distinção temporal.
- Custos e riscos: gravar evento também no caminho "inexistente" polui a trilha e contradiz o princípio "só a tentativa alheia deixa trilha".

## Decisão

1. **Corrida: Opção A** — predicado otimista no `WHERE` de cada `UPDATE` de `titulo` (saldo/situação esperados), com `changes !== 1` → **409 auditado**, espelhando o padrão já existente no estorno de baixa.
2. **Imutabilidade: Opção A** — `baixa` e `titulo` permanecem sem triggers de imutabilidade; **risco aceito e registrado aqui**.
3. **Timing: Opção A** — oráculo de latência aceito e registrado aqui; igualdade de resposta mantida.

## Consequências

- Impactos positivos: a classe de corrupção silenciosa de saldo/situação fica bloqueada no caminho de escrita corrigido; o estorno concorrente deixa de devolver 500 sem trilha; a memória da decisão deixa de depender da conversa.
- Custos ou limitações: o predicado protege o que foi corrigido, não o que existir no futuro — escritas novas em `titulo` precisam seguir o mesmo padrão (revisões futuras devem olhar isso); a invariante `saldo = valor − Σ baixas` continua **sem** garantia de banco.
- Riscos e mitigação: escrita futura que esqueça o predicado reabre a janela — mitigado pelo reviewer de cada marco e pela T021; acesso direto ao arquivo SQLite continua capaz de desalinhar `baixa`/`titulo` — aceito, pois exige privilégio no host.
- Efeitos sobre implementação e operação: sem mudança de schema pela decisão 2; a decisão 1 é só de serviço; nenhum efeito operacional novo.

## Validação

- **Decisão 1:** teste de concorrência (`Promise.all` de duas baixas de 600,00 sobre título de 1.000,00) deve garantir **uma aceita e uma recusada**, `saldo` = 400,00 e `Σbaixas vigentes` = 600,00; prova de discriminação = teste fica vermelho com a correção revertida (limitação declarada se a corrida não se manifestar no harness).
- **Decisões 2 e 3:** nenhum teste — são registros de aceite; a validação é que o comportamento observado permanece o descrito (nenhuma rota deleta `baixa`; respostas 404 idênticas).
- **Pendências herdadas das revisões, fora deste ADR** (registradas no `TASK-016.json`/`project-state` pelo coordenador): lacunas de teste (filtros de `GET /titulos`, 404 de conta, período da data do estorno, ramos inalcançáveis) e a deduplicação da lógica "404 sem oráculo" em 3 cópias — adiadas por decisão de escopo de 2026-10-22.

## Histórico

- 2026-10-22: decisão criada, a partir das revisões da T016 (`ses_e9b625c27ffeHoRNqbYjTHvxQD` e `ses_e9b4bea74ffeNvH7OjQeedZwKP`), com escolha humana explícita das três Opções A.
