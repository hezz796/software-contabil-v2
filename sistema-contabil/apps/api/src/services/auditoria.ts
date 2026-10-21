import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { AuditEventDTO } from '@sistema-contabil/shared';
import type { AppDb } from '../db/index.ts';
import { auditEvent, type AuditEvent, type NovoAuditEvent } from '../db/schema.ts';

/**
 * Trilha de auditoria (RF-05, ADR-0001).
 *
 * Duas formas de gravar, ambas apontando para a MESMA transação da escrita:
 *
 * - `transacaoComAuditoria(db, (tx, auditoria) => {...})` — para toda escrita
 *   de negócio: o `tx` entregue ao callback é o da escrita e o evento registrado
 *   por `auditoria.registrar()` entra na mesma transação (R8: nada muda sem
 *   trilha; se a escrita falhar, o evento também é desfeito).
 * - `registrarEvento(db, evento)` — para eventos avulsos (recusas e eventos de
 *   acesso que não acompanham outra escrita); um único insert já é atômico.
 *
 * A imutabilidade da trilha é garantida por triggers no banco (migração
 * `audit_event_append_only`), não por este módulo — ver CA-38.
 */

/** Handle de transação do Drizzle: mesma conexão, escopo transacional. */
export type DbTransacao = Parameters<Parameters<AppDb['transaction']>[0]>[0];

export interface EventoAuditoria {
  /** Usuário responsável. `null` quando não há identificação (ex.: login com e-mail inexistente). */
  usuarioId?: number | null;
  /** Empresa afetada. `null` em eventos globais (ex.: login). */
  empresaId?: number | null;
  /** Ação no formato `substituicao.ato`, ex.: `login.sucesso`, `usuario.criacao`. */
  acao: string;
  objetoTipo?: string | null;
  objetoId?: string | null;
  /** JSON com o contexto (dados anteriores/novos, motivo da recusa). Nunca inclua senhas. */
  dados?: unknown;
  /** ISO-8601 UTC; padrão = agora. */
  criadoEm?: string;
}

export function valoresDoEvento(evento: EventoAuditoria): NovoAuditEvent {
  return {
    usuarioId: evento.usuarioId ?? null,
    empresaId: evento.empresaId ?? null,
    acao: evento.acao,
    objetoTipo: evento.objetoTipo ?? null,
    objetoId: evento.objetoId ?? null,
    dados: evento.dados ?? null,
    criadoEm: evento.criadoEm ?? new Date().toISOString(),
  };
}

/** Insere um evento em uma conexão ou transação (escrita síncrona do better-sqlite3). */
export function inserirEvento(db: AppDb | DbTransacao, evento: EventoAuditoria): void {
  db.insert(auditEvent)
    .values(valoresDoEvento(evento))
    .prepare()
    .run();
}

/** Contexto entregue à escrita: registra o evento já dentro da transação. */
export interface ContextoAuditoria {
  registrar(evento: EventoAuditoria): void;
}

/**
 * Executa uma escrita e grava os eventos de auditoria **na mesma transação**
 * (ADR-0001; R8). Em caso de erro na escrita, escrita e trilha são desfeitas.
 */
export function transacaoComAuditoria<T>(
  db: AppDb,
  escrita: (tx: DbTransacao, auditoria: ContextoAuditoria) => T,
): T {
  return db.transaction((tx) =>
    escrita(tx, { registrar: (evento: EventoAuditoria) => inserirEvento(tx, evento) }),
  );
}

/** Registra um evento avulso (sem escrita associada). */
export function registrarEvento(db: AppDb, evento: EventoAuditoria): void {
  inserirEvento(db, evento);
}

export interface FiltroTrilha {
  empresaId: number;
  /** ISO-8601 UTC (inclusivo). */
  de?: string | undefined;
  /** ISO-8601 UTC (inclusivo). */
  ate?: string | undefined;
}

/**
 * Consulta a trilha filtrando por empresa e período (CA-39): os filtros são
 * inclusivos e um período sem eventos devolve lista vazia (não é erro).
 * Ordena do mais recente para o mais antigo.
 */
export async function consultarTrilha(db: AppDb, filtro: FiltroTrilha): Promise<AuditEvent[]> {
  const condicoes = [eq(auditEvent.empresaId, filtro.empresaId)];
  if (filtro.de) condicoes.push(gte(auditEvent.criadoEm, filtro.de));
  if (filtro.ate) condicoes.push(lte(auditEvent.criadoEm, filtro.ate));

  return db
    .select()
    .from(auditEvent)
    .where(and(...condicoes))
    .orderBy(desc(auditEvent.criadoEm), desc(auditEvent.id));
}

/** Converte a linha (camelCase do Drizzle) para o DTO público (snake_case, Zod). */
export function paraEventoDTO(linha: AuditEvent): AuditEventDTO {
  return {
    id: linha.id,
    usuario_id: linha.usuarioId,
    empresa_id: linha.empresaId,
    acao: linha.acao,
    objeto_tipo: linha.objetoTipo,
    objeto_id: linha.objetoId,
    dados: linha.dados,
    criado_em: linha.criadoEm,
  };
}
