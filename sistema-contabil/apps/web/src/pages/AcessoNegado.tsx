import { Mensagem } from '../components/Mensagem.tsx';
import { texts } from '../i18n/pt-BR.ts';

/**
 * CE-12 — negação de acesso **sem exposição de dados** (estado `neutro`,
 * ESTILO.md §5.2): o contador não tem as telas `solo-admin` no menu (CA-21)
 * e quem abrir a rota diretamente vê apenas a recusa, com nenhuma chamada de
 * dados da área.
 *
 * A recusa do servidor continua obrigatória e independente desta camada
 * (a API nega `/usuarios` e `/auditoria` ao contador com 403).
 */
export function AcessoNegado() {
  return (
    <section>
      <div className="cabecalho">
        <div className="linha1">
          <h1>{texts.recusas.ce12.tituloTela}</h1>
        </div>
      </div>

      <Mensagem
        tipo="neutro"
        mensagem={{
          titulo: texts.recusas.ce12.titulo,
          detalhe: texts.recusas.ce12.detalhe,
          acao: texts.recusas.ce12.acaoSugerida,
        }}
      />

      <p>
        <a className="btn secundario" href="#/empresas">
          {texts.recusas.ce12.botaoVoltar}
        </a>
      </p>
    </section>
  );
}
