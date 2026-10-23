# Handoff — revisão de segurança da T017 (fiscal)

- **Data:** 2026-10-22
- **Autor:** security-reviewer, sessão `ses_e9a34fa60ffer6IhB8ntXnL7yo`, por solicitação do coordenador
- **Escopo:** diff da T017 vs HEAD `83b4086` (17 arquivos de `sistema-contabil/`); `.squad/` e front-end fora de escopo
- **Resultado:** aprovado com ressalvas — **nenhum achado crítico/alto de autorização, IDOR ou vazamento**
- **Uso:** A1 e A4 exigem decisão (humana/produto) antes do commit; A2 é correção menor delegável; A3 foi descartado com evidência executada; A5 migra para a T021

---

## Achados

### A1 (médio) — percentuais sem teto → valores absurdos aceitos; divergência de cálculo com caminho teórico para 500 sem trilha

- `packages/shared/src/index.ts:870-876` (`aliquotaCentavosSchema` = `.number().int().min(0)`, **sem `.max()`**) — usado por tabela, regime, multa e juros; CHECKs em `0008_thick_maelstrom.sql` só `>= 0`
- `calcularDas` (`domain/fiscal.ts:99-101`) calcula em `double`; a CHECK `apuracao_das_valor_derivado` recalcula em inteiro 64-bit — divergem quando `base × alíquota` cruza faixas de precisão → violação de CHECK dentro da transação → 500 sem evento (mesma classe dos F1/F2)
- **Investigação executada pelo coordenador (2026-10-22, script node:sqlite):** divergência **confirmada** — ex.: base `1e15` centavos (R$ 1 trilhão/mês) × alíquota 100% → JS `1000000000000000` × SQLite `1000000000000000.4`. Porém **só em magnitudes absurdas**: com alíquota limitada a 100%, a divergência exige base ≥ ~R$ 1 tri/mês; o teto do Simples (~R$ 4,8 M/mês) fica ~3 ordens de grandeza abaixo. Sub-item semântico (lançamentos com encargos/multa absurdos, com trilha mas implausíveis) permanece válido
- **DECISÃO PENDENTE:** opções — (i) `.max(10000)` (100%) só no Zod (1 arquivo, sem migração); (ii) também CHECK na `0008` (mexeria na migração — reconsiderar hand-fix e revalidação); (iii) adiar para T021 registrando risco. Exige aprovação por tocar validação/migração

### A2 (baixo) — recusa 404 de administrador em `autorizarConfiguracaoFiscal` sem evento na trilha

- `apps/api/src/services/permissoes.ts:161-166`: `throw new ErroAplicacao(404, 'Empresa não encontrada.')` direto, sem `recusar()` → sondagem de `empresa_id` por admin nas rotas de configuração fiscal fica invisível para o auditor; RF-05/CE-15 exigem `escopo.tentativa_negada`
- O comentário em :163 ("404 direto, como nas rotas de leitura") está **errado**: a leitura (`autorizarLeituraEmpresa`, :78-87) devolve 403 **auditado** com `motivo: 'empresa_inexistente'`
- Sem oráculo para contador (checagem de atribuição vem antes e devolve 403 genérico)
- **Correção mínima:** trocar o `throw` por `recusar(...)` no padrão da leitura + corrigir o comentário. Correção menor, delegável ao implementer

### A3 (baixo, "precisa de investigação") — **DESCARTADO com evidência**

- Tese: `z.iso.date()` poderia aceitar data impossível de calendário (`2026-02-30`) → `diasDeAtraso` → NaN → 500 sem trilha
- **Investigação executada pelo coordenador (2026-10-22, zod do workspace):** `z.iso.date()` **REJEITA** todas as datas impossíveis testadas (`2026-02-30`, `2026-13-01`, `2026-01-32`, `2026-04-31`, `2026-06-31`, `2026-02-29` em ano não bissexto) e aceita as válidas. **Caminho NaN inalcancável pela validação de entrada** → sem alteração necessária. (Guarda defensiva em `diasDeAtraso` é opcional e cosmética)

