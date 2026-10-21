/**
 * Textos da interface em pt-BR (H1).
 *
 * Toda string visível na UI vem daqui; recusas seguem a estrutura
 * "o que houve (com valores) + o que fazer" (UIUX §7) e o mapeamento
 * CE-01..CE-22 → estado visual de `docs/design/ESTILO.md` §5.2.
 */
export const texts = {
  appTitle: 'Sistema Contábil',

  login: {
    h1: 'Login e acesso',
    titulo: 'Entrar',
    subtitulo:
      'Única tela acessível sem sessão. Todo acesso a dados exige autenticação (R6); sem sessão válida não há retorno de dados.',
    rotuloEmail: 'Usuário (e-mail)',
    rotuloSenha: 'Senha',
    obrigatorio: 'obrigatório',
    botaoEntrar: 'Entrar',
    botaoEntrando: 'Entrando…',
    notaEscopo:
      'Sem "esqueci a senha": nenhum requisito do MVP prevê autoatendimento de senha — criação e alteração são gestão do administrador (RF-02/RF-19).',
  },

  shell: {
    papelAdministrador: 'Administrador',
    papelContador: 'Contador',
    rotuloUsuario: 'Usuário logado',
    sair: 'Sair',
    saindo: 'Saindo…',
    legendaMenu:
      'ambos · só admin (oculto do contador — CA-21) · admin: lê = admin vê sem escrita contábil (F13/CA-33)',
    grupos: {
      escritorio: 'Escritório',
      contabilidade: 'Contabilidade',
      financeiro: 'Financeiro',
      saidas: 'Saídas e configuração',
      controle: 'Controle',
    },
    legendasQuem: {
      ambos: 'ambos',
      soAdmin: 'só admin',
      adminLeitura: 'admin: lê',
    },
  },

  estados: {
    verificandoSessao: 'Verificando sessão…',
    indiqueCredenciais: 'Informe e-mail e senha para entrar.',
  },

  /**
   * Mensagens de recusa por código. `titulo` só existe quando a UI compõe o
   * texto; nas recusas de API o título vem da própria API (mensagem `{ erro }`).
   * O banner renderiza `Ação sugerida: <b>{acaoSugerida}</b>`.
   */
  recusas: {
    rotuloAcao: 'Ação sugerida:',
    credencial: {
      detalhe:
        'Verifique os dados e tente novamente. Tentativa registrada na trilha de auditoria.',
      acaoSugerida: 'rever credenciais e entrar',
    },
    ce11: {
      titulo: 'Sessão expirada após inatividade.',
      detalhe:
        'Entre novamente. A operação interrompida não foi gravada (nada ficou salvo pela metade).',
      acaoSugerida: 'entrar e repetir a operação',
    },
    ce12: {
      tituloTela: 'Acesso restrito',
      titulo: 'Você não tem permissão para acessar esta área.',
      detalhe:
        'Nenhum dado desta área foi carregado nem exibido; nada foi alterado.',
      acaoSugerida: 'voltar para a área inicial',
      botaoVoltar: 'Voltar para empresas',
    },
    ce17: {
      detalhe:
        'Aguarde o período de bloqueio ou solicite o desbloqueio a um administrador. O evento de bloqueio foi auditado.',
      acaoSugerida: 'aguardar o período ou contatar o administrador',
    },
    dadosInvalidos: {
      detalhe:
        'Os dados informados não foram aceitos pela API. Corrija os campos e envie novamente; nada foi registrado.',
      acaoSugerida: 'corrigir os dados e tentar de novo',
    },
    conexao: {
      titulo: 'Sem conexão com o servidor.',
      detalhe:
        'Nenhum dado foi enviado nem gravado. Confirme que a API local está em execução e tente novamente.',
      acaoSugerida: 'verificar a API local e repetir a ação',
    },
    falhaServidor: {
      detalhe:
        'A operação não foi concluída e nada foi registrado. Tente novamente em instantes.',
      acaoSugerida: 'tentar novamente',
    },
  },

  pendencias: {
    tituloTela: 'Tela ainda não implementada',
    descricao:
      'A fundação visual (tokens, shell e login) está pronta; esta tela de negócio entra nos próximos incrementos da TASK-020.',
    chip: 'pendente · TASK-020',
  },
} as const;
