/**
 * Catálogo das telas do MVP — estrutura aprovada nos wireframes
 * (`docs/design/wireframes/*.html`, índice em `index.html`).
 *
 * Neste incremento (fundação da T020) todas as telas de negócio são
 * **placeholders**: aqui ficam rótulo, grupo de menu, visibilidade por papel
 * e referências (RF/CA) para o conteúdo entrar nos próximos incrementos.
 *
 * Visibilidade por papel (matriz §5 das diretrizes de UI/UX):
 * - `ambos` — administrador e contador;
 * - `solo-admin` — oculta do contador (CA-21);
 * - `admin-leitura` — ambos veem; o administrador vê somente leitura, sem
 *   escrita contábil (F13/CA-33).
 */
export type Visibilidade = 'ambos' | 'solo-admin' | 'admin-leitura';

export interface Tela {
  /** Rota hash, ex.: `/lancamentos`. */
  rota: string;
  rotulo: string;
  grupo: GrupoTela;
  visibilidade: Visibilidade;
  /** Subtítulo do cabeçalho (contexto de produto). */
  descricao: string;
  /** Chips de referência (RF-xx / CA-xx) exibidos no cabeçalho. */
  referencias: string[];
}

export type GrupoTela = 'escritorio' | 'contabilidade' | 'financeiro' | 'saidas' | 'controle';

export const ORDEM_GRUPOS: GrupoTela[] = [
  'escritorio',
  'contabilidade',
  'financeiro',
  'saidas',
  'controle',
];

export const TELAS: Tela[] = [
  {
    rota: '/empresas',
    rotulo: 'Empresas',
    grupo: 'escritorio',
    visibilidade: 'ambos',
    descricao:
      'Fluxo 1 (abertura de cliente). Contador lista as empresas atribuídas; administrador vê todas e faz a gestão (leitura global auditada).',
    referencias: ['RF-01', 'RF-04', 'CA-01', 'CA-40'],
  },
  {
    rota: '/usuarios',
    rotulo: 'Usuários e atribuições',
    grupo: 'escritorio',
    visibilidade: 'solo-admin',
    descricao:
      'Gestão de usuários, papéis e atribuição de empresas — exclusiva do administrador (RF-02, RF-03).',
    referencias: ['RF-02', 'RF-03', 'CA-02', 'CA-21'],
  },
  {
    rota: '/plano-de-contas',
    rotulo: 'Plano de contas',
    grupo: 'contabilidade',
    visibilidade: 'admin-leitura',
    descricao:
      'Hierarquia de contas (RF-06). Escrita exclusiva do contador; administrador consulta (F13/CA-33).',
    referencias: ['RF-06', 'CA-17', 'CE-13'],
  },
  {
    rota: '/periodos',
    rotulo: 'Períodos contábeis',
    grupo: 'contabilidade',
    visibilidade: 'admin-leitura',
    descricao:
      'Abertura e encerramento de períodos (RF-09); período encerrado recusa escrita (CE-03/CE-22).',
    referencias: ['RF-09', 'CA-31', 'CA-32'],
  },
  {
    rota: '/lancamentos',
    rotulo: 'Lançamentos',
    grupo: 'contabilidade',
    visibilidade: 'admin-leitura',
    descricao:
      'Lançamentos partidas e estorno (RF-07/RF-08), com equilíbrio débito/crédito visível (CE-01).',
    referencias: ['RF-07', 'RF-08', 'CA-03', 'CA-10'],
  },
  {
    rota: '/titulos',
    rotulo: 'Títulos',
    grupo: 'financeiro',
    visibilidade: 'admin-leitura',
    descricao:
      'Contas a pagar e receber com baixa e estorno (RF-13..RF-15, RF-22..RF-24).',
    referencias: ['RF-13', 'CA-06', 'CA-07'],
  },
  {
    rota: '/conciliacao',
    rotulo: 'Conciliação',
    grupo: 'financeiro',
    visibilidade: 'admin-leitura',
    descricao:
      'Conciliação bancária em duas colunas com progresso salvo (RF-16, CE-08/CE-09).',
    referencias: ['RF-16', 'CA-08', 'CA-44'],
  },
  {
    rota: '/relatorios',
    rotulo: 'Relatórios',
    grupo: 'saidas',
    visibilidade: 'ambos',
    descricao:
      'Balancete, razão, balanço e fluxo de caixa com exportação (RF-10..RF-12, RF-17, RF-18).',
    referencias: ['RF-10', 'CA-04', 'CA-05', 'CA-09'],
  },
  {
    rota: '/fiscal',
    rotulo: 'Fiscal',
    grupo: 'saidas',
    visibilidade: 'ambos',
    descricao:
      'Tabelas de alíquota, regime e DAS (RF-20..RF-23); configuração sujeita a autorização (CE-21).',
    referencias: ['RF-20', 'CA-45', 'CE-19', 'CE-21'],
  },
  {
    rota: '/auditoria',
    rotulo: 'Auditoria',
    grupo: 'controle',
    visibilidade: 'solo-admin',
    descricao:
      'Trilha de auditoria somente leitura: usuário, empresa, ação, objeto e data/hora (RF-05).',
    referencias: ['RF-05', 'CA-12', 'CE-16'],
  },
];

/** Tela da rota, ou `null` (rota desconhecida). */
export function telaDaRota(rota: string): Tela | null {
  return TELAS.find((tela) => tela.rota === rota) ?? null;
}

/** Telas visíveis para o papel logado (a de `solo-admin` fica oculta — CA-21). */
export function telasVisiveis(papel: 'administrador' | 'contador'): Tela[] {
  return TELAS.filter((tela) => tela.visibilidade !== 'solo-admin' || papel === 'administrador');
}
