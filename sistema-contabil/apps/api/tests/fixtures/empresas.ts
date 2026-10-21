import { eq } from 'drizzle-orm';
import { montarCnpj } from '@sistema-contabil/shared';
import type { AppDb } from '../../src/db/index.ts';
import { empresa, type Empresa } from '../../src/db/schema.ts';

/**
 * Fixtures de empresa para os testes (TASK-012).
 *
 * Os CNPJs são sintéticos mas **válidos** (`montarCnpj` calcula os dígitos
 * verificadores), um por id, para não conflitar com o índice único em testes
 * que criam várias empresas.
 */

export interface OpcoesEmpresaTeste {
  /** Id explícito (as fixtures de usuário usam ids pequenos fixos). */
  id?: number;
  razaoSocial?: string;
  /** Se omitido, derivado do id (`montarCnpj`). */
  cnpj?: string;
  ativo?: boolean;
}

/** CNPJ sintético válido derivado do id da empresa. */
export function cnpjDeTeste(id: number): string {
  return montarCnpj(String(id).padStart(10, '0') + '01');
}

/** Cria uma empresa direto no banco temporário do teste. */
export function criarEmpresaTeste(db: AppDb, opcoes: OpcoesEmpresaTeste = {}): Empresa {
  return db
    .insert(empresa)
    .values({
      ...(opcoes.id !== undefined ? { id: opcoes.id } : {}),
      razaoSocial: opcoes.razaoSocial ?? `Empresa Teste ${opcoes.id ?? 'novo'}`,
      cnpj: opcoes.cnpj ?? cnpjDeTeste(opcoes.id ?? Math.floor(Math.random() * 1_000_000)),
      ativo: opcoes.ativo ?? true,
    })
    .returning()
    .all()[0]!;
}

/** Garante que a empresa exista (fixtures de usuário com ids fixos). */
export function garantirEmpresaTeste(db: AppDb, id: number): Empresa {
  const existente = db.select().from(empresa).where(eq(empresa.id, id)).all()[0];
  if (existente) return existente;
  return criarEmpresaTeste(db, { id });
}

/** Linha de empresa por id (asserts de estado). */
export function empresaPorId(db: AppDb, id: number): Empresa | undefined {
  return db.select().from(empresa).where(eq(empresa.id, id)).all()[0];
}
