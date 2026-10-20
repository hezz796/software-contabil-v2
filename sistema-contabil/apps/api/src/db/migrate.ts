// Executa: `npm run migrate` (raiz ou em apps/api).
// Usa DATABASE_PATH/LOG_LEVEL/etc. de `loadConfig`; idempotente em banco limpo.
import { loadConfig } from '../config.ts';
import { createDb } from './index.ts';
import { applyMigrations } from './migrations.ts';

const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);

try {
  applyMigrations(db);
  console.log(`Migrações aplicadas (idempotente) em: ${config.databasePath}`);
} finally {
  sqlite.close();
}
