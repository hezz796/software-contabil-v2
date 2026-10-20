import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

/**
 * Configuração do drizzle-kit (geração de migrações em `drizzle/`).
 * Os scripts npm rodam com cwd em `apps/api` (via workspace), por isso os
 * caminhos relativos abaixo são resolvidos a partir desse diretório.
 */
const databasePath = process.env['DATABASE_PATH'] ?? 'data/sistema-contabil.db';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: `file:${path.resolve(process.cwd(), databasePath)}`,
  },
});
