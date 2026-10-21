// Bootstrap da API: config → SQLite → migrações idempotentes → Fastify.
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/index.ts';
import { applyMigrations } from './db/migrations.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, sqlite } = createDb(config.databasePath);

  try {
    applyMigrations(db);
  } catch (error) {
    sqlite.close();
    throw error;
  }

  const app = await buildApp({ db, logger: { level: config.logLevel }, config });

  const encerrar = (sinal: string): void => {
    app.log.info({ sinal }, 'encerrando API');
    void app
      .close()
      .catch((erro: unknown) => app.log.error({ erro }, 'erro ao fechar a API'))
      .finally(() => {
        sqlite.close();
        process.exit(0);
      });
  };

  process.once('SIGINT', () => encerrar('SIGINT'));
  process.once('SIGTERM', () => encerrar('SIGTERM'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error('Falha ao iniciar a API:', error);
  process.exit(1);
});
