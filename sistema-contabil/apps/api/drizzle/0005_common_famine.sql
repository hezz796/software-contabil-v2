CREATE TABLE `lancamento` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`empresa_id` integer NOT NULL,
	`periodo_id` integer NOT NULL,
	`data` text NOT NULL,
	`historico` text NOT NULL,
	`estorno_de_id` integer,
	`criado_por` integer NOT NULL,
	`criado_em` text NOT NULL,
	FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`periodo_id`) REFERENCES `periodo_contabil`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`estorno_de_id`) REFERENCES `lancamento`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuario`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lancamento_estorno_de_uk` ON `lancamento` (`estorno_de_id`);--> statement-breakpoint
CREATE INDEX `lancamento_empresa_data_idx` ON `lancamento` (`empresa_id`,`data`);--> statement-breakpoint
CREATE INDEX `lancamento_periodo_idx` ON `lancamento` (`periodo_id`);--> statement-breakpoint
CREATE TABLE `partida` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lancamento_id` integer NOT NULL,
	`conta_id` integer NOT NULL,
	`natureza` text NOT NULL,
	`valor_centavos` integer NOT NULL,
	FOREIGN KEY (`lancamento_id`) REFERENCES `lancamento`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conta_id`) REFERENCES `conta`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "partida_valor_positivo" CHECK("partida"."valor_centavos" > 0),
	CONSTRAINT "partida_natureza_valida" CHECK("partida"."natureza" IN ('D', 'C'))
);
--> statement-breakpoint
CREATE INDEX `partida_lancamento_idx` ON `partida` (`lancamento_id`);--> statement-breakpoint
CREATE INDEX `partida_conta_idx` ON `partida` (`conta_id`);--> statement-breakpoint
-- Triggers de imutabilidade de lançamento e partidas (RF-08, R9, CA-25).
-- Garantem no BANCO que lançamento gravado não é editado nem excluído
-- (inclusive por bug de aplicação): qualquer UPDATE/DELETE aborta a
-- transação. O caminho de correção é o ESTORNO (RF-08/RK-4) — um novo
-- lançamento inverso vinculado; os inserts continuam permitidos.
CREATE TRIGGER `lancamento_no_update`
BEFORE UPDATE ON `lancamento`
BEGIN
  SELECT RAISE(ABORT, 'lancamento e imutavel: atualizacao nao e permitida; o caminho de correcao e o estorno (RF-08)');
END;
--> statement-breakpoint
CREATE TRIGGER `lancamento_no_delete`
BEFORE DELETE ON `lancamento`
BEGIN
  SELECT RAISE(ABORT, 'lancamento e imutavel: exclusao nao e permitida; o caminho de correcao e o estorno (RF-08)');
END;
--> statement-breakpoint
CREATE TRIGGER `partida_no_update`
BEFORE UPDATE ON `partida`
BEGIN
  SELECT RAISE(ABORT, 'partida e imutavel: atualizacao nao e permitida; o caminho de correcao e o estorno (RF-08)');
END;
--> statement-breakpoint
CREATE TRIGGER `partida_no_delete`
BEFORE DELETE ON `partida`
BEGIN
  SELECT RAISE(ABORT, 'partida e imutavel: exclusao nao e permitida; o caminho de correcao e o estorno (RF-08)');
END;