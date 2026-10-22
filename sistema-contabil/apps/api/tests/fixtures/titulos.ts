import type { AppDb } from '../../src/db/index.ts';
import {
  titulo,
  type SituacaoTitulo,
  type TipoTitulo,
  type Titulo,
} from '../../src/db/schema.ts';

/**
 * Fixture de título a pagar/receber (FIX-02) para os testes da TASK-016.
 *
 * Criada direto no banco temporário do teste, mesmo padrão de
 * `criarContaTeste`/`criarEmpresaTeste` — usada nos testes que precisam de um
 * título pré-existente em estado específico (inserts raw de FK, cenários de
 * recusa) sem depender da rota POST /titulos. Nos fluxos de CA o título é
 * criado pela API para exercitar o caminho de produção.
 */
export interface OpcoesTituloTeste {
  empresaId: number;
  /** Conta contábil do título (precisa pertencer à mesma empresa — FK composta). */
  contaId: number;
  /** Autor da criação (FK `titulo.criado_por -> usuario.id`). */
  criadoPor: number;
  tipo?: TipoTitulo;
  contraparte?: string;
  descricao?: string | null;
  vencimento?: string;
  valorCentavos?: number;
  situacao?: SituacaoTitulo;
  /** Padrão = `valorCentavos` (título nasce em aberto). */
  saldoCentavos?: number;
}

/** Cria um título direto no banco temporário do teste. */
export function criarTituloTeste(db: AppDb, opcoes: OpcoesTituloTeste): Titulo {
  const valorCentavos = opcoes.valorCentavos ?? 50_000;
  return db
    .insert(titulo)
    .values({
      empresaId: opcoes.empresaId,
      tipo: opcoes.tipo ?? 'pagar',
      contraparte: opcoes.contraparte ?? 'Fornecedor Teste',
      descricao: opcoes.descricao ?? null,
      vencimento: opcoes.vencimento ?? '2026-05-10',
      valorCentavos,
      contaId: opcoes.contaId,
      situacao: opcoes.situacao ?? 'aberto',
      saldoCentavos: opcoes.saldoCentavos ?? valorCentavos,
      criadoPor: opcoes.criadoPor,
    })
    .returning()
    .all()[0]!;
}
