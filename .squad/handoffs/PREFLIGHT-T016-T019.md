# Handoff — pre-flight de requisitos T016..T019

- **Data:** 2026-10-22
- **Autor:** product-analyst, sessão `ses_e9be52e58ffeDbGLzVN94TKfMM`, por solicitação do coordenador
- **Motivo:** na T015 a leitura atenta de requisito achou tensão (CA-24 × CA-32) e uma asserção vazia (CA-31) que custaram rodadas extras. Este pre-flight caça esses casos **antes** que a squad os implemente.
- **Uso:** os itens de **T016** já estão embutidos no brief da T016. Os demais alimentam os briefs de T017, T018 e T019 — leia ao abrir cada tarefa.

---

## T016-F-1 (grave) — estorno direto do lançamento de baixa já é possível hoje

`POST /lancamentos/:id/estorno` (T014) **não sabe o que é baixa**: só guarda `ja_estornado` e período aberto (`services/lancamentos.ts:244-269`). Depois que a T016 existir, essa rota aceita o lançamento gerado por uma baixa e reverte o efeito contábil **sem reabrir o título** (título `pago`, saldo 0, razão revertido). Depois disso o estorno de baixa (CA-42) ou falha com "já estornado" ou gera reversão dupla. RF-15 e o "realizadas = baixas" da T019 divergem em silêncio.

**Decisão do coordenador (2026-10-22):** recusar na rota existente o estorno de lançamento vinculado a baixa, com mensagem orientando ao estorno de baixa e auditoria — mesmo padrão de H20/CE-18. Não permitir estornar individualmente o lançamento de estorno da baixa. Interpretação técnica, registrável em `assumptions`.

## T016-F-2 (grave, decide o schema) — CA-16 × CA-47 × CA-48

CA-16 recusa "valor informado maior que o saldo do título". CA-48 exige pagar **1.030,00** sobre saldo 1.000,00 (vencido 30 dias). CA-47 trabalha com **líquido 950,00 + retenção 50,00**.

**Decisão do coordenador (2026-10-22):** `baixa.valor_centavos` = **bruto abatido do saldo** (a validação "valor > saldo" do CA-16 permanece literalmente sobre o bruto ⇒ informa-se 1.000,00), com **retenção e encargos em colunas próprias** refletidas no lançamento vinculado (caixa 950,00 com retenção 50,00; ou caixa 1.030,00 com encargos 30,00). O invariante "lançamentos vinculados somam o valor total do título" (CA-41) fica escopado a **baixa sem encargos/retenção**. Reversível enquanto a T016 não estiver implementada.

## T016-F-3 (cobertura) — cancelamento de título não tem CA nenhum

RF-13 e F11 mandam cancelar títulos; a T016 inclui; **nenhum CA cita cancelamento**. A T021 (matriz CA-01..55) nunca o verificaria. "Em aberto" é ambíguo (só `aberto`, ou `aberto`+`parcial`?) e o destino do saldo residual não está escrito.

**Hipótese a registrar na T016:** "em aberto" = não quitado nem cancelado; cancelamento é escrita financeira (contador), **não gera lançamento**, zera o saldo residual com auditoria; lançamentos de baixas parciais permanecem (imutabilidade R9). Teste extra nomeado sem número de CA + limitação registrada.

## T016-F-4 (atomicidade) — CA-55 **não** é barrado pelo trigger da 0006

O trigger `lancamento_no_periodo_encerrado` aborta INSERT em período encerrado, mas o **estorno** seria datado de *hoje* (período aberto) e **passaria**. A recusa do CA-55 é regra de serviço sobre o **período da baixa**, com auditoria persistida **fora** da transação que aborta (senão some a "tentativa auditada").

**Fixture obrigatoriamente ordenada:** baixa com período aberto → encerrar via serviço da T015 → tentar estorno. Não dá para criar a baixa "já em período encerrado" (o trigger abortaria o INSERT). Mesma classe: baixa com data em período encerrado não tem CA, mas aborta no banco se o serviço gravar o lançamento antes de checar — checar e recusar **antes**, em transação.

## T017-F-1 (= T016-F-2) — mesmo conflito numérico, decide o schema da T016 primeiro

Ver T016-F-2. Precisa estar resolvido **antes** da migração da T016.

## T017-F-2 (fronteira de permissão) — quem gera o lançamento do DAS

