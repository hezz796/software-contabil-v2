# ADR-0004: Decisões de produto da interface (Q-UI-1..3) e aprovação dos wireframes

- **Status:** Aceito (aprovação humana em 2026-10-20)
- **Data:** 2026-10-20
- **Responsáveis:** Squad (product-analyst + coordenador), com aprovação do usuário
- **Relacionado:** TASK-023, TASK-018, TASK-020; `docs/requirements/SISTEMA-CONTABIL.md` (RF-02, RF-16, RF-20); `docs/design/UIUX-DIRETRIZES.md` (§9, §10, §12)

## Contexto

A T023 (wireframes e diretrizes) entregou a estrutura das 11 telas e identificou 3 lacunas nos requisitos que a UI precisava resolver antes do frontend (T020). O usuário respondeu em 2026-10-20: **"(1) Eu aprovo com ressalvas (será preto e branco?); (2) Aprovado"** — aprovação dos wireframes com uma ressalva conceitual e aprovação das recomendações do analista (Q-UI-1..3).

## Decisões

### Q-UI-1 — Como se concede o "contador autorizado" da configuração fiscal (RF-02/RF-20)

**Decisão:** flag por usuário (`pode_configurar_fiscal`), concedida e revogada apenas pelo administrador, com auditoria de alteração. Não existe terceiro papel: os papéis continuam administrador e contador (H6/F13 intactos).

- Efeito no CA-54: usuário sem a flag (ou sem atribuição à empresa) ⇒ recusa + trilha; admin com a flag ⇒ permitido + auditado.
- Efeito na UI: campo na tela de usuários (`usuarios.html`, hoje marcado `[A DEFINIR]`) e na matriz de visibilidade.

### Q-UI-2 — Cadastro de contas bancárias (RF-16)

**Decisão:** o cadastro de conta bancária é **implícito no RF-16** ("a empresa possui contas bancárias próprias") e passa a ser escopo explícito mínimo: nome, saldo inicial, data do saldo inicial (campos já previstos no modelo de dados do ADR-0001, entidade `conta_bancaria`).

- Sem esta decisão a conciliação (T018) ficaria sem o seletor de conta exigido pelo wireframe.
- É a menor das leituras possíveis: não cria tela nova além da necessária ao fluxo 5 (conciliação) nem funções novas.

### Q-UI-3 — Tela inicial / dashboard

**Decisão:** **não haverá dashboard nem KPIs** no MVP (guarda contra `RK-1`). Login encerra em: empresas (admin) / empresas atribuídas (contador). Criar tela inicial seria escopo novo e passaria por revisão de escopo.

### Recessa da aprovação: "será preto e branco?"

**Decisão:** **não.** Os wireframes são estrutura em cinza de propósito (baixa fidelidade, fase de forma). A **fase de estilo** — paleta de cores, tipografia, estados visuais — é etapa seguinte da T020, documentada em `docs/design/ESTILO.md` e aplicada ao app real. A estrutura aprovada agora não muda; cores e tipografia vêm por cima.

## Consequências

- **T018** ganha o escopo mínimo de cadastro de conta bancária (atualizada no arquivo da tarefa e no plano).
- **T020** passa a exigir `docs/design/ESTILO.md` (paleta, tipografia, aplicações) além da implementação das telas; o estilo visual fica sujeito à aprovação humana junto com o restante do frontend.
- **Requisitos não foram reescritos:** as três decisões são interpretações registradas aqui; se o escritório refutar Q-UI-2 ou Q-UI-3, basta refutar esta ADR.
- A aprovação dos wireframes **libera a T020** (gate da T023 cumprido), que segue dependendo da T011 terminar.

## Validação

- Nenhuma pendência aberta desta ADR. Restam de produto: v4 de segurança de exposição pública, H9 (formato de exportação) e RK-8 (validação fiscal com caso real).

## Histórico

- 2026-10-20: decisão criada e aprovada pelo usuário na mesma data.
