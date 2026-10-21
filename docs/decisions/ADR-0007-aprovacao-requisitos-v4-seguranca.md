# ADR-0007: Aprovação dos requisitos v4 de segurança da exposição pública (V4-01..V4-10)

- **Status:** Aceito (aprovação humana em 2026-10-21)
- **Data:** 2026-10-21
- **Responsáveis:** Coordenador, com aprovação do usuário; proposta produzida pelo product-analyst
- **Relacionado:** `docs/requirements/v4-SEGURANCA-EXPOSICAO-PUBLICA.md` (fonte desta decisão e requisito aprovado); TASK-021 (implementa V4-02/03/04/05 e V4-PA-4), TASK-022 (V4-01/06/07/08/09/10 no runbook e checklist); TASK-011 (base já entregue); `docs/decisions/ADR-0003-implantacao-web-vps-sqlite.md` (desenho de exposição: VPS + reverse proxy + TLS); `docs/requirements/SISTEMA-CONTABIL.md` (RF-04/RF-05/RF-19, RK-6)

## Contexto

A TASK-021 registrava como escopo "consolidar as lacunas de segurança da exposição pública como proposta de requisitos v4 (para aprovação humana)" e a TASK-022 marcava "v4 de segurança aprovada" como item bloqueador do checklist de publicação. As lacunas listadas eram: CSRF, HTTPS, rate limit, headers e CORS.

Uma proposta foi produzida em 2026-10-21 com requisitos numerados (V4-01..V4-10), matriz req × risco, custo por requisito e a lista do que a T011 já atende. A leitura do código durante a produção da proposta identificou um achado real (A-1, abaixo).

## Decisões

### V4-PA-1 — Conjunto V4-01..V4-10 (aprovada pelo usuário)

**Decisão:** os 10 requisitos passam a ser requisito de exposição pública, complementando (sem alterar) `SISTEMA-CONTABIL.md`:

`V4-01` HTTPS + HSTS (TLS 1.2+, `max-age=31536000; includeSubDomains`, HTTP→301) · `V4-02` CORS de mesmo origin (zero `Access-Control-Allow-Origin` em produção) · `V4-03` CSRF sem token · `V4-04` rate limiting (login 10/min/IP, endpoints caros 30/min/usuário) · `V4-05` headers de navegador (nosniff, Referrer-Policy, Permissions-Policy, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `script-src 'self'`) · `V4-06` hardening do reverse proxy · `V4-07` gestão de segredos · `V4-08` logs/monitoramento mínimo · `V4-09` backup/restore (já núcleo da T022) · `V4-10` `npm audit` sem alta/crítica no checklist.

- **Custo: ~+8 h**, sem tarefa nova — pendurado em T021 (10 → ~16 h) e T022 (3 → ~5,5 h). Nenhum serviço pago.

### V4-PA-2 — Valores de rate limit (aprovada pelos valores propostos)

`V4-04` usa 10 tentativas/minuto por IP no login e 30 requisições/minuto por usuário em endpoints caros, com `trustProxy` obrigatório atrás do proxy. Conservador e coerente com H3 (baixa concorrência).

### V4-PA-3 — CSRF: recusar token e recusar hook de `Origin` (decidido pelo usuário)

**Decisão:** **sem token CSRF e sem hook de `Origin`.** Justificativa técnica, não preguiça: API e web são mesmo origin no deploy (ADR-0003), o cookie é `SameSite=Lax` e os bodies são JSON — o que obriga preflight em qualquer requisição cross-origin. Não há vetor explorável; instalar token seria proteção decorativa com custo de manutenção e de quebra silenciosa.

- Se o desenho de deploy mudar no futuro (web em domínio diferente da API), **esta decisão é reaberta** — o requisito V4-03 existe e aponta o que falta.

### V4-PA-4 — Guarda fail-fast do `SESSION_SECRET` (aprovada pelo usuário)

**Decisão:** a API recusa subir em produção quando `SESSION_SECRET` está ausente, é o default conhecido ou é curta. Fecha o achado **A-1**:

- **Evidência:** `apps/api/src/config.ts:18` — `SESSION_SECRET: z.string().min(16).default('segredo-de-desenvolvimento-trocar')`; sem env definida, o default é usado mesmo com `NODE_ENV=production`.
- **Fator atenuante reconhecido:** a sessão é fonte de verdade no banco (`services/sessao.ts` exige id válido em `sessão`, não expirado, usuário ativo), então o secret fraco não permite sequestrar sessão sozinho. O risco é de hardening.
- **Implementação:** T021, junto do restante de V4-07.

### V4-PA-5 — CSP `style-src` (deferida para a T021, conforme o próprio desenho da proposta)

**Decisão:** manter `style-src 'unsafe-inline'` por padrão e **restringir a `'self'` se o build real do Vite permitir**, decidido na T021 com medição em vez de suposição.

## Consequências

- **T022** tem o item "v4 de segurança aprovada" desbloqueado; restam do checklist: RK-6 e a contratação da VPS (decisão humana, ainda não assumida).
- **T021** ganha ~6 h líquidas e um escopo concreto de verificação: headers, rate limit, CORS negado, guarda de secret, e a reavaliação do CSP com o build na mão.
- **Nenhum requisito existente foi alterado**: a v4 complementa `SISTEMA-CONTABIL.md`; as decisões de sessão/papel/trilha da T011 permanecem como estão.
- A T012 em execução **não foi afetada**: a guarda de secret e o rate limiting são da T021, e o CSRF foi recusado — nada muda no que a T012 implementa.

## Validação

- Pendências de produto restantes: **RK-8** (validação fiscal com caso real do escritório — adiado por falta de dado, decisão do usuário em 2026-10-21) e a contratação da VPS.
- A v4 foi produzida lendo o código real da T011; o único achado fora do escopo (A-1) está coberto por V4-PA-4. Se a T021 encontrar lacuna nova, ela vira v5 ou extensão da v4 — nunca silêncio.

## Histórico

- 2026-10-21: proposta entregue (product-analyst, sessão `ses_ea1315796ffeysqIzTtuSxqoIp`) e aprovada pelo usuário na mesma data: PA-1 (conjunto inteiro), PA-3 (recusar CSRF) e PA-4 (guarda de secret) por resposta direta; PA-2 pelos valores propostos; PA-5 deferida à T021.
