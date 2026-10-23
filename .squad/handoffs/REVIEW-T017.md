# Handoff — revisão independente da T017 (fiscal)

- **Data:** 2026-10-22
- **Autor:** reviewer, sessão `ses_e9a577b7bffeXkzZwuib43ALK7`, por solicitação do coordenador
- **Escopo revisado:** working tree da T017 vs HEAD `83b4086` (17 arquivos de `sistema-contabil/`); `.squad/` e front-end fora de escopo por design
- **Resultado:** aprovado com pendências — nenhum defeito em valores canônicos de CA, fronteira de permissão ou migração; 2 achados altos (500 sem auditoria), 1 baixo, 1 de manutenção
- **Uso:** achados F1/F2/F3/L1/L2 migraram para a rodada de correção `FIX-T017-R1` (sessão `ses_e9a41f6f5ffejNBofAsYPYIGIt`); F4 tratado pela coordenação; os "pontos sem achado" e "riscos remanescentes" alimentam a verificação final e a T021

---

## Achados

### F1 (alto) — retenção com tabela de valor 0 → partida 0 → CHECK aborta → 500 sem auditoria

- `apps/api/src/services/titulos.ts:666-680` (flatMap de `partidasRetencao`, sem filtro de valor > 0) contra `apps/api/src/db/schema.ts:358` (`partida_valor_positivo`, vivo no banco desde `0005_common_famine.sql:27`)
- Cenário: título R$ 1.000,00 com duas tabelas ativas associadas (IRRF + ISS) em que ao menos uma computa zero — tabela de 0% é criável (`aliquotaCentavosSchema` aceita `.min(0)`) e legitimada por teste unitário (`tests/unit/fiscal.test.ts:172`), ou alíquota pequena arredondando a 0 num bruto parcial. `calcularRetencoes` devolve total > 0, a transação monta partidas com valor 0, INSERT aborta no CHECK → 500 "Erro interno do servidor." (`app.ts:69-70`) sem evento `titulo.baixa_recusada` (viola CE-19/CE-2)
- O caminho vizinho já trata o caso total: `titulos.ts:560-575` recusa `retencaoTotal === valorCentavos` citando o CHECK — falta o zero por tabela
- **Correção decidida (FIX-T017-R1):** filtrar itens `valorCentavos <= 0` ao montar `partidasRetencao`; se o filtro esvaziar, recusar auditado antes do INSERT

### F2 (alto) — DAS = 0 (base 0 ou alíquota 0%) → partidas 0 → mesmo 500 sem auditoria, contradizendo a prévia

- `apps/api/src/services/fiscal.ts:853-892`: recusa apenas `baseCentavos < 0` (`base_receitas_negativa`, 400); `dasCentavos` 0 segue para `inserirLancamentoComPartidas` (:866-877) → abort → 500 sem evento `fiscal.apuracao_das_recusada`
- Cenário corriqueiro: regime 6% ativo + apuração de mês **sem receitas**; ou regime com alíquota 0 (CHECK `regime_fiscal_aliquota_nao_negativa` permite)
- Agravante: a prévia (`consultarApuracaoDas`, :755) responde **200 com `das_centavos: 0`** no mesmo cenário — a API diz que é computável e a geração quebra; CA-49/RF-21 exigem recusa com mensagem
- **Correção decidida (FIX-T017-R1):** recusa auditada antes da transação, motivo `das_valor_zero`, mensagem cobrindo os dois gatilhos; prévia continua 200/0 e docstrings documentam a assimetria; status HTTP a seguir o precedente do codebase

### F3 (baixo) — contrato prévia × geração para base negativa

- `fiscal.ts:755` (`Math.max(0, baseCentavos)` só no DAS da prévia) × `:853-861` (geração recusa 400): prévia 200/DAS 0 para base negativa, geração recusa — usuário vê prévia que jamais gera, sem indício
- **Correção decidida (FIX-T017-R1):** confirmar se o DTO da prévia expõe `base_centavos` crua; se não, expor (read-only) e documentar; não recusar a prévia

