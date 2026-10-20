import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server do web. Sem proxy para a API nesta etapa: a integração UI→API
 * (proxy/CORS) será documentada em sistema-contabil/README.md quando as
 * chamadas de domínio forem implementadas (TASK-011+).
 */
const porta = process.env['WEB_PORT'] ? Number(process.env['WEB_PORT']) : 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number.isFinite(porta) && porta > 0 ? porta : 5173,
    strictPort: false,
  },
});
