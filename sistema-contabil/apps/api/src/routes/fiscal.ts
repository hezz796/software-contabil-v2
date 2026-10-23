import {
  apuracaoDasQuerySchema,
  apuracaoDasSchema,
  associarTabelaTituloRequestSchema,
  atualizarTabelaImpostoRequestSchema,
  configurarMultaJurosRequestSchema,
  configurarRegimeFiscalRequestSchema,
  criarTabelaImpostoRequestSchema,
  configMultaJurosSchema,
  gerarApuracaoDasRequestSchema,
  listaConfigMultaJurosResponseSchema,
  listaTabelasImpostoResponseSchema,
  previaApuracaoDasSchema,
  regimeFiscalEmpresaSchema,
  tabelaImpostoSchema,
  tituloTabelaImpostoSchema,
  tabelasImpostoQuerySchema,
} from '@sistema-contabil/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  ApuracaoDas,
  ConfigMultaJuros,
  RegimeFiscalTabela,
  TabelaImposto,
  TituloTabelaImposto,
} from '../db/schema.ts';
import { ErroAplicacao } from '../errors.ts';
import { autenticacaoDe, exigirAutenticacao } from '../middleware/auth.ts';
import { exigirConfiguracaoFiscal } from '../middleware/configuracao-fiscal.ts';
import { exigirEscritaContabil } from '../middleware/escrita-contabil.ts';
import {
  apuracaoDoPeriodo,
  associarTabelaAoTitulo,
  buscarRegimeFiscal,
  configurarMultaJuros,
  configurarRegimeFiscal,
  consultarApuracaoDas,
  criarTabelaImposto,
  atualizarTabelaImposto,
  gerarApuracaoDas,
  listarConfigMultaJuros,
  listarTabelasDoTitulo,
  listarTabelasImposto,
} from '../services/fiscal.ts';
import { autorizarLeituraEmpresa } from '../services/permissoes.ts';
import { periodoDeData } from '../services/periodos.ts';

/**
 * Fiscal configurável (RF-20..23, CA-45..49/54, H17/H18/H19; TASK-017):
 * tabelas de imposto, associação a títulos, multa/juros (padrão + override)
 * e regime/apuração/geração do DAS.
 *
 * - Configurações (`POST/PATCH /fiscal/tabelas-imposto`, `POST /fiscal/multa-juros`,
 *   `POST /fiscal/regime`) usam o guard `exigirConfiguracaoFiscal` (CA-54:
 *   admin ou contador atribuído; a ALTERAÇÃO é auditada com antigo/novo pelo
 *   serviço). NÃO é escrita contábil (RF-02/RF-20).
 * - Associação tabela↔título (`POST /titulos/:id/tabelas-imposto`) e geração
 *   do DAS (`POST /fiscal/apuracoes-das`) são escrita contábil (T017-F-2:
 *   `exigirEscritaContabil`, recusa 403 auditada).
 * - Leituras (`GET`) passam por `autorizarLeituraEmpresa`; a prévia do DAS é
 *   leitura (T017-F-2) e não persiste nada (CA-49: sem regime = recusa com
 *   mensagem).
 */

const paramsIdSchema = z.object({ id: z.coerce.number().int().positive() });

/** `empresa_id` já resolvido pelo guard de configuração fiscal (nunca do corpo). */
function empresaIdConfigurada(request: FastifyRequest): number {
  const empresaId = request.configuracaoFiscalEmpresaId;
  if (empresaId === null) {
    throw new ErroAplicacao(
      400,
      'Informe a empresa (empresa_id) na qual a configuração deve ser gravada.',
      'empresa_id_ausente',
    );
  }
  return empresaId;
}

/** `empresa_id` já resolvido pelo guard de escrita contábil (nunca do corpo). */
function empresaIdEscritada(request: FastifyRequest): number {
  const empresaId = request.escritaContabilEmpresaId;
  if (empresaId === null) {
    throw new ErroAplicacao(
      400,
      'Informe a empresa (empresa_id) na qual a operação deve ser gravada.',
      'empresa_id_ausente',
    );
  }
  return empresaId;
}

function paraDTOTabela(linha: TabelaImposto) {
  return tabelaImpostoSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    nome: linha.nome,
    aliquota_centavos: linha.aliquotaCentavos,
    conta_retencao_id: linha.contaRetencaoId,
    ativa: linha.ativa,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
    atualizado_em: linha.atualizadoEm,
  });
}

function paraDTOConfigMultaJuros(linha: ConfigMultaJuros) {
  return configMultaJurosSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    titulo_id: linha.tituloId,
    multa_centavos: linha.multaCentavos,
    juros_mensal_centavos: linha.jurosMensalCentavos,
    conta_encargos_id: linha.contaEncargosId,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
    atualizado_em: linha.atualizadoEm,
  });
}

