# ADR-0006: Formato de exportação dos relatórios (H9) — CSV + PDF

- **Status:** Aceito (aprovação humana em 2026-10-21)
- **Data:** 2026-10-21
- **Responsáveis:** Coordenador, com aprovação do usuário
- **Relacionado:** TASK-019 (exportação), TASK-020 (botão de export na tela), TASK-022 (checklist de publicação, que marcava "H9 resolvido" como bloqueador); `docs/requirements/SISTEMA-CONTABIL.md` (RF-18, H9, CA-11); `docs/decisions/ADR-0001-stack-e-arquitetura-sistema-contabil.md` (§ Relatórios/exportação)

## Contexto

A hipótese H9 ficou aberta desde os requisitos: "exportação dos relatórios principais em arquivo (formato a definir)". O ADR-0001 já previa CSV e/ou PDF com bibliotecas abertas (`csv-stringify` / `pdfkit` ou equivalentes) e classificava a escolha como detalhe de implementação não bloqueante. Porém:

- a **T019** precisa implementar o gerador e seu escopo trazia "decisão final de formato H9" como pendência explícita;
- o **CA-11** exige que o arquivo gerado tenha os mesmos valores da tela, conferidos linha a linha em teste;
- o **checklist de publicação da T022** marca "H9 resolvido" como item bloqueante para ir ao ar.

Deixar em aberto empurraria a decisão para dentro da implementação, com retrabalho provável e um bloqueador de release pendurado.

## Decisão

**CSV + PDF**, nos 4 relatórios do MVP (balancete, razão, balanço patrimonial, fluxo de caixa), gerados pela API:

- **CSV** — dado puro em UTF-8 com BOM (abre corretamente no Excel em pt-BR), separador `;` e decimal com vírgula, para conferência e conferência automatizada; é o formato que o teste do CA-11 compara campo a campo com a resposta da API.
- **PDF** — documento fechado para envio ao cliente e arquivamento no escritório (expectativa de compartilhamento citada na própria H9), com a mesma tabela dos valores da tela e identificação da empresa, período e data/hora de emissão.
- **Bibliotecas:** as abertas já previstas no ADR-0001 (`csv-stringify` para CSV e `pdfkit` ou equivalente para PDF). Nenhuma dependência paga, sem CDN, compatível com o deploy em VPS (ADR-0003).
- **Valores:** inteiros em centavos, convertidos para BRL apenas na camada de apresentação dos dois formatos — nenhuma divergência de arredondamento entre tela, CSV e PDF.

## Consequências

- **T019** perde a pendência de formato e passa a implementar dois geradores desde o início (o escopo já estava desenhado para isso).
- **CA-11** passa a ser verificado nos dois formatos: comparação campo a campo (CSV) e conferência de conteúdo/valores no PDF.
- **T020** pode expor o par de botões de exportação em cada relatório sem decisão pendente.
- **T022** tem um de seus bloqueadores de checklist resolvido; restam v4 de segurança, RK-6 e a contratação da VPS.
- Nenhuma mudança de requisitos: a H9 é atualizada na tabela de hipóteses como resolvida, apontando para esta ADR.

## Validação

- Decisão de formato, não de conteúdo: os valores exportados são os mesmos da tela (RF-18) — isso continua sendo verificado pelo CA-11 na T019/T021.
- Se o escritório pedir XLSX no futuro, é extensão do mesmo gerador (formato novo, mesma fonte de dados); nada aqui impede.

## Histórico

- 2026-10-21: decisão criada e aprovada pelo usuário na mesma data, em resposta à pergunta da coordenação (opções: CSV+PDF / só CSV / só PDF / adiar).
