import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Bootstrap de metadados (não é regra de negócio): pares chave/valor usados
 * para identificar o schema aplicado. As tabelas de domínio (empresa, usuário,
 * lançamento...) vêm nas tarefas seguintes (TASK-011+), conforme ADR-0001.
 */
export const appMeta = sqliteTable('app_meta', {
  chave: text('chave').primaryKey(),
  valor: text('valor').notNull(),
});

export type AppMeta = typeof appMeta;