RF-20: configurar regime/alíquota é administrativo (pode_configurar_fiscal, Q-UI-1), mas **gerar o lançamento do DAS é escrita no razão**. CA-54 testa só alteração de tabela — ninguém testa "admin tenta gerar lançamento de DAS". Mesma lacuna para associação tabela↔título (alterar título é escrita financeira).

**Hipótese:** `exigirEscritaContabil` na geração do DAS e na associação; apuração/exibição = leitura; teste extra admin → 403 auditado.

## T019-F-1 (plano) — T019 depende da T018, não só da T017

CA-09 exige saldo inicial de R$ 10.000,00, que vem de `conta_bancaria` — tabela que **só nasce na T018** (Q-UI-2). `TASK-019.json:depends_on` dizia apenas `TASK-017` e o texto dizia "tarefa paralela segura com T018"; **ambos corrigidos pelo coordenador em 2026-10-22**.

Ambiguidade real: RF-17 diz fluxo "por empresa" mas o wireframe `relatorios.html` não tem seletor de conta — com várias contas bancárias, de qual vem o saldo inicial? **Hipótese:** fluxo por empresa, saldo inicial = soma dos `saldo_inicial` das contas com `data_saldo_inicial` ≤ início do intervalo. Se o fluxo for por conta, muda RF-17 e o wireframe ⇒ decisão humana.

## T019-F-2 (escopo) — CA-11 fala em "ação de exportação" mas front-end é T020

TASK-019 exclui front-end; o AC repete CA-11 literalmente. ADR-0006 manda conferir CSV **e** PDF, e o plano da T019 só prevê CSV.

**Hipótese:** a T019 fecha arquivo↔API campo a campo (CSV) + conferência de valores no PDF (definir método); "ação de exportação" e "conferência com a tela" ficam para T020/T021.

## T019-F-3 (modelo × fiscal) — o que é "realizada" com retenções e encargos

RF-17: realizadas = títulos baixados; previstas = em aberto. Com T017, "realizada" vale pelo caixa efetivo (950 líquido / 1.030 com encargos) ou pelo bruto da baixa? Parcialmente baixado: previsto = saldo ou valor total? Baixa estornada sai do realizado? Nenhum CA cobre.

**Hipótese:** realizadas = baixas vigentes (não estornadas) pelo valor de caixa do lançamento vinculado; previstas = saldo em aberto. Visão bruta seria decisão humana.

## T018-F-1 (fronteira de permissão) — conta bancária e extrato

Q-UI-2 definiu **campos**, não permissão; RF-16 não cita papel.

**Hipótese conservadora:** conta bancária (com saldo inicial) e itens de extrato = escrita financeira ⇒ contador com escrita, admin só lê. Se for "configuração administrativa" como a fiscal, exige ADR no padrão de Q-UI-1.

## T018-F-2 (lacunas menores, registráveis)

- RF-16 "um título **e/ou** um lançamento" × CA-28 exclusividade: ler "e/ou" como alternativo, um objeto por vez.
- Dois itens de extrato conciliando o **mesmo** lançamento/título: CA-28 protege só item→dois objetos; hipótese: recusar o segundo.
- Reimportar o mesmo arquivo (`importacao_extrato.arquivo_hash`): sem CA; hipótese: recusar duplicata idêntica.

## T016-F-5 (escopo) — o JSON governa, não o resumo delegado

O resumo davam à T016 "RF-21..24, CA-41..47, CE-9, H20", mas `TASK-016.json` joga **fiscal para T017** e **CA-44/CE-9/H20 para T018**. Briefs devem seguir o JSON.

---

## Checagem de impossibilidade vs. banco

**Zero critérios de T016..T019 exigem editar ou apagar `lancamento`/`partida`.** CA-25 exige justamente a indisponibilidade da edição; estorno e estorno de baixa são INSERTs; CA-16/41/42/43/55 alteram `titulo`/`baixa` (tabelas novas); CA-28/CA-44 alteram conciliação; CA-45/CA-54 alteram configuração fiscal (permitido por RF-20). Risco residual único: **atomicidade** quando o INSERT de lançamento aborta (transação + auditoria da recusa fora da transação).

## Tarefas limpas

- **T018** — a mais limpa; só hipóteses menores (F-1, F-2).
- **T016** e **T017** têm achado material; **T019** tem achado de dependência e de escopo de AC.

## Lacunas de cobertura a registrar (fecham na T021)

cancelamento, baixa em período encerrado, baixa em empresa inativa, reimportação duplicada/dois itens→mesmo objeto, admin×geração de DAS. CA-12/30/34 multimódulo já estão na T021.
