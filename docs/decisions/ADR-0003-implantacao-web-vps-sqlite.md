# ADR-0003: Implantação na web (VPS em São Paulo + SQLite)

- **Status:** Aceito (aprovação humana em 2026-10-20)
- **Data:** 2026-10-20
- **Responsáveis:** Squad (coordenador, a partir de debate com o usuário)
- **Relacionado:** ADR-0001 (stack); `docs/requirements/SISTEMA-CONTABIL.md` (F3, R4, R12, R13, R14, RK-5, RK-6, D3)

## Contexto

Os requisitos já definem um **aplicação web** (F3, R12) multiempresa num mesmo sistema (R14). O que estava em decisão era o **modelo de exposição**: acesso local na máquina do escritório versus publicação na internet. Em 2026-10-20 o usuário optou por **publicar o sistema na web**, o que reabre dois pontos do ADR-0001: o modelo de hospedagem e a suficiência do SQLite para escrita remota concorrente.

Restrições que continuam valendo: `R4` (o sistema não pode depender de serviços pagos obrigatórios — custo de infraestrutura contratada pelo usuário é diferente de licença/serviço gerenciado obrigatório), `R13`/`RK-5`/`D3` (backup e recuperação documentados antes de produção), `RK-6` (dados sensíveis de múltiplos clientes exigem revisão de segurança antes de publicar).

## Opções consideradas

### Opção A — VPS + Node + SQLite (escolhida)

- Um servidor virtual único roda a API Fastify e serve o front estático, com SQLite em volume persistente.
- Benefícios: custo baixo e previsível; operação simples (um processo + um arquivo); backup = cópia consistente do arquivo; aderência total ao `R4`; nenhum serviço gerenciado obrigatório.
- Custos e riscos: um único ponto de falha; backup e restauração dependem de rotina própria; escala limitada a um escritor (ver gatilhos abaixo).

### Opção B — VPS + PostgreSQL (Docker só no servidor)

- Benefícios: replicação, PITR, papéis no banco, escrita concorrente ilimitada.
- Custos e riscos: mais uma peça operacional para um sistema em `H3` (dezenas de empresas); Docker ausente no ambiente de desenvolvimento local, criando assimetria dev/prod; sem benefício mensurável no volume real de escrita estimado.

### Opção C — Servidor dentro do escritório

- Sem custo, dados na própria empresa; porém depende do escritório ligado 24/7, sem SLA, backup manual e — com a decisão de publicar na web — exigiria túnel/domínio público por trás de um link doméstico. Descartada.

### Opção D — PaaS gerenciado (Render, Fly, Railway, equivalentes)

- Descartada por `R4`: planos gratuitos têm limites voláteis e planos pagos seriam serviço gerenciado obrigatório para o sistema funcionar.

## Decisão

**Opção A — publicação em VPS com SQLite.**

### Infraestrutura

- **Recomendação de contratação:** VPS no Brasil, datacenter em São Paulo. Preço verificado em 2026-10-20:
  - **Principal: Hostinger KVM 1 — R$ 29,99/mês na oferta (renovação a R$ 59,99/mês a cada 2 anos)**, 1 vCPU / 4 GB RAM / 50 GB NVMe / 4 TB tráfego, DC São Paulo (desde 2022), pagamento em real com NF brasileira, backups semanais do provedor (não substituem os nossos).
  - Alternativas avaliadas: **Hetzner** (€ 5,99–6,49/mês, sem imposto, provedor sólido, porém DC na Europa ⇒ 150–200 ms do Brasil, cobrança em euro, sem NF BR) e **Vultr** (DC em São Paulo desde 2017, porém dólar + IOF, sem NF BR). Preços da Vultr/Contabo obtidos por referência secundária e não confirmados na página oficial — confirmar antes de contratar.
  - **A contratação é ação humana:** a squad recomenda, não compra.
