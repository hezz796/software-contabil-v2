import { texts } from '../i18n/pt-BR.ts';
import type { Tela } from '../telas.ts';

/**
 * Placeholder das telas de negócio (fora do escopo deste incremento da
 * T020): mantém cabeçalho, referências RF/CA e sinalização de pendência,
 * sem grid/formulário — a próxima etapa é que implementa a tela.
 */
export function TelaPendente({ tela }: { tela: Tela }) {
  return (
    <section>
      <div className="cabecalho">
        <div className="linha1">
          <h1>{tela.rotulo}</h1>
          {tela.referencias.map((referencia) => (
            <span key={referencia} className="ref">
              {referencia}
            </span>
          ))}
        </div>
        <p className="sub">{tela.descricao}</p>
      </div>

      <div className="estado-vazio">
        <p className="titulo">{texts.pendencias.tituloTela}</p>
        <p className="descricao">{texts.pendencias.descricao}</p>
        <span className="chip-pendencia">{texts.pendencias.chip}</span>
      </div>
    </section>
  );
}