function paraDTORegime(linha: RegimeFiscalTabela) {
  return regimeFiscalEmpresaSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    regime: linha.regime,
    aliquota_centavos: linha.aliquotaCentavos,
    conta_das_despesa_id: linha.contaDespesaId,
    conta_das_passivo_id: linha.contaPassivoId,
    ativa: linha.ativa,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
    atualizado_em: linha.atualizadoEm,
  });
}

function paraDTOAssociacao(linha: TituloTabelaImposto) {
  return tituloTabelaImpostoSchema.parse({
    titulo_id: linha.tituloId,
    tabela_imposto_id: linha.tabelaImpostoId,
    empresa_id: linha.empresaId,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  });
}

function paraDTOApuracao(linha: ApuracaoDas) {
  return apuracaoDasSchema.parse({
    id: linha.id,
    empresa_id: linha.empresaId,
    regime_id: linha.regimeId,
    periodo_id: linha.periodoId,
    lancamento_id: linha.lancamentoId,
    base_centavos: linha.baseCentavos,
    aliquota_centavos: linha.aliquotaCentavos,
    das_centavos: linha.dasCentavos,
    criado_por: linha.criadoPor,
    criado_em: linha.criadoEm,
  });
}

export const fiscalRoutes: FastifyPluginAsync = async (app) => {
  const configFiscal = {
    preHandler: [exigirAutenticacao, exigirConfiguracaoFiscal({ objeto: 'configuracao_fiscal' })],
  };
  const escritaFiscal = {
    preHandler: [exigirAutenticacao, exigirEscritaContabil({ objeto: 'fiscal' })],
  };

  /* ------------------------------ Tabelas de imposto --------------------- */

  app.post('/fiscal/tabelas-imposto', configFiscal, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = criarTabelaImpostoRequestSchema.parse(request.body);
    const criada = await criarTabelaImposto(
      app.db,
      {
        empresaId: empresaIdConfigurada(request),
        nome: dados.nome,
        aliquotaCentavos: dados.aliquota_centavos,
        contaRetencaoId: dados.conta_retencao_id,
        ativa: dados.ativa,
      },
      usuario.id,
    );
    return reply.status(201).send(paraDTOTabela(criada));
  });

  app.get('/fiscal/tabelas-imposto', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = tabelasImpostoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'tabela_imposto',
      rota: 'GET /fiscal/tabelas-imposto',
    });
    const linhas = await listarTabelasImposto(app.db, query.empresa_id);
    return listaTabelasImpostoResponseSchema.parse({ tabelas: linhas.map(paraDTOTabela) });
  });

  // PATCH é configuração administrativa (CA-54): o `empresa_id` vem na QUERY
  // (o corpo é só os campos alterados) e o guard resolve o valor no servidor.
  app.patch('/fiscal/tabelas-imposto/:id', configFiscal, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = atualizarTabelaImpostoRequestSchema.parse(request.body);
    const atualizada = await atualizarTabelaImposto(
      app.db,
      {
        tabelaId: id,
        empresaId: empresaIdConfigurada(request),
        nome: dados.nome,
        aliquotaCentavos: dados.aliquota_centavos,
        contaRetencaoId: dados.conta_retencao_id,
        ativa: dados.ativa,
      },
      usuario.id,
    );
    return paraDTOTabela(atualizada);
  });

  /* ------------------------ Associação tabela ↔ título -------------------- */

  // Escrita contábil (T017-F-2): sem escrita contábil na empresa = 403
  // auditado, como em POST /titulos (CA-35/36).
  app.post('/titulos/:id/tabelas-imposto', escritaFiscal, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const dados = associarTabelaTituloRequestSchema.parse(request.body);
    const associada = await associarTabelaAoTitulo(
      app.db,
      { tituloId: id, empresaId: empresaIdEscritada(request), tabelaImpostoId: dados.tabela_imposto_id },
      usuario.id,
    );
    return reply.status(201).send(paraDTOAssociacao(associada));
  });

  app.get('/titulos/:id/tabelas-imposto', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const { id } = paramsIdSchema.parse(request.params);
    const query = tabelasImpostoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'titulo',
      rota: `GET /titulos/${id}/tabelas-imposto`,
    });
    const linhas = await listarTabelasDoTitulo(app.db, id);
    // Associações de OUTRA empresa: 404 auditado? Não — leitura: fora da
    // empresa autorizada a resposta é a lista vazia de associações do título
    // (R7: nada de dado alheio exposto; o título em si é validado nas rotas
    // de escrita). Mantemos a lista filtrada pela empresa autorizada.
    return { associacoes: linhas.filter((linha) => linha.empresaId === query.empresa_id).map(paraDTOAssociacao) };
  });

  /* ------------------------------ Multa/juros ----------------------------- */

  app.post('/fiscal/multa-juros', configFiscal, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = configurarMultaJurosRequestSchema.parse(request.body);
    const config = await configurarMultaJuros(
      app.db,
      {
        empresaId: empresaIdConfigurada(request),
        tituloId: dados.titulo_id,
        multaCentavos: dados.multa_centavos,
        jurosMensalCentavos: dados.juros_mensal_centavos,
        contaEncargosId: dados.conta_encargos_id,
      },
      usuario.id,
    );
    return reply.status(200).send(paraDTOConfigMultaJuros(config));
  });

  app.get('/fiscal/multa-juros', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = tabelasImpostoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'config_multa_juros',
      rota: 'GET /fiscal/multa-juros',
    });
    const linhas = await listarConfigMultaJuros(app.db, query.empresa_id);
    return listaConfigMultaJurosResponseSchema.parse({
      configuracoes: linhas.map(paraDTOConfigMultaJuros),
    });
  });

  /* ------------------------------ Regime fiscal --------------------------- */

  app.post('/fiscal/regime', configFiscal, async (request) => {
    const { usuario } = autenticacaoDe(request);
    const dados = configurarRegimeFiscalRequestSchema.parse(request.body);
    const regime = await configurarRegimeFiscal(
      app.db,
      {
        empresaId: empresaIdConfigurada(request),
        regime: dados.regime,
        aliquotaCentavos: dados.aliquota_centavos,
        contaDespesaId: dados.conta_das_despesa_id,
        contaPassivoId: dados.conta_das_passivo_id,
        ativa: dados.ativa,
      },
      usuario.id,
    );
    return paraDTORegime(regime);
  });

  app.get('/fiscal/regime', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = tabelasImpostoQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'regime_fiscal',
      rota: 'GET /fiscal/regime',
    });
    const regime = await buscarRegimeFiscal(app.db, query.empresa_id);
    if (!regime) {
      throw new ErroAplicacao(
        404,
        'A empresa não tem regime fiscal configurado (Simples Nacional — RF-21).',
        'regime_nao_configurado',
      );
    }
    return paraDTORegime(regime);
  });

  /* --------------------------- DAS: prévia e geração ---------------------- */

  // Prévia do DAS (T017-F-2: LEITURA — não persiste nada; CA-49: sem regime
  // ativo a consulta é recusada com mensagem).
  app.get('/fiscal/apuracao-das', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = apuracaoDasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'apuracao_das',
      rota: 'GET /fiscal/apuracao-das',
    });
    const previa = await consultarApuracaoDas(app.db, {
      empresaId: query.empresa_id,
      ano: query.ano,
      mes: query.mes,
    });
    return previaApuracaoDasSchema.parse({
      empresa_id: previa.empresaId,
      periodo_id: previa.periodoId,
      regime: previa.regime,
      aliquota_centavos: previa.aliquotaCentavos,
      base_centavos: previa.baseCentavos,
      das_centavos: previa.dasCentavos,
    });
  });

  // Geração do DAS (T017-F-2: escrita contábil — lança despesa/passivo e
  // persiste a apuração; recusa 403 auditada para quem não tem escrita).
  app.post('/fiscal/apuracoes-das', escritaFiscal, async (request, reply) => {
    const { usuario } = autenticacaoDe(request);
    const dados = gerarApuracaoDasRequestSchema.parse(request.body);
    const apurada = await gerarApuracaoDas(
      app.db,
      {
        empresaId: empresaIdEscritada(request),
        ano: dados.ano,
        mes: dados.mes,
        data: dados.data,
      },
      usuario.id,
    );
    return reply.status(201).send(paraDTOApuracao(apurada));
  });

  // Consulta da apuração persistida (leitura) — usado para conferir o
  // lançamento vinculado depois da geração (CA-46).
  app.get('/fiscal/apuracoes-das', { preHandler: [exigirAutenticacao] }, async (request) => {
    const autenticacao = autenticacaoDe(request);
    const query = apuracaoDasQuerySchema.parse(request.query);
    await autorizarLeituraEmpresa(app.db, autenticacao, query.empresa_id, {
      objeto: 'apuracao_das',
      rota: 'GET /fiscal/apuracoes-das',
    });
    const periodo = await periodoDeData(
      app.db,
      query.empresa_id,
      `${query.ano}-${String(query.mes).padStart(2, '0')}-01`,
    );
    if (!periodo) {
      throw new ErroAplicacao(
        404,
        `Não existe período contábil ${String(query.mes).padStart(2, '0')}/${query.ano} para esta empresa.`,
        'periodo_nao_encontrado',
      );
    }
    const apurada = await apuracaoDoPeriodo(app.db, periodo.id);
    if (!apurada || apurada.empresaId !== query.empresa_id) {
      throw new ErroAplicacao(
        404,
        'Não existe apuração de DAS persistida para este período.',
        'apuracao_nao_encontrada',
      );
    }
    return paraDTOApuracao(apurada);
  });
};