### A4 (informativo) — estorno do lançamento do DAS não sinaliza `apuracao_das` → dead-end de reapuração

- `services/fiscal.ts:862-871` (recusa `apuracao_ja_existente` cuja mensagem manda "estorne o lançamento vinculado") × `services/lancamentos.ts` (sem noção de apuração): após estornar o lançamento do DAS, `GET /fiscal/apuracoes-das` segue devolvendo a apuração como válida e `POST` recusa 409 **para sempre** (UNIQUE `apuracao_das_periodo_uk`)
- **Análise do coordenador:** R9/RF-08/RF-05 (lidos na fonte) garantem que estorno é o caminho de correção e são silenciosos sobre reapuração; nenhum RF/CA exige reapuração após estorno — mas a própria mensagem do sistema aponta um caminho que trava. Sem vazamento/escalada; tudo auditado
- **DECISÃO PENDENTE (produto):** (i) tratar estorno do lançamento do DAS como estorno da apuração (libera o período — mexe em `services/fiscal.ts` + possivelmente índice); (ii) adiar com pendência registrada (T021/T022); (iii) outra. Não coberto por requisito — decisão humana

### A5 (informativo) — sem teste de isolamento cross-empresa (IDOR) nas rotas fiscais

- `tests/integration/fiscal.test.ts` não tem teste de recurso alheio (grep `alheia|outra empresa|...` vazio); o isolamento repousa em leitura de código + FKs compostas (ambos corretos, ver abaixo)
- **Correção mínima:** 1 teste por rota nova: contador de A ataca `:id` de B (404 idêntico ao inexistente) e `empresa_id=B` (403 auditado)
- **Migra para o escopo da T021** (já contém lacunas de teste da T016)

## Pontos verificados SEM achado (resumo)

- **IDOR/autorização:** as 12 rotas novas com guard correto (4 config com `exigirConfiguracaoFiscal`; 2 escrita contábil com `exigirEscritaContabil`; 6 GET com `autorizarLeituraEmpresa` antes de query); `empresa_id` gravado sempre do valor autorizado no servidor, nunca do corpo
- **Banco:** FK composta `(id, empresa_id)` em todas as tabelas novas + índices únicos correspondentes — isolamento de tenant não depende só da aplicação
- **Oráculo:** recusas de objeto alheio/inexistente respondem mesmo 404 genérico, com tentativa auditada
- **Auditoria:** escritas e recusas novas com ator + empresa + antes/depois; recusas gravadas fora da transação, antes do throw
- **Estorno de retenção:** `estornarLancamento` recusa via `baixa.retencao_lancamento_id` (inclusive estorno do estorno); catch da UK cobre INSERT de estorno → corrida vira 409 auditado
- **Fronteira papéis:** não existe papel além de administrador/contador que escape da checagem; empresa inativa não abre bypass de escrita contábil (CA-40 preservada)
- **Entrada:** Zod `.parse()` sem mass-assignment; `ano` 1900-9999, `mes` 1-12; retenção/encargos pré-validados antes do INSERT
- **Erros:** handler só devolve `message` de `ErroAplicacao` — sem stack, caminho ou SQL
- **Migração 0008:** sem GRANT; rebuild de `baixa` copia as 11 colunas originais com defaults; CHECKs novos satisfeitos por dado legado

## Riscos remanescentes / limitações do revisor

1. Sem execução (perfil sem npm): A1 e A3 dependiam de validação — **ambos investigados pelo coordenador** (acima)
2. Ciclo completo de sessão/auth (T011) não revisto em profundidade
3. **Concorrência não reproduzida:** `POST /fiscal/regime` e `POST /fiscal/multa-juros` leem estado atual **fora** da transação (`services/fiscal.ts:504-514`, `:619-621`) — dois POSTs simultâneos podem violar a UK e virar 500 sem trilha (H10 aceita corridas de edição no MVP; ADR-0008 tratou o análogo das baixas com predicado otimista). Candidato a acompanhamento na T021
4. Front-end (T020) fora do escopo