- **Composição do servidor:** Ubuntu/Debian + Node LTS + reverse proxy (**Caddy** com HTTPS automático via Let's Encrypt, ou Nginx + certbot) + processo da API via `systemd` (ou `pm2`), SQLite em volume persistente fora do diretório efêmero.
- **Portabilidade (`R4`):** o sistema deve ser implantável em qualquer VPS com Node e um arquivo de dados — sem dependência de API/painel específico do provedor.

### Condições que tornam o SQLite correto neste modelo

1. **Uma única instância da API** (um processo escrevendo). Não rodar múltiplas réplicas atrás de load balancer com o mesmo arquivo.
2. `journal_mode=WAL` e `busy_timeout` configurados explicitamente.
3. **`synchronous=FULL`** (não `NORMAL`): custa desempenho, mas garante que corte de energia não perda transações contábeis recentes.
4. Arquivo em **volume persistente** (nunca em FS efêmero de container).
5. **Backup diário pela API de backup do SQLite** (`VACUUM INTO` ou `sqlite3 .backup` — nunca `cp` de arquivo com WAL ativo), **cópia para fora do VPS** e **teste de restauração periódico** (atende `R13`/`RK-5`).

### Gatilhos de migração para PostgreSQL (futura ADR)

Migrar quando qualquer um ocorrer: (a) necessidade de mais de uma instância da API; (b) sustentar centenas de escritas/segundo contínuas; (c) exigência de replicação/PITR ou papéis no nível do banco; (d) ferramentas externas conectando pesadamente durante a escrita. Nenhum gatilho é atingido em `H3` nem em um cenário 10× maior. O caminho já previsto no ADR-0001 (Drizzle) mantém a troca concentrada em configuração/migrações.

### Segurança da exposição pública (obrigatória antes de publicar)

A publicação transforma itens "desejáveis" em pré-condição de produção. Mapeamento com o que já existe nos requisitos:

| Item | Requisito existente |
|---|---|
| Senha argon2, política ≥8, bloqueio após 5 tentativas | `RF-19`, `CA-50`, `H15`/`H16` |
| Sessão validada a cada requisição e revogação imediata | `CA-22`, `CA-37`, `H14` |
| Isolamento de tenant, auditoria append-only | `CA-33..CA-39`, `RK-6` |
| Revisão de segurança antes de publicar | `RK-6` (obrigatória, não opcional) |

**Lacunas identificadas nos requisitos atuais** (a exposição pública exige, mas nenhum CA cobre ainda): HTTPS obrigatório; cookies `Secure`/`HttpOnly`/`SameSite`; proteção **CSRF** (API REST autenticada por cookie é vulnerável); rate limiting no login além do lockout; cabeçalhos de segurança (HSTS, CSP, X-Frame-Options); CORS estrito. **Pendência de aprovação humana:** acrescentar critérios de aceite correspondentes aos requisitos (revisão v4) — alteração de escopo, não aplicada silenciosamente.

## Consequências

- Custo recorrente baixo (R$ 30–60/mês) contratado e operado pelo usuário; a squad não assume custos.
- Um único ponto de falha: mitigado por backup fora do VPS + restore testado; RPO diário (até 1 dia) é aceitável e deve ser confirmado com o escritório.
- SQLite mantém o setup `npm install && npm run dev` idêntico em dev e produção, sem Docker.
- A publicação só pode ocorrer após: (1) `RK-6` — revisão de segurança concluída; (2) rotina de backup documentada e restore testado (`D3`/`RK-5`); (3) lacunas de segurança acima aprovadas e implementadas.
- Preços de VPS variam por promoção e câmbio; reavaliar na data da contratação.

## Validação

- Nenhuma informação restante altera a escolha. Restam pendências de produto: (1) aprovação dos critérios de segurança de exposição pública (v4 dos requisitos); (2) formato de exportação H9 (CSV+PDF recomendado, não bloqueante).

## Histórico

- 2026-10-20: decisão criada (debate usuário + coordenador). Aprovação humana registrada nesta data.
