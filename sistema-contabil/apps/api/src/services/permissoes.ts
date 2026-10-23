import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/index.ts';
import { empresa } from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import type { Autenticacao } from './sessao.ts';
import { registrarEvento } from './auditoria.ts';

/**
 * Permissões de escopo de tenant (RF-04, R7, F13, CA-20/23/33/34/35/36/40).
 *
 * Duas autorizações distintas, ambas apontando para o escopo vindo do BANCO
 * (nunca do corpo/URL — o valor enviado é só solicitação):
 *
 * - `autorizarLeituraEmpresa`: contador lê apenas empresas atribuídas
 *   (negação auditada quando tenta alheia); administrador tem **leitura
 *   global auditada** (F13/CA-34): lê qualquer empresa e o acesso fica
 *   registrado na trilha como `escopo.leitura_global`.
 * - `autorizarEscritaContabil`: escrita contábil (lançamento, título, baixa,
 *   encerramento...) exige papel contador **atribuído** à empresa (F13/CA-33):
 *   admin é recusado auditado; contador não atribuído é recusado auditado
 *   (CA-35/36); empresa inativa bloqueia escrita nova (CA-40/CE-14).
 * - `autorizarConfiguracaoFiscal`: configuração fiscal (tabelas/alíquotas,
 *   multa/juros, regime — RF-20..23) é configuração administrativa auditada,
 *   NÃO escrita contábil (F13/RF-02/CA-54): admin e contador atribuído podem.
 *
 * Toda recusa gera evento `escopo.tentativa_negada` com usuário, empresa
 * solicitada, objeto e motivo (RF-05/CE-12/CE-15).
 */

export interface ContextoRecusa {
  /** Identificação do objeto tentado (ex.: `lancamento`, `titulo`, `empresa`). */
  objeto: string;
  /** Rota/metodo da tentativa, para a trilha. */
  rota?: string;
}

interface DadosRecusa extends ContextoRecusa {
  motivo: string;
}

function recusar(
  db: AppDb,
  autenticacao: Autenticacao,
  empresaIdSolicitada: number,
  dados: DadosRecusa,
  erro: ErroAplicacao,
): never {
  registrarEvento(db, {
    acao: 'escopo.tentativa_negada',
    usuarioId: autenticacao.usuario.id,
    empresaId: empresaIdSolicitada,
    objetoTipo: dados.objeto,
    dados: { motivo: dados.motivo, rota: dados.rota ?? null },
  });
  throw erro;
}

/**
 * Autoriza LEITURA de dados de uma empresa (CA-20/CA-34).
 *
 * - Contador: só empresas atribuídas; tentativa sobre empresa alheia vira
 *   403 com negação explícita (nunca 200 vazio nem dado de Y) + trilha.
 * - Administrador: leitura global auditada — evento `escopo.leitura_global`
 *   identificando admin, empresa lida e horário (CA-34/F13).
 */
export async function autorizarLeituraEmpresa(
  db: AppDb,
  autenticacao: Autenticacao,
  empresaIdSolicitada: number,
  contexto: ContextoRecusa,
): Promise<void> {
  const existe = await db
    .select({ id: empresa.id })
    .from(empresa)
    .where(eq(empresa.id, empresaIdSolicitada));

  if (autenticacao.usuario.papel === 'administrador') {
    if (existe.length === 0) {
      // Genérica (403, não 404) para não usar a rota como oráculo de
      // existência; mantém o comportamento coberto pelo CA-39 da T011.
      recusar(
        db,
        autenticacao,
        empresaIdSolicitada,
        { ...contexto, motivo: 'empresa_inexistente' },
        new ErroAplicacao(403, 'Acesso negado: empresa não encontrada.', 'empresa_nao_encontrada'),
      );
    }
    // Leitura global do admin é permitida (F13/CA-34), mas a leitura FORA das
    // próprias atribuições SEMPRE gera `escopo.leitura_global` na trilha
    // (admin, empresa lida, horário). Leitura dentro das atribuições é a
    // rotina de gestão e não gera evento extra (CA-39 permanece estável).
    if (!autenticacao.empresaIds.includes(empresaIdSolicitada)) {
      registrarEvento(db, {
        acao: 'escopo.leitura_global',
        usuarioId: autenticacao.usuario.id,
        empresaId: empresaIdSolicitada,
        objetoTipo: contexto.objeto,
        dados: { rota: contexto.rota ?? null },
      });
    }
    return;
  }

  if (!autenticacao.empresaIds.includes(empresaIdSolicitada) || existe.length === 0) {
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'empresa_nao_atribuida' },
      new ErroAplicacao(403, 'Acesso negado: usuário sem acesso a esta empresa.'),
    );
  }
}

