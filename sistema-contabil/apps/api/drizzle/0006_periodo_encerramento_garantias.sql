-- Garantias de encerramento de período no BANCO (RF-09, CA-24/CA-31/CA-32, TASK-015).
--
-- 1) "Nada escreve em período encerrado" (CA-24/CE-3): qualquer INSERT em
--    `lancamento` cujo período já está encerrado é ABORTADO — inclusive por bug
--    de aplicação. Vale para lançamento comum E para estorno (ambos são INSERT).
--    O caminho legítimo de escrita dentro do período que está sendo fechado é a
--    PRÓPRIA ação de encerramento (operação atômica da TASK-015): ela grava os
--    lançamentos de encerramento enquanto `encerrado_em` ainda é NULL e só
--    então marca o período — este trigger deixa essa operação possível e
--    fecha todo o resto.
-- 2) Encerramento único e imutável (RF-09/CA-31/CA-32): uma vez preenchido,
--    `encerrado_em` não muda mais por nenhum caminho — re-encerrar, reabrir ou
--    alterar a marca é ABORTADO. Junto com a transação atômica do serviço,
--    elimina duplo encerramento mesmo em corrida ou com bug de aplicação.
CREATE TRIGGER `lancamento_no_periodo_encerrado`
BEFORE INSERT ON `lancamento`
WHEN (SELECT encerrado_em FROM `periodo_contabil` WHERE id = NEW.periodo_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'periodo encerrado: nada e escrito com data/periodo nele (RF-09/CA-24)');
END;
--> statement-breakpoint
CREATE TRIGGER `periodo_encerramento_unico`
BEFORE UPDATE ON `periodo_contabil`
WHEN OLD.encerrado_em IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'periodo ja encerrado: o encerramento e unico e a marca e imutavel (RF-09)');
END;
