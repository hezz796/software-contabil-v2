# Requisitos v4 — Segurança da exposição pública (REQUISITO APROVADO — ADR-0007)

- **Documento:** `docs/requirements/v4-SEGURANCA-EXPOSICAO-PUBLICA.md`
- **Tarefa de origem:** TASK-021 (qa) — item de escopo *"consolidacao das lacunas de seguranca da exposicao publica como proposta de requisitos v4 (para aprovacao humana)"*; desbloqueia o item bloqueador da TASK-022 (*"v4 de seguranca aprovada"*).
- **Data:** 2026-10-21
- **Status:** **APROVADO em 2026-10-21 pelo usuário** (V4-PA-1..5 resolvidas; registro formal em `docs/decisions/ADR-0007-aprovacao-requisitos-v4-seguranca.md`; ver §6 e o bloco STATUS). Continua **não alterando** `docs/requirements/SISTEMA-CONTABIL.md` — complementa-o.
- **Fontes (rastreabilidade):** `docs/requirements/SISTEMA-CONTABIL.md` (RF-03/RF-04/RF-05/RF-19, R4/R6/R7/R10/R11/R13, RK-5/RK-6, H14/H15/H16) · `docs/decisions/ADR-0001-stack-e-arquitetura-sistema-contabil.md` · `docs/decisions/ADR-0003-implantacao-web-vps-sqlite.md` (seção "Segurança da exposição pública") · `.squad/tasks/TASK-021.json` · `.squad/tasks/TASK-022.json` · código da T011 (`sistema-contabil/apps/api/src/`) · `docs/plans/PLAN-IMPLEMENTACAO.md` (padrão de estimativas).

> **Nota de escopo:** este documento **não altera nenhum arquivo de código** (`sistema-contabil/**` intocado). Ele consolida, em linguagem de requisito, as lacunas que o ADR-0003 já identificou e que a security review da T021 confirma contra o código. A implementação acontece nas tarefas já mapeadas (§5, §6).

---

## 1. Contexto e escopo

### 1.1 O que é "exposição pública" neste projeto

