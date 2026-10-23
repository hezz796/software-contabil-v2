CREATE TABLE `apuracao_das` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`regime_id` integer NOT NULL,
	`periodo_id` integer NOT NULL,
	`lancamento_id` integer NOT NULL,
	`base_centavos` integer NOT NULL,
	`aliquota_centavos` integer NOT NULL,
	`das_centavos` integer NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`regime_id`,`empresa_id`) REFERENCES `regime_fiscal`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`periodo_id`,`empresa_id`) REFERENCES `periodo_contabil`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "apuracao_das_base_nao_negativa" CHECK("apuracao_das"."base_centavos" >= 0),
	CONSTRAINT "apuracao_das_aliquota_nao_negativa" CHECK("apuracao_das"."aliquota_centavos" >= 0),
	CONSTRAINT "apuracao_das_valor_nao_negativo" CHECK("apuracao_das"."das_centavos" >= 0),
	CONSTRAINT "apuracao_das_valor_derivado" CHECK("apuracao_das"."das_centavos" = ("apuracao_das"."base_centavos" * "apuracao_das"."aliquota_centavos" + 5000) / 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apuracao_das_periodo_uk` ON `apuracao_das` (`periodo_id`);--> statement-breakpoint
CREATE INDEX `apuracao_das_empresa_idx` ON `apuracao_das` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `config_multa_juros` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`titulo_id` integer,
	`multa_centavos` integer DEFAULT 0 NOT NULL,
	`juros_mensal_centavos` integer DEFAULT 0 NOT NULL,
	`conta_encargos_id` integer,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titulo_id`,`empresa_id`) REFERENCES `titulo`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_encargos_id`,`empresa_id`) REFERENCES `conta`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "config_multa_juros_multa_nao_negativa" CHECK("config_multa_juros"."multa_centavos" >= 0),
	CONSTRAINT "config_multa_juros_juros_nao_negativo" CHECK("config_multa_juros"."juros_mensal_centavos" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_multa_juros_titulo_uk` ON `config_multa_juros` (`titulo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `config_multa_juros_empresa_default_uk` ON `config_multa_juros` (`empresa_id`) WHERE "config_multa_juros"."titulo_id" IS NULL;--> statement-breakpoint
CREATE INDEX `config_multa_juros_empresa_idx` ON `config_multa_juros` (`empresa_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `config_multa_juros_id_empresa_uk` ON `config_multa_juros` (`id`,`empresa_id`);--> statement-breakpoint
CREATE TABLE `regime_fiscal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`regime` text DEFAULT 'simples_nacional' NOT NULL,
	`aliquota_centavos` integer NOT NULL,
	`conta_despesa_id` integer NOT NULL,
	`conta_passivo_id` integer NOT NULL,
	`ativa` integer DEFAULT true NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_despesa_id`,`empresa_id`) REFERENCES `conta`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_passivo_id`,`empresa_id`) REFERENCES `conta`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "regime_fiscal_aliquota_nao_negativa" CHECK("regime_fiscal"."aliquota_centavos" >= 0),
	CONSTRAINT "regime_fiscal_regime_valido" CHECK("regime_fiscal"."regime" IN ('simples_nacional'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regime_fiscal_empresa_uk` ON `regime_fiscal` (`empresa_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `regime_fiscal_id_empresa_uk` ON `regime_fiscal` (`id`,`empresa_id`);--> statement-breakpoint
CREATE TABLE `tabela_imposto` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`nome` text NOT NULL,
	`aliquota_centavos` integer NOT NULL,
	`conta_retencao_id` integer,
	`ativa` integer DEFAULT true NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_retencao_id`,`empresa_id`) REFERENCES `conta`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tabela_imposto_aliquota_nao_negativa" CHECK("tabela_imposto"."aliquota_centavos" >= 0),
	CONSTRAINT "tabela_imposto_nome_nao_vazio" CHECK(length(trim("tabela_imposto"."nome")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tabela_imposto_id_empresa_uk` ON `tabela_imposto` (`id`,`empresa_id`);--> statement-breakpoint
CREATE INDEX `tabela_imposto_empresa_idx` ON `tabela_imposto` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `titulo_tabela_imposto` (
	`titulo_id` integer NOT NULL,
	`tabela_imposto_id` integer NOT NULL,
	`empresa_id` integer NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	PRIMARY KEY(`titulo_id`, `tabela_imposto_id`),
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titulo_id`,`empresa_id`) REFERENCES `titulo`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tabela_imposto_id`,`empresa_id`) REFERENCES `tabela_imposto`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `titulo_tabela_imposto_tabela_idx` ON `titulo_tabela_imposto` (`tabela_imposto_id`);--> statement-breakpoint
CREATE INDEX `titulo_tabela_imposto_empresa_idx` ON `titulo_tabela_imposto` (`empresa_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_baixa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`titulo_id` integer NOT NULL,
	`lancamento_id` integer NOT NULL,
	`estorno_lancamento_id` integer,
	`data` text NOT NULL,
	`valor_centavos` integer NOT NULL,
	`retencao_centavos` integer DEFAULT 0 NOT NULL,
	`encargos_centavos` integer DEFAULT 0 NOT NULL,
	`multa_centavos` integer DEFAULT 0 NOT NULL,
	`juros_centavos` integer DEFAULT 0 NOT NULL,
	`retencao_lancamento_id` integer,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titulo_id`,`empresa_id`) REFERENCES `titulo`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estorno_lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retencao_lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "baixa_valor_positivo" CHECK("__new_baixa"."valor_centavos" > 0),
	CONSTRAINT "baixa_retencao_nao_negativa" CHECK("__new_baixa"."retencao_centavos" >= 0),
	CONSTRAINT "baixa_encargos_nao_negativos" CHECK("__new_baixa"."encargos_centavos" >= 0),
	CONSTRAINT "baixa_multa_nao_negativa" CHECK("__new_baixa"."multa_centavos" >= 0),
	CONSTRAINT "baixa_juros_nao_negativo" CHECK("__new_baixa"."juros_centavos" >= 0),
	CONSTRAINT "baixa_encargos_soma_multa_juros" CHECK("__new_baixa"."encargos_centavos" = "__new_baixa"."multa_centavos" + "__new_baixa"."juros_centavos"),
	CONSTRAINT "baixa_retencao_nao_maior_que_bruto" CHECK("__new_baixa"."retencao_centavos" <= "__new_baixa"."valor_centavos")
);
--> statement-breakpoint
INSERT INTO `__new_baixa`("id", "empresa_id", "titulo_id", "lancamento_id", "estorno_lancamento_id", "data", "valor_centavos", "retencao_centavos", "encargos_centavos", "criado_por", "criado_em") SELECT "id", "empresa_id", "titulo_id", "lancamento_id", "estorno_lancamento_id", "data", "valor_centavos", "retencao_centavos", "encargos_centavos", "criado_por", "criado_em" FROM `baixa`;--> statement-breakpoint
DROP TABLE `baixa`;--> statement-breakpoint
ALTER TABLE `__new_baixa` RENAME TO `baixa`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `baixa_estorno_lancamento_uk` ON `baixa` (`estorno_lancamento_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `baixa_retencao_lancamento_uk` ON `baixa` (`retencao_lancamento_id`);--> statement-breakpoint
CREATE INDEX `baixa_titulo_idx` ON `baixa` (`titulo_id`);--> statement-breakpoint
CREATE INDEX `baixa_empresa_idx` ON `baixa` (`empresa_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `periodo_id_empresa_uk` ON `periodo_contabil` (`id`,`empresa_id`);