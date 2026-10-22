CREATE TABLE `baixa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`titulo_id` integer NOT NULL,
	`lancamento_id` integer NOT NULL,
	`estorno_lancamento_id` integer,
	`data` text NOT NULL,
	`valor_centavos` integer NOT NULL,
	`retencao_centavos` integer DEFAULT 0 NOT NULL,
	`encargos_centavos` integer DEFAULT 0 NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`titulo_id`,`empresa_id`) REFERENCES `titulo`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estorno_lancamento_id`,`empresa_id`) REFERENCES `lancamento`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "baixa_valor_positivo" CHECK("baixa"."valor_centavos" > 0),
	CONSTRAINT "baixa_retencao_nao_negativa" CHECK("baixa"."retencao_centavos" >= 0),
	CONSTRAINT "baixa_encargos_nao_negativos" CHECK("baixa"."encargos_centavos" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `baixa_estorno_lancamento_uk` ON `baixa` (`estorno_lancamento_id`);--> statement-breakpoint
CREATE INDEX `baixa_titulo_idx` ON `baixa` (`titulo_id`);--> statement-breakpoint
CREATE INDEX `baixa_empresa_idx` ON `baixa` (`empresa_id`);--> statement-breakpoint
CREATE TABLE `titulo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`contraparte` text NOT NULL,
	`descricao` text,
	`vencimento` text NOT NULL,
	`valor_centavos` integer NOT NULL,
	`conta_id` integer NOT NULL,
	`situacao` text DEFAULT 'aberto' NOT NULL,
	`saldo_centavos` integer NOT NULL,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	`atualizado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_id`,`empresa_id`) REFERENCES `conta`(`id`,`empresa_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "titulo_valor_positivo" CHECK("titulo"."valor_centavos" > 0),
	CONSTRAINT "titulo_saldo_na_faixa" CHECK("titulo"."saldo_centavos" >= 0 AND "titulo"."saldo_centavos" <= "titulo"."valor_centavos"),
	CONSTRAINT "titulo_situacao_valida" CHECK("titulo"."situacao" IN ('aberto', 'parcial', 'pago', 'cancelado')),
	CONSTRAINT "titulo_tipo_valido" CHECK("titulo"."tipo" IN ('pagar', 'receber'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `titulo_id_empresa_uk` ON `titulo` (`id`,`empresa_id`);--> statement-breakpoint
CREATE INDEX `titulo_empresa_idx` ON `titulo` (`empresa_id`);--> statement-breakpoint
CREATE INDEX `titulo_empresa_situacao_idx` ON `titulo` (`empresa_id`,`situacao`);--> statement-breakpoint
CREATE UNIQUE INDEX `conta_id_empresa_uk` ON `conta` (`id`,`empresa_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lancamento_id_empresa_uk` ON `lancamento` (`id`,`empresa_id`);