### F4 (manutenção) — comentário do schema aponta para evidência inexistente

- `apps/api/src/db/schema.ts` (doc de `configMultaJuros`): remete à "hipótese registrada em TASK-017.json" sobre ausência da entidade contrato; `TASK-017.json` só registrava H17/H18
- **Tratado pela coordenação:** hipótese "contrato" registrada em `TASK-017.json` (2026-10-22); comentário do schema permanece como está (correção sem tocar em `schema.ts`, que está fora do escopo da rodada de correção)

### L1 (lacuna) — CA-48 contraste só no unitário

- "Baixa no vencimento não gera multa/juros" coberto apenas em `tests/unit/fiscal.test.ts:112-123`; sem integração com config multa/juros existente → teste de integração exigido em FIX-T017-R1

### L2 (doc) — docstring H17 mais forte que o comportamento

- `fiscal.ts:691-693`: "líquido de estornos" por período; na prática o estorno conta no período da **data do estorno** (semântica pré-existente T014/T015) → docstring a reescrever em FIX-T017-R1

---

## Pontos revisados SEM achado (base de confiança para a verificação final)

- **Aritmética do domínio:** pro rata `mensal/30` com arredondamento meio-em-cima em inteiro (`domain/fiscal.ts:51-66`); CA-48 canônico conferido à mão; `calcularDas` casa exatamente com a CHECK `apuracao_das_valor_derivado` (âncora unitária `fiscal.test.ts:202-209`)
- **Lançamentos:** caixa = líquido + encargos; conta do título abatida pelo **bruto** nas duas operações (CA-47: 950+50; CA-48: 1.000+30, caixa 1.030); dupla partida sempre balanceada
- **Estado do título:** D1 aplicado — CA-16 sobre o bruto nunca estoura; 3 UPDATEs com predicado otimista intactos (`titulos.ts:326-327`, `740-748`, `1058-1066`); estorno com retenção desfaz os dois lançamentos e recusa estorno direto
- **Fronteira de permissão:** `empresa_id` resolvido no servidor em toda rota nova; 403 auditado **antes** do oráculo de existência; admin recusado em DAS/associação (T017-F-2 cumprido com os 2 testes extras); GETs com `autorizarLeituraEmpresa` e lista vazia para título alheio (sem vazamento, sem oráculo)
- **Migração 0008:** `INSERT...SELECT` corrigido à mão confere coluna a coluna com a `baixa` da 0007 (11 colunas; novas nascem 0/NULL); CHECKs coerentes (serviço estrito, banco como retrocesso); índices únicos só sobre colunas novas (upgrades não quebram); snapshot completo
- **Contratos Zod:** `paraDTO*` batem com os schemas; `baixaSchema` estendida coerente; `mesPeriodoSchema` confirma `ultimoDiaDoMes`
- **Testes:** um teste por CA com asserts canônicos; negativos com dado real + controle aceito + estado conferido; recusas verificadas por `motivo` específico, não "qualquer erro"

## Riscos remanescentes (registrados, não bloqueiam)

1. **Runtime dos F1/F2:** o reviewer não reproduz ao vivo (perfil sem npm) — diagnóstico estático; a reprodução red-green é exigência do FIX-T017-R1 e a coordenação re-executará os testes
2. **Semântica de períodos no H17:** estorno conta no período da data do estorno; o docstring foi corrigido (L2), mas a regra permanece semântica pré-existente — se o escritório exigir competência do período original, é mudança da T014/T015 (candidata a pendência)
3. **Baixa parcial com encargos:** usa o **bruto parcial** como base de multa/juros (coerente com D1), mas a semântica para baixas parciais sucessivas não está escrita em lugar nenhum → candidata a hipótese/ADR se houver exigência
4. **Instância nova de "404 sem oráculo"** em `routes/fiscal.ts:167-189` (padrão 404 auditado sem hipótese de oráculo) — soma à pendência de deduplicação já registrada na T021
5. **`reaisDe` local** e padrões de serviço duplicados — não piorou materialmente; juntam-se à limpeza geral da T021
