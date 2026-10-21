CREATE TABLE `empresa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`razao_social` text NOT NULL,
	`cnpj` text NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `empresa_cnpj_uk` ON `empresa` (`cnpj`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_usuario_empresa` (
	`usuario_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	PRIMARY KEY(`usuario_id`, `empresa_id`),
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_usuario_empresa`("usuario_id", "empresa_id") SELECT "usuario_id", "empresa_id" FROM `usuario_empresa`;--> statement-breakpoint
DROP TABLE `usuario_empresa`;--> statement-breakpoint
ALTER TABLE `__new_usuario_empresa` RENAME TO `usuario_empresa`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `usuario_empresa_empresa_idx` ON `usuario_empresa` (`empresa_id`);