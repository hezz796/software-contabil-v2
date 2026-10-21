import { texts } from '../i18n/pt-BR.ts';

export type TipoMensagem = 'erro' | 'neutro' | 'info';

export interface ConteudoMensagem {
  /** "O que houve" — nas recusas da API o título é a própria mensagem `{ erro }`. */
  titulo: string;
  detalhe?: string;
  /** "O que fazer" — exibido após o rótulo fixo `Ação sugerida:`. */
  acao?: string;
}

/**
 * Banner de recusa/estado (FB-2/FB-5 do padrão de mensagens da UIUX §6).
 *
 * `erro` = recusado/falhou · `neutro` = negação sem exposição de dados
 * (CE-11, CE-12) · `info` = explicação permanente — mapeamento da
 * ESTILO.md §5.2. Estado nunca comunicado só por cor: sempre texto.
 */
export function Mensagem({ tipo, mensagem }: { tipo: TipoMensagem; mensagem: ConteudoMensagem }) {
  return (
    <div
      className={`msg ${tipo}`}
      role={tipo === 'erro' ? 'alert' : 'status'}
      aria-live={tipo === 'erro' ? 'assertive' : 'polite'}
    >
      <div className="titulo">{mensagem.titulo}</div>
      {mensagem.detalhe ? <div className="detalhe">{mensagem.detalhe}</div> : null}
      {mensagem.acao ? (
        <div className="acao">
          {texts.recusas.rotuloAcao} <b>{mensagem.acao}</b>
        </div>
      ) : null}
    </div>
  );
}
