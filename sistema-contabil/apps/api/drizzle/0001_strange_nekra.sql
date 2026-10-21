CREATE TABLE `audit_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer,
	`empresa_id` integer,
	`acao` text NOT NULL,
	`objeto_tipo` text,
	`objeto_id` text,
	`dados` text,
	`criado_em` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_event_empresa_criado_idx` ON `audit_event` (`empresa_id`,`criado_em`);--> statement-breakpoint
CREATE INDEX `audit_event_usuario_criado_idx` ON `audit_event` (`usuario_id`,`criado_em`);--> statement-breakpoint
CREATE TABLE `sessao` (
	`id` text PRIMARY KEY NOT NULL,
	`usuario_id` integer NOT NULL,
	`criada_em` text NOT NULL,
	`expira_em` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessao_usuario_idx` ON `sessao` (`usuario_id`);--> statement-breakpoint
CREATE INDEX `sessao_expira_em_idx` ON `sessao` (`expira_em`);--> statement-breakpoint
CREATE TABLE `usuario` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`senha_hash` text NOT NULL,
	`papel` text NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`criado_em` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuario_email_uk` ON `usuario` (`email`);--> statement-breakpoint
CREATE TABLE `usuario_empresa` (
	`usuario_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	PRIMARY KEY(`usuario_id`, `empresa_id`),
	FOREIGN KEY (`usuario_id`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `usuario_empresa_empresa_idx` ON `usuario_empresa` (`empresa_id`);