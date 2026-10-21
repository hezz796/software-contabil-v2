CREATE TABLE `conta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`codigo` text NOT NULL,
	`descricao` text NOT NULL,
	`tipo` text NOT NULL,
	`conta_pai_id` integer,
	`ativa` integer DEFAULT true NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_pai_id`) REFERENCES `conta`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conta_empresa_codigo_uk` ON `conta` (`empresa_id`,`codigo`);--> statement-breakpoint
CREATE INDEX `conta_empresa_idx` ON `conta` (`empresa_id`);--> statement-breakpoint
CREATE INDEX `conta_pai_idx` ON `conta` (`conta_pai_id`);--> statement-breakpoint
CREATE TABLE `periodo_contabil` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`ano` integer NOT NULL,
	`mes` integer NOT NULL,
	`encerrado_em` text,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `periodo_empresa_ano_mes_uk` ON `periodo_contabil` (`empresa_id`,`ano`,`mes`);--> statement-breakpoint
CREATE INDEX `periodo_empresa_idx` ON `periodo_contabil` (`empresa_id`);