/**
 * Autoriza CONFIGURAÇÃO fiscal de uma empresa (RF-02/RF-20, CA-54) e devolve
 * o `empresa_id` resolvido no servidor.
 *
 * A configuração fiscal (tabelas/alíquotas, multa/juros, regime — RF-20..23)
 * é **configuração administrativa do escritório, não escrita contábil**
 * (F13/RF-02): pode ser feita por administrador e por contador **atribuído**
 * à empresa; toda alteração é auditada pelo próprio serviço (CA-54).
 *
 * Recusas (auditadas como tentativa):
 * - contador não atribuído à empresa (CA-54a: requisição direta com empresa
 *   alheia) — 403;
 * - empresa inexistente — 404 auditado (contador recusado antes pela
 *   atribuição, sem oráculo; admin, que tem leitura global, também passa por
 *   `recusar` — a sondagem de `empresa_id` fica na trilha RF-05/CE-15).
 *
 * Empresa inativa NÃO bloqueia a configuração: ela não entra no razão nem no
 * financeiro (aqui é só cadastro de regras) — decisão técnica T017, registrada
 * no retorno; escrita contábil nova continua bloqueada pela CA-40.
 */
export async function autorizarConfiguracaoFiscal(
  db: AppDb,
  autenticacao: Autenticacao,
  empresaIdSolicitada: number,
  contexto: ContextoRecusa,
): Promise<number> {
  if (autenticacao.usuario.papel === 'contador') {
    // Atribuição ANTES de existência: recusa sempre 403 genérica para não
    // usar a rota de configuração como oráculo de existência de empresa
    // (mesma lógica de `autorizarEscritaContabil`).
    if (!autenticacao.empresaIds.includes(empresaIdSolicitada)) {
      recusar(
        db,
        autenticacao,
        empresaIdSolicitada,
        { ...contexto, motivo: 'empresa_nao_atribuida' },
        new ErroAplicacao(403, 'Acesso negado: usuário sem acesso a esta empresa.'),
      );
    }
  }

  const existe = await db
    .select({ id: empresa.id })
    .from(empresa)
    .where(eq(empresa.id, empresaIdSolicitada));

  if (existe.length === 0) {
    if (autenticacao.usuario.papel === 'administrador') {
      // Recusa AUDITADA como em todas as rotas (RF-05/CE-15): admin tem
      // leitura global, mas a sondagem de empresa_id fica na trilha. O
      // contador nunca chega aqui com empresa inexistente — a checagem de
      // atribuição acima devolve 403 genérica antes (sem oráculo).
      recusar(
        db,
        autenticacao,
        empresaIdSolicitada,
        { ...contexto, motivo: 'empresa_inexistente' },
        new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada'),
      );
    }
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'empresa_inexistente' },
      new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada'),
    );
  }

  return empresaIdSolicitada;
}

/**
 * Autoriza ESCRITA contábil em uma empresa (CA-33/CA-35/CA-36/CA-40) e
 * devolve o `empresa_id` resolvido no servidor (nunca o enviado como confiável).
 *
 * Recusas (todas auditadas como tentativa):
 * - administrador: sem escrita contábil (F13/CA-33) — 403;
 * - contador não atribuído: tentativa cruzada de tenant (CA-35/36) — 403;
 * - empresa inativa: bloqueio de escrita nova (CA-40/CE-14) — 403;
 * - empresa inexistente — 404.
 */
export async function autorizarEscritaContabil(
  db: AppDb,
  autenticacao: Autenticacao,
  empresaIdSolicitada: number,
  contexto: ContextoRecusa,
): Promise<number> {
  if (autenticacao.usuario.papel === 'administrador') {
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'administrador_sem_escrita_contabil' },
      new ErroAplicacao(
        403,
        'Permissão negada: administrador não possui escrita contábil.',
        'administrador_sem_escrita_contabil',
      ),
    );
  }

  // Atribuição ANTES de existência: a recusa é sempre a mesma (403 genérica)
  // para não usar a rota de escrita como oráculo de existência de empresa.
  if (!autenticacao.empresaIds.includes(empresaIdSolicitada)) {
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'empresa_nao_atribuida' },
      new ErroAplicacao(403, 'Acesso negado: usuário sem acesso a esta empresa.'),
    );
  }

  const existe = await db
    .select({ id: empresa.id, ativo: empresa.ativo })
    .from(empresa)
    .where(eq(empresa.id, empresaIdSolicitada));

  if (existe.length === 0) {
    // Só alcançável se a empresa foi removida por fora (sem FK em produção a
    // remoção dura não existe — H13); recusa sem escrita.
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'empresa_inexistente' },
      new ErroAplicacao(404, 'Empresa não encontrada.', 'empresa_nao_encontrada'),
    );
  }

  if (!existe[0]!.ativo) {
    recusar(
      db,
      autenticacao,
      empresaIdSolicitada,
      { ...contexto, motivo: 'empresa_inativa' },
      new ErroAplicacao(
        403,
        'Operação recusada: a empresa está inativa e não aceita novos lançamentos ou títulos.',
        'empresa_inativa',
      ),
    );
  }

  return empresaIdSolicitada;
}
