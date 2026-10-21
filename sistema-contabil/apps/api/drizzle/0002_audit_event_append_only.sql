-- Triggers de imutabilidade da trilha de auditoria (RF-05, R11, ADR-0001).
-- Garantem no BANCO que `audit_event` é append-only: qualquer UPDATE/DELETE
-- (inclusive por bug de aplicação) aborta a transação (CA-38).
-- Os inserts continuam permitidos — a trilha só cresce.
CREATE TRIGGER `audit_event_no_update`
BEFORE UPDATE ON `audit_event`
BEGIN
  SELECT RAISE(ABORT, 'audit_event e append-only: atualizacao de evento de auditoria nao e permitida');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_event_no_delete`
BEFORE DELETE ON `audit_event`
BEGIN
  SELECT RAISE(ABORT, 'audit_event e append-only: remocao de evento de auditoria nao e permitida');
END;
