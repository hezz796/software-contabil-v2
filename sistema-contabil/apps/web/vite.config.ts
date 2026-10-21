import react from '@vitejs/plugin-react';
import { defineConfig, type ProxyOptions } from 'vite';

/**
 * Dev server do web + proxy da API.
 *
 * Em produção API e web servem do mesmo origin (ADR-0003); em dev o Vite
 * ocupa o papel de origem única encaminhando as rotas da API para o Fastify —
 * assim o cookie HttpOnly de sessão funciona sem CORS e sem nenhum ajuste
 * manual (critério da T020: `npm run dev` consome a API local com o proxy
 * declarado aqui e documentado em `apps/web/README.md`).
 *
 * Ao adicionar um prefixo de rota novo na API (TASK-013+), acrescente-o em
 * `ROTAS_API` abaixo.
 */

/** Prefixos de rota da API repassados ao proxy de dev. */
const ROTAS_API = [
  '/health',
  '/login',
  '/logout',
  '/me',
  '/empresas',
  '/usuarios',
  '/auditoria',
  // Plano de contas e períodos (T013): a rota da API é `/contas`, não
  // `/plano-de-contas` — sem este prefixo o Vite respondia o HTML do SPA
  // (fallback) em vez do JSON da API, quebrando em silêncio.
  '/contas',
  '/periodos',
  '/lancamentos',
  '/titulos',
  '/conciliacao',
  '/relatorios',
  '/fiscal',
];

/** Host/porta da API (mesmos nomes de env do `apps/api`: `PORT`; `HOST` do
 *  Fastify é endereço de escuta e não precisa ser o alvo do proxy). */
const apiHost = process.env['API_HOST'] ?? '127.0.0.1';
const apiPorta = process.env['API_PORT'] ?? process.env['PORT'] ?? '3001';
/** `API_URL` (ex.: http://127.0.0.1:4000) sobrepõe host/porta. */
const alvoApi = process.env['API_URL'] ?? `http://${apiHost}:${apiPorta}`;

const portaWeb = process.env['WEB_PORT'] ? Number(process.env['WEB_PORT']) : 5173;

const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  ROTAS_API.map((rota) => [rota, { target: alvoApi }]),
);

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.isFinite(portaWeb) && portaWeb > 0 ? portaWeb : 5173,
    strictPort: false,
    proxy,
  },
});