Até aqui o sistema é um app de escritório. O **ADR-0003** decidiu publicá-lo na web: **VPS única em São Paulo**, **SQLite em disco** (WAL, `synchronous=FULL`), **API Fastify e web React/Vite servidas pelo mesmo origin**, atrás de um **reverse proxy (Caddy ou Nginx) com TLS (Let's Encrypt)**. Essa mudança transforma itens antes "desejáveis" em **pré-condição de produção** (ADR-0003, § Segurança; `RK-6` exige revisão de segurança antes de publicar).

Este documento cobre exatamente essas lacunas: **HTTPS/HSTS, CORS, CSRF, rate limiting, headers de segurança, hardening do reverse proxy, gestão de segredos, logs/monitoramento mínimo, backup/restore e atualização de dependências.**

### 1.2 O que a v4 cobre

Requisitos de **superfície de rede e operação** que protegem a aplicação já autenticada e isolada por tenant (T011). Cada requisito abaixo tem valor concreto (header, status ou configuração), método de verificação e tarefa implementadora.

### 1.3 O que continua fora desta proposta (e por quê)

| Item fora | Justificativa breve |
|---|---|
| **SSO / OAuth / MFA** | Usuários são internos do escritório (F9/PB-1); login+sessão (T011) atende. MFA é evolução prevista, não MVP — adicionar agora exigiria fluxo/UX novo sem requisito que o peça. |
| **WAF (web application firewall)** | Serviço/feature adicional; `R4` proíbe depender de serviço pago obrigatório e a superfície do app (API JSON com auth por cookie) não justifica WAF no volume de `H3`. Hardening do proxy (V4-06) cobre o básico. |
| **Detecção de intrusão / SIEM / honeypot** | Operação de SOC é fora da alçada de um escritório e de `H3`; a trilha de auditoria (RF-05) + monitoramento mínimo (V4-08) dão visibilidade proporcional ao risco. |
| **Penetration test externo contratado** | Custo/terceiro; `RK-6` pede *revisão de segurança* (T021), que este documento complementa. Um pentest pode ser decisão futura do escritório, não requisito do MVP. |
| **Rate limiting global por IP no proxy para todas as rotas** | Proteção útil, mas o risco real é automatização de login e endpoints caros; V4-04 foca nesses. Rate limit amplo demais pode derrubar usuário legítimo atrás de NAT de escritório. |
| **Backup georredundante / RPO < 1 dia** | ADR-0003 aceita RPO diário (até 1 dia) para o MVP; V4-09 cobre backup diário + restore testado. Multi-região é escala futura. |

---

## 2. O que já está atendido (não reabrir na aprovação)

Itens que a **T011/ADR-0001/ADR-0003** já entregaram ou decidiram — a v4 **não** os duplica como pendência. Evidência em código:

| Item | Situação | Evidência |
|---|---|---|
| Sessão por **cookie assinado** HttpOnly + SameSite=Lax, `Secure` por env (padrão `true` em produção), `Max-Age` = TTL | **Atendido** | `routes/auth.ts` (`opcoesCookie`); `config.ts:75` (`sessionCookieSecure ?? NODE_ENV==='production'`) |
| **Sessão validada a cada requisição** + `usuario.ativo` (revogação imediata, R10/CA-22/CA-37) | **Atendido** | `middleware/auth.ts` (`exigirAutenticacao`); `services/sessao.ts` (`carregarAutenticacao`) |
| **Bloqueio de login** após 5 falhas (15 min), Argon2id, eventos de acesso auditados (RF-19, H15/H16, CA-50/51/52) | **Atendido** | `services/autenticacao.ts`; `config.ts` (`LOGIN_MAX_TENTATIVAS`, `LOGIN_BLOQUEIO_MINUTOS`) |
| **Trilha de auditoria append-only** (triggers `RAISE(ABORT)`), escrita na mesma transação (RF-05/R8/R11) | **Atendido** | `services/auditoria.ts`; ADR-0001 § Desenho da auditoria |
| **Sem CORS liberado** (nenhum plugin CORS registrado; API e web no mesmo origin no deploy) | **Atendido por omissão** | `app.ts` registra só `fastifyCookie` — ver V4-02 para mantê-lo explícito e verificável |
| **Handler de erro genérico** (500 não vaza detalhe interno) | **Atendido** | `app.ts` (`setErrorHandler`) |
| **`Secure` do cookie em produção** | **Atendido** | `config.ts:75` |

> O que a v4 agrega sobre essa base: **HSTS, headers de defesa do navegador, rate limit por IP/usuário além do lockout, política CORS explícita, hardening do proxy, disciplina de segredos, logs/monitoramento, backup e dependências.**

---

## 3. Requisitos propostos (V4-01..V4-10)

Cada requisito traz: **origem** (de onde vem), **valor concreto/status**, **como verificar**, **quando entra** (tarefa) e **custo**. "Custo" é horas de agente no padrão de `PLAN-IMPLEMENTACAO.md`.

---

### V4-01 — HTTPS obrigatório e HSTS

- **Origem:** ADR-0003 (TLS via Let's Encrypt no reverse proxy); lacuna listada em ADR-0003 § Segurança; `RK-6`.
- **Requisito:** todo acesso de produção é **HTTPS** ( TLS 1.2+; TLS 1.0/1.1 desabilitados). O reverse proxy envia **HSTS**: `Strict-Transport-Security: max-age=31536000; includeSubDomains`. HSTS só passa a valer **após** confirmar que o domínio responde íntegro em HTTPS (evita travar o domínio com certificado errado). `preload` **não** é ativado no MVP (decisão irreversível demais para esta fase).
- **Valor concreto:** resposta HTTPS com header `strict-transport-security: max-age=31536000; includeSubDomains`; HTTP (porta 80) redireciona 301 para HTTPS.
- **Como verificar:** `[I]` inspeção de header via `curl -I https://<dominio>/health`; `[I]` `curl -I http://<dominio>` retorna 301→HTTPS; checklist do runbook.
- **Quando entra / tarefa:** **T022** (runbook: certbot/Caddy + config do proxy + HSTS). Complementa o escopo já previsto.
- **Custo:** +0,5 h (documentar HSTS e o gate "só após TLS confirmado" no runbook).

---

### V4-02 — CORS: política de mesmo origin, negação explícita

- **Origem:** ADR-0001 (API + web mesmo origin no deploy); ADR-0003; lacuna "CORS estrito" (ADR-0003 § Segurança).
- **Análise:** como API e web são **servidas pelo mesmo origin** em produção (ADR-0003), **nenhum `Access-Control-Allow-Origin` é necessário**. O estado atual (nenhum plugin CORS registrado — `app.ts`) já nega cross-origin por omissão. O risco não é "falta de CORS", é alguém **adicionar um CORS permissivo por engano** (ex.: liberar `*` para "facilitar o dev").
- **Requisito:** **nenhuma resposta envia `Access-Control-Allow-Origin`** em produção. Se o ambiente de dev precisar de cross-origin (Vite em porta diferente da API), isso se resolve por **proxy do Vite** (mantém mesmo origin em dev também) ou, se unavoidable, por allowlist restrita ao dev (`localhost`) que **nunca** vai a produção.
- **Valor concreto:** produção — zero cabeçalhos `Access-Control-*` nas respostas.
- **Como verificar:** `[T]` teste via `Fastify.inject` afirmando ausência de `access-control-allow-origin` em respostas de rotas reais (login, /health, dados).
- **Quando entra / tarefa:** **T021** (security review: confirmar ausência; se houver CORS de dev, garantir que não vaza p/ produção). Sem mudança de código se mantiver o status quo.
- **Custo:** +0,5 h (teste de regressão do header).

---

### V4-03 — CSRF: ausência de token é defesa suficiente (com justificativa); Origin-check opcional

- **Origem:** lacuna "proteção CSRF" (ADR-0003 § Segurança, que rotula API REST autenticada por cookie como vulnerável). **Análise honesta do caso concreto:**
- **Análise:** o clássico CSRF pressupõe (a) cookie enviado automaticamente em requisições cross-site **e** (b) endpoint que aceita aquele cookie com efeito colateral. Aqui:
  1. **`SameSite=Lax` no cookie de sessão** (`routes/auth.ts`, `opcoesCookie`) faz o **não-navegador não enviar o cookie em POST cross-site** (Lax só libera cookie em navegação GET top-level). Isso remove o vetor principal de CSRF.
  2. **Mesmo origin** (ADR-0003) elimina o cross-origin no uso real.
  3. A API é **JSON** (`Content-Type: application/json`); um formulário malicioso cross-site não consegue produzir JSON, o que dispararia preflight (bloqueado por V4-02, sem CORS).
  → Conclusão: **o CSRF não é explorável neste desenho.** Um token anti-CSRF por sessão seria **proteção decorativa**: adicionaria armazenamento de token, superfície de bug e atrito de UX sem reduzir risco mensurável. **Não recomendo token decorativo.**
- **Requisito (recomendado):** **não** introduzir token anti-CSRF. registrar a decisão (esta seção) como justificativa perante `RK-6`. **Opcional (defesa em profundidade barata):** hook leve que recusa métodos de escrita (`POST/PUT/PATCH/DELETE`) cujo `Origin` (quando presente) não é o próprio host — custo ~1 linha de configuração, sem token. É aceitável recusá-lo por ser redundante com `SameSite=Lax`; fica a critério humano (§8, V4-PA-3).
- **Valor concreto:** decisão documentada; opcionalmente `403` para escrita com `Origin` divergente.
- **Como verificar:** `[T]` se a defesa opcional for aprovada: `inject` de POST cross-origin retorna `403`; se recusada: registro da decisão é a evidência.
- **Quando entra / tarefa:** **T021** (security review + correção, se a defesa opcional for aprovada).
- **Custo:** 0 h (decisão de não-implementar) ou +1 h (hook + teste, se aprovado em V4-PA-3).

---

### V4-04 — Rate limiting / anti-automatização (login e endpoints caros)

- **Origem:** lacuna "rate limiting no login além do lockout" (ADR-0003 § Segurança); `H16`/`CA-51` cobrem lockout **por usuário**, não por origem.
- **Análise:** o lockout existente (5 falhas → bloqueio 15 min, `autenticacao.ts`) protege **uma conta** contra força-bruta, mas **não** protege contra (a) *credential stuffing* varrendo **muitos usuários** a partir de um mesmo IP, nem (b) enumeração/agendamento de tentativas. Falta controle **por IP/usuário**.
- **Requisito:** aplicar throttling além do lockout:
  - **`POST /login`**: no máx. **10 requisições/min por IP** → excesso responde **`429`** com mensagem genérica (não distingue "existe/não existe" o usuário). Complementa, não substitui, o lockout por usuário.
  - **Endpoints caros** (relatórios, exportação CSV/PDF, importação OFX/CSV): no máx. **30 req/min por usuário** → **`429`**.
  - Atrás do reverse proxy, a API deve confiar no `X-Forwarded-For` (**`trustProxy`** configurado) para enxergar o IP real do cliente — senão todo mundo aparece como o IP do proxy e o rate limit por IP inútil.
- **Valor concreto:** `429` + mensagem genérica nos limites acima.
- **Como verificar:** `[T]` teste que dispara >10 POSTs /login do mesmo IP e observa `429`; teste de `trustProxy` retornando o IP encaminhado.
- **Quando entra / tarefa:** **T021** (correção de achado de segurança; pode usar `@fastify/rate-limit` ou contagem em memória — escolha de implementação, não de requisito).
- **Custo:** +3 h (limitador + `trustProxy` + testes).

---

### V4-05 — Headers de segurança do navegador

- **Origem:** lacuna "cabeçalhos de segurança (HSTS, CSP, X-Frame-Options)" (ADR-0003 § Segurança). HSTS é V4-01; aqui os demais.
- **Requisito:** toda resposta da API (e do front servido) carrega, no mínimo:
  - **`X-Content-Type-Options: nosniff`**
  - **`Referrer-Policy: strict-origin-when-cross-origin`**
  - **`Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`** (nenhuma dessas capacidades é usada pelo app)
  - **`X-Frame-Options: DENY`** **e** CSP **`frame-ancestors 'none'`** (impede clickjacking; DENY cobre navegadores antigos)
  - **CSP** compatível com build Vite local, **sem CDN** (P8/P4 do design; `R4`):
    `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`
    - `script-src 'self'` vale porque o build Vite empacota tudo local (sem CDN de JS).
    - `style-src` inclui `'unsafe-inline'` porque React/Vite pode gerar `<style>`/atributos inline; se o build final for 100% CSS em arquivo, `'unsafe-inline'` pode ser removido — a verificação da T021 confirma.
- **Valor concreto:** os headers acima presentes em respostas de produção.
- **Como verificar:** `[T]` `Fastify.inject` afirmando cada header; `[I]` inspeção no navegador devtools após deploy. A CSP deve ser validada sem quebrar o app (console sem violações).
- **Quando entra / tarefa:** **T021** (correção; aplicação via plugin tipo `@fastify/helmet` ou headers manuais — escolha de implementação). HSTS separado em V4-01/T022.
- **Custo:** +2 h (configuração + testes + ajuste fino da CSP).

---

### V4-06 — Hardening do reverse proxy

- **Origem:** ADR-0003 (Caddy ou Nginx na frente); `R4` (portabilidade — sem depender de painel do provedor).
- **Requisito:** configuração mínima do proxy:
  - **Nginx:** `server_tokens off;` (não revela versão); TLS 1.2/1.3; tempos de timeout razoáveis; **limite de corpo** alinhado ao maior upload aceito (importação OFX/CSV) — ex. `client_max_body_size 5m;` — para não virar vetor de esgotamento; sem listagem de diretório. **Caddy:** config mínima com TLS automático; a exposta é só a app.
  - Redirecionar HTTP→HTTPS (V4-01); servir apenas os endpoints da app (não o filesystem).
- **Valor concreto:** `server_tokens off` (Nginx); resposta sem header `Server` revelando versão; limite de corpo de upload configurado.
- **Como verificar:** `[I]` checklist do runbook; `curl -I` sem versão do servidor no header `Server`.
- **Quando entra / tarefa:** **T022** (runbook — complementa a seção de proxy já prevista).
- **Custo:** +0,5 h.

---

### V4-07 — Gestão de segredos

- **Origem:** `R4` (nada pago, nada em repositório); ADR-0003; achado do código (ver §7).
- **Requisito:**
  - `SESSION_SECRET` de produção: **aleatório forte (≥ 32 bytes)**, gerado uma vez (`openssl rand -base64 32`), **nunca** o valor default. Guardado em `EnvironmentFile` do systemd (permissão `600`, fora do repo), não em `.env` versionado.
  - **Rotação:** documentada — trocar o secret invalida as assinaturas dos cookies (todas as sessões forcem re-login; as linhas de `sessao` no banco permanecem, mas os cookies deixam ser válidos). Procedimento de rotação descrito no runbook.
  - **Guarda fail-fast (recomendada, ver §7):** em `NODE_ENV=production`, a API **recusa subir** com o secret default ou fraco (comportamento já observado no código — V4-PA-4).
- **Valor concreto:** secret ≥32 bytes aleatório em produção; app não sobe com secret default em produção (se V4-PA-4 aprovado).
- **Como verificar:** `[I]` `git grep` sem secret real no repo; `[T]` se a guarda for aprovada: `loadConfig` com `NODE_ENV=production` + secret default lança erro.
- **Quando entra / tarefa:** **T022** (runbook de segredos/rotação); guarda fail-fast em código, se aprovada, na **T021**.
- **Custo:** +0,5 h (documentação) ou +1 h (guarda fail-fast + teste, se aprovado).

---

### V4-08 — Logs e monitoramento mínimo

- **Origem:** `R13`/`RK-5` (operacionais), `RF-05` (auditoria), ADR-0003; `R4` (sem serviço pago).
- **Requisito:** sem depender de serviço gerenciado:
  - Logs estruturados do Fastify para **journald** com **rotação** (tamanho/idade).
  - **Nenhuma credencial em log** (senha, `SESSION_SECRET`, cookie de sessão) — revisar o que é logado (o handler de erro já esconde o 500 interno; manter).
  - Monitoramento leve de eventos de ataque: contagem de `login.falha`/`login.bloqueio` (que a trilha **já registra**) por janela, com alerta simples (ex.: cron que avisa se falhas/hora > limiar). Usa a trilha existente, não novo serviço.
- **Valor concreto:** logs rodam e rotacionam; varredura confirma ausência de credencial; limiar de login.falha definido no runbook.
- **Como verificar:** `[I]` inspeção do runbook e de amostra de log; `[I]` confirmação de que a trilha registra eventos de acesso (CA-52 já cobre).
- **Quando entra / tarefa:** **T022** (runbook de operação).
- **Custo:** +0,5 h.

---

### V4-09 — Backup e restore (coerente com R13 / T022)

- **Origem:** `R13`, `RK-5`, `D3`; ADR-0003 (backup diário por `VACUUM INTO`/`.backup`, cópia fora do VPS, restore testado); **já é núcleo da T022**.
- **Requisito:** já descrito no ADR-0003/T022 — **reiterado aqui como pré-condição de publicação**, não como novo trabalho: backup diário do SQLite por API de backup (nunca `cp` com WAL ativo), cópia para fora do servidor, **teste de restauração executado** (não planejado), RPO diário (até 1 dia) **confirmado com o escritório**.
- **Valor concreto:** restore a partir de backup reproduz o banco com dados conferidos.
- **Como verificar:** já no plano da T022 (gerar backup → alterar/restaurar → conferir).
- **Quando entra / tarefa:** **T022** (já planejado — sem mudança).
- **Custo:** **0 h novo** (item já estimado na T022).

---

### V4-10 — Atualização de dependências

- **Origem:** operação de longo prazo; `R4` (bibliotecas abertas já usadas — ADR-0001/ADR-0006).
- **Requisito:** manter dependências sem vulnerabilidade conhecida:
  - **`npm audit`** executado e sem vulnerabilidade **alta/crítica** antes de cada publicação (resultado registrado no checklist da T022).
  - Node em **LTS**; dependências abandonadas substituídas por alternativa aberta equivalente.
- **Valor concreto:** `npm audit` sem alta/crítica no momento da publicação; saída arquivada como evidência.
- **Como verificar:** `[I]` saída do `npm audit` no checklist de publicação.
- **Quando entra / tarefa:** **T022** (checklist) e recorrente a cada release.
- **Custo:** +0,5 h (item de checklist).

---

## 4. Matriz requisito × risco/critério existente

Mostra cobertura **sem duplicar** o que `SISTEMA-CONTABIL.md` e o ADR-0003 já mapeiam:

| Requisito v4 | Risco / req. / CA existente coberto |
|---|---|
| V4-01 HTTPS/HSTS | `RK-6`, ADR-0003 § Segurança (lacuna "HTTPS obrigatório") |
| V4-02 CORS | ADR-0003 § Segurança (lacuna "CORS estrito"); ADR-0001 (mesmo origin) |
| V4-03 CSRF | ADR-0003 § Segurança (lacuna "proteção CSRF"); `R6` (sem sessão, sem dados) |
| V4-04 Rate limiting | ADR-0003 § Segurança (lacuna "rate limiting além do lockout"); `H16`/`CA-51` (lockout por usuário — complementa) |
| V4-05 Headers | ADR-0003 § Segurança (lacuna "cabeçalhos HSTS/CSP/X-Frame-Options"); `RK-6` |
| V4-06 Proxy hardening | ADR-0003 (composição do servidor); `R4` (portabilidade) |
| V4-07 Segredos | `R4`; ADR-0003; achado §7 (secret default em produção) |
| V4-08 Logs/monitoramento | `RF-05`/`R8` (auditoria), `R13`/`RK-5` (operacionais), `CA-52` (eventos de acesso) |
| V4-09 Backup/restore | `R13`, `RK-5`, `D3`, ADR-0003 — **já planejado na T022** |
| V4-10 Dependências | `R4` (bibliotecas abertas); operação |

> Nenhum requisito da v4 substitui ou contradiz RF-03/RF-04/RF-05/RF-19 ou os CA da T011: eles **complementam** a base já entregue (§2).

---

## 5. Impacto de escopo e custos

A aprovação **não cria nenhuma tarefa nova**: todos os requisitos se **penduram nas tarefas já planejadas** (T021 e T022), que já declaram security review (RK-6) e implantação/runbook em seu escopo. O custo é um **acréscimo de horas** sobre as estimativas atuais.

| Tarefa | Horas atuais (plano) | Horas novas pela v4 | Horas resultantes |
|---|---|---|---|
| **T021** (verificação + security review + correções) | 10 | V4-02 (+0,5) · V4-03 (+0 ou +1) · V4-04 (+3) · V4-05 (+2) · V4-07 guarda fail-fast (+0 ou +1) | 10 → **~16** (ou 15 se V4-03/07 forem recusados) |
| **T022** (implantação/runbook/checklist) | 3 | V4-01 (+0,5) · V4-06 (+0,5) · V4-07 docs (+0,5) · V4-08 (+0,5) · V4-09 (0) · V4-10 (+0,5) | 3 → **~5,5** |
| **Novas tarefas criadas** | — | **nenhuma** | — |

- **Total novo estimado:** **≈ +8 h** de agente (faixa +7 a +9 conforme V4-PA-3/PA-4). Sem nova tarefa, sem mudança de gráfico de dependências.
- **Custo financeiro/serviços:** **nenhum** — tudo com ferramenta aberta (Let's Encrypt, `@fastify/rate-limit`/`helmet` ou equivalentes, journald), compatível com `R4`. Nenhum serviço pago é requisitado.

---

## 6. Pendências de aprovação humana

> Aprovar esta v4 é **alteração de escopo** (ADR-0003 a marcou como pendência humana; a T022 a usa como bloqueador). Cada item pode ser aprovado ou recusado individualmente.

| ID | Pendência | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| **V4-PA-1** | **Aprovar o conjunto V4-01..V4-10** como requisitos de exposição pública (complementares a `SISTEMA-CONTABIL.md`, sem alterá-lo). | (a) aprovar todo · (b) aprovar com recusas listadas · (c) reprovar/reescrever | (a) | item bloqueador da T022 ("v4 aprovada") |
| **V4-PA-2** | **Valores de rate limit** (V4-04): login 10/min/IP; endpoints caros 30/min/usuário. | aprovar valores · ajustar números | aprovar (conservador p/ `H3`) | implementação V4-04 |
| **V4-PA-3** | **Defesa CSRF opcional** (V4-03): hook de checagem `Origin` em escrita. | (a) recusar (redundante com `SameSite=Lax`) · (b) aprovar (defesa barata) | (a) — `SameSite=Lax` + mesmo origin já cobrem; evita proteção decorativa | V4-03 |
| **V4-PA-4** | **Guarda fail-fast do `SESSION_SECRET`** (V4-07/§7): API recusa subir em produção com secret default/fraco. | (a) aprovar (recomendado) · (b) deixar para runbook | (a) | V4-07 |
| **V4-PA-5** | **CSP final** (V4-05): manter `style-src 'unsafe-inline'` ou restringir a `'self'` após confirmar build. | decidir na T021 conforme medição | restringir se o build permitir | V4-05 |

> **Bloco STATUS — PREENCHIDO em 2026-10-21 pela coordenação após resposta humana.** Registro formal em `docs/decisions/ADR-0007-aprovacao-requisitos-v4-seguranca.md`.
>
> **STATUS - RESOLVIDO (2026-10-21).** Registro formal em `docs/decisions/ADR-0007-aprovacao-requisitos-v4-seguranca.md`.
> - **V4-PA-1** **APROVADA** pelo usuário: conjunto V4-01..V4-10 aprovado integralmente.
> - **V4-PA-2** **APROVADA** pelos valores propostos (login 10/min/IP; endpoints caros 30/min/usuário), sem objeção registrada.
> - **V4-PA-3** **RESOLVIDA — recusada pelo usuário**, conforme recomendação: sem token CSRF nem hook de `Origin`; `SameSite=Lax` + mesmo origin + JSON (preflight) cobrem o caso. Proteção decorativa evitada.
> - **V4-PA-4** **APROVADA** pelo usuário: guarda fail-fast do `SESSION_SECRET` (fecha o achado A-1, §7) — entra na T021.
> - **V4-PA-5** **DEFERIDA para a T021**, conforme o desenho do próprio documento: decidir `style-src` após medir o build real (manter `unsafe-inline` se o Vite exigir; restringir a `'self'` se o build permitir).
>
> **Este documento deixa de ser PROPOSTA e passa a ser requisito de exposição pública**, complementar a `SISTEMA-CONTABIL.md` (que permanece inalterado). O item "v4 de segurança aprovada" do checklist da **T022** está **desbloqueado**; restam RK-6 e a contratação da VPS.

---

## 7. Achados que pedem atenção imediata

Fora do escopo estrito da v4, identificados na leitura do código da T011 (relato **sem editar código**; conservador, apenas o defensável com evidência):

- **A-1 — `SESSION_SECRET` cai para um valor default conhecido em produção.**
  - **Evidência:** `sistema-contabil/apps/api/src/config.ts:18` — `SESSION_SECRET: z.string().min(16).default('segredo-de-desenvolvimento-trocar')`. A validação só exige `min(16)`; se a env não for definida, o default (string pública) é usado **mesmo com `NODE_ENV=production`**.
  - **Por que importa:** o secret assina o cookie de sessão; um valor publicamente conhecido enfraquece a assinatura.
  - **Fator atenuante (conservador):** a sessão é **fonte de verdade no banco** — `carregarAutenticacao` (`services/sessao.ts:52`) exige que o id do cookie exista em `sessao`, não expirado e com usuário ativo. Conhecer o secret **por si só** não permite sequestrar sessão sem um id válido de 32 bytes aleatórios. Risco, portanto, é de **hardening**, não explorabilidade direta.
  - **Comportamento esperado:** em produção, recusar subir com o default (fail-fast) — coberto por **V4-PA-4**. Não é corrigido aqui (fora do escopo da T021 enquanto este doc é proposta).

> Nenhum outro achado de segurança grave foi identificado fora do escopo da v4 na leitura de `app.ts`, `config.ts`, `middleware/auth.ts`, `middleware/papel.ts`, `services/sessao.ts`, `services/autenticacao.ts` e `routes/auth.ts`. O rate limiting por IP (V4-04) e os headers (V4-05) são lacunas **previstas** pela v4, não achados inesperados.

---

## 8. Não faz parte desta proposta

Para evitar contaminação de escopo (`RK-1`):

- **Alterar `docs/requirements/SISTEMA-CONTABIL.md`** ou qualquer RF/CA/RK/H existente — a v4 é um documento **complementar e separado**.
- **Implementar código** (`sistema-contabil/**` intocado por esta tarefa).
- **Contratar VPS, TLS, WAF ou qualquer serviço pago** — ADR-0003 define que a squad recomenda, não compra; `R4` proíbe serviço pago obrigatório.
- **SSO/OAuth/MFA, SIEM, detecção de intrusão, honeypot, pentest contratado, backup georredundante** (justificativas em §1.3).
- **Alterar a stack, o modelo de dados ou o desenho de isolamento/auditoria** (ADR-0001/ADR-0003 permanecem).
- **Publicar em produção** — segue bloqueada até: v4 aprovada (§6) + RK-6 concluído (T021) + backup/restore testado (T022) + contratação do VPS (ação humana), conforme ADR-0003.

---

## 9. Checklist de verificação do documento (autoverificação)

- [x] **C1** Documento autocontido (contexto, escopo, requisitos e pendências legíveis sem a conversa).
- [x] **C2** Todo requisito tem **valor concreto** (header, status, configuração) — nada de "deve ser seguro".
- [x] **C3** Cada requisito aponta a **tarefa implementadora** e o **custo** em horas.
- [x] **C4** **Compatível com ADR-0003** (mesmo origin, VPS, SQLite, reverse proxy com TLS) e com o já entregue pela T011.
- [x] **C5** **CSRF e CORS** tratados com análise do caso (mesmo origin + `SameSite=Lax`), não checklist genérica; CSRF defende a **ausência de token decorativo** com justificativa.
- [x] **C6** **Matriz req × risco** cobre sem duplicar (§4).
- [x] **C7** **"O já atendido"** listado com ponteiro de evidência (§2) — a aprovação não reabre o fechado.
- [x] **C8** **Custos/impacto de escopo** claros, sem nova tarefa (§5).
- [x] **C9** **Pendências humanas com IDs** (V4-PA-1..5) e bloco STATUS (§6), no padrão de `ESTILO.md` §8.2.
- [x] **C10** **"Não faz parte"** explícito (§8).
- [x] **C11** Achado imediato registrado com **evidência arquivo:linha** e fator atenuante conservador (§7).
- [x] **C12** Rastreabilidade: cada requisito cita a origem (ADR/RF/RK/CA/código).
- [x] **C13** Fora de escopo respeitado: **nenhum arquivo fora de `docs/requirements/v4-SEGURANCA-EXPOSICAO-PUBLICA.md`** criado ou alterado; nenhum comando git executado (commit é da coordenação).
