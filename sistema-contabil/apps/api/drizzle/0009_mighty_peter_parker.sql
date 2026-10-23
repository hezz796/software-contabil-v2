CREATE TABLE `conciliacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`item_extrato_id` integer NOT NULL,
	`objeto_tipo` text NOT NULL,
	`titulo_id` integer,
	`lancamento_id` integer,
	`conciliado_por` integer NOT NULL,
	`conciliado_em` text NOT NULL,
	`desconciliado_por` integer,
	`desconciliado_em` text,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conciliado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`desconciliado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_extrato_id`,`empresa_id`) REFERENCES `item_extrato`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titulo_id`,`empresa_id`) REFERENCES `titulo`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conciliacao_objeto_coerente" CHECK(("conciliacao"."objeto_tipo" = 'titulo' AND "conciliacao"."titulo_id" IS NOT NULL AND "conciliacao"."lancamento_id" IS NULL) OR ("conciliacao"."objeto_tipo" = 'lancamento' AND "conciliacao"."lancamento_id" IS NOT NULL AND "conciliacao"."titulo_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conciliacao_item_uk` ON `conciliacao` (`item_extrato_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conciliacao_titulo_uk` ON `conciliacao` (`titulo_id`) WHERE "conciliacao"."desconciliado_em" IS NULL AND "conciliacao"."titulo_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `conciliacao_lancamento_uk` ON `conciliacao` (`lancamento_id`) WHERE "conciliacao"."desconciliado_em" IS NULL AND "conciliacao"."lancamento_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `conciliacao_empresa_idx` ON `conciliacao` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `conta_bancaria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`saldo_inicial_centavos` integer DEFAULT 0 NOT NULL,
	`data_saldo_inicial` text NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conta_bancaria_empresa_nome_uk` ON `conta_bancaria` (`empresa_id`,`nome`);--> statement-breakpoint
CREATE UNIQUE INDEX `conta_bancaria_id_empresa_uk` ON `conta_bancaria` (`id`,`empresa_id`);--> statement-breakpoint
CREATE INDEX `conta_bancaria_empresa_idx` ON `conta_bancaria` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `importacao_extrato` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conta_bancaria_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome_arquivo` text,
	`arquivo_hash` text NOT NULL,
	`quantidade_itens` integer NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_bancaria_id`,`empresa_id`) REFERENCES `conta_bancaria`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "importacao_quantidade_nao_negativa" CHECK("importacao_extrato"."quantidade_itens" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `importacao_conta_hash_uk` ON `importacao_extrato` (`conta_bancaria_id`,`arquivo_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `importacao_extrato_id_empresa_uk` ON `importacao_extrato` (`id`,`empresa_id`);--> statement-breakpoint
CREATE INDEX `importacao_extrato_conta_idx` ON `importacao_extrato` (`conta_bancaria_id`);--> statement-breakpoint
CREATE TABLE `item_extrato` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conta_bancaria_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`data` text NOT NULL,
	`descricao` text NOT NULL,
	`valor_centavos` integer NOT NULL,
	`origem` text NOT NULL,
	`importacao_id` integer,
	`identificador` text,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_bancaria_id`,`empresa_id`) REFERENCES `conta_bancaria`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`importacao_id`,`empresa_id`) REFERENCES `importacao_extrato`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "item_extrato_origem_coerente" CHECK(("item_extrato"."origem" = 'manual' AND "item_extrato"."importacao_id" IS NULL) OR ("item_extrato"."origem" = 'importacao' AND "item_extrato"."importacao_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_extrato_id_empresa_uk` ON `item_extrato` (`id`,`empresa_id`);--> statement-breakpoint
CREATE INDEX `item_extrato_conta_idx` ON `item_extrato` (`conta_bancaria_id`);--> statement-breakpoint
CREATE INDEX `item_extrato_empresa_idx` ON `item_extrato` (`empresa_id